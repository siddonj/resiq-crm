const Queue = require('bull');
const pool = require('../models/db');
const espSendService = require('../services/espSendService');
const compliance = require('../services/outbound/complianceService');
const deliverability = require('../services/outbound/deliverabilityService');
const { recordSequenceTransition } = require('../services/outbound/sequenceService');
const { getDailySendUsage, requireWithinDailyLimit } = require('../services/outboundScoring');

/**
 * Send worker for the lead-based outbound sequence engine
 * (outbound_sequence_enrollments). The contact-based sequenceWorker.js keeps
 * sending via Gmail; this one sends through the ESP + deliverability layer.
 */

const outboundSequenceQueue = new Queue('outbound-sequence-processor', process.env.REDIS_URL || 'redis://localhost:6379');

const DEFER_INTERVAL = '1 hour';

function replaceTags(text, lead) {
  if (!text) return '';
  const name = lead.lead_name || '';
  const firstName = name.split(' ')[0] || '';
  const lastName = name.split(' ').length > 1 ? name.split(' ').slice(1).join(' ') : '';
  return text
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{last_name\}\}/g, lastName)
    .replace(/\{\{company\}\}/g, lead.lead_company || '')
    .replace(/\{\{title\}\}/g, lead.lead_title || '');
}

async function deferEnrollment(enrollmentId, reason) {
  await pool.query(
    `UPDATE outbound_sequence_enrollments
     SET next_step_due_at = NOW() + INTERVAL '${DEFER_INTERVAL}', updated_at = NOW()
     WHERE id = $1`,
    [enrollmentId]
  );
  console.log(`[OutboundSequence] Deferred enrollment ${enrollmentId}: ${reason}`);
}

async function setEnrollmentState(enrollment, toState, reason, triggerSource) {
  await pool.query(
    `UPDATE outbound_sequence_enrollments
     SET status = $1,
         stop_reason = CASE WHEN $1 = 'stopped' THEN $2 ELSE stop_reason END,
         stopped_at = CASE WHEN $1 = 'stopped' THEN NOW() ELSE stopped_at END,
         completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
         updated_at = NOW(),
         last_transition_at = NOW()
     WHERE id = $3`,
    [toState, reason, enrollment.id]
  );
  await recordSequenceTransition({
    enrollmentId: enrollment.id,
    userId: enrollment.user_id,
    fromState: enrollment.status,
    toState,
    reason,
    triggerSource,
    metadata: { leadId: enrollment.lead_id, sequenceId: enrollment.sequence_id },
  });
}

async function processDueEnrollment(enrollment) {
  const stepsRes = await pool.query(
    `SELECT * FROM sequence_steps WHERE sequence_id = $1 AND step_number = $2`,
    [enrollment.sequence_id, enrollment.current_step]
  );

  if (!stepsRes.rows.length) {
    await setEnrollmentState(enrollment, 'completed', 'No further steps', 'system');
    return;
  }
  const step = stepsRes.rows[0];

  // Lead-based sequences only send email; skip non-email steps.
  if (step.type && step.type !== 'email') {
    await advanceEnrollment(enrollment);
    return;
  }
  if (!enrollment.lead_email) {
    await setEnrollmentState(enrollment, 'stopped', 'Lead has no email address', 'system');
    return;
  }

  // Compliance: suppressed leads/do-not-contact list stop the enrollment for good.
  try {
    await compliance.assertSendAllowed(
      enrollment.user_id,
      {
        email: enrollment.lead_email,
        leadStatus: enrollment.lead_status,
        suppressionReason: enrollment.suppression_reason,
        leadId: enrollment.lead_id,
      },
      'email'
    );
  } catch (err) {
    if (err.complianceBlocked) {
      await setEnrollmentState(enrollment, 'stopped', `Compliance block: ${err.message}`, 'system');
      return;
    }
    throw err;
  }

  // Workspace daily email limit: defer, capacity frees up tomorrow.
  const usage = await getDailySendUsage(enrollment.user_id, 'email');
  if (!requireWithinDailyLimit(usage)) {
    await deferEnrollment(enrollment.id, `Daily email limit reached (${usage.limit})`);
    return;
  }

  // Per-mailbox caps / warmup / throttle: defer when nothing has capacity.
  const mailbox = await deliverability.pickSendingMailbox(enrollment.user_id);
  if (!mailbox) {
    await deferEnrollment(enrollment.id, 'No mailbox with remaining capacity');
    return;
  }

  const subject = replaceTags(step.subject, enrollment) || '(no subject)';
  const body = await compliance.appendComplianceFooter({
    userId: enrollment.user_id,
    email: enrollment.lead_email,
    body: replaceTags(step.body, enrollment),
  });

  await espSendService.sendEmail({
    userId: enrollment.user_id,
    mailbox,
    to: enrollment.lead_email,
    subject,
    text: body,
    metadata: {
      enrollmentId: enrollment.id,
      leadId: enrollment.lead_id,
      mailboxId: mailbox.id,
      stepNumber: enrollment.current_step,
    },
  });

  await deliverability.recordMailboxEvent(enrollment.user_id, mailbox.id, 'sent');

  await pool.query(
    `UPDATE outbound_leads
     SET status = CASE WHEN status IN ('new', 'qualified', 'queued') THEN 'contacted' ELSE status END,
         last_outreach_channel = 'email',
         updated_at = NOW()
     WHERE id = $1`,
    [enrollment.lead_id]
  );

  console.log(`[OutboundSequence] Sent step ${enrollment.current_step} of sequence ${enrollment.sequence_id} to ${enrollment.lead_email}`);
  await advanceEnrollment(enrollment);
}

async function advanceEnrollment(enrollment) {
  const nextStepNumber = enrollment.current_step + 1;
  const nextRes = await pool.query(
    `SELECT delay_days FROM sequence_steps WHERE sequence_id = $1 AND step_number = $2`,
    [enrollment.sequence_id, nextStepNumber]
  );

  if (nextRes.rows.length) {
    const delayDays = Number(nextRes.rows[0].delay_days) || 0;
    await pool.query(
      `UPDATE outbound_sequence_enrollments
       SET current_step = $1,
           next_step_due_at = NOW() + ($2 * INTERVAL '1 day'),
           updated_at = NOW()
       WHERE id = $3`,
      [nextStepNumber, delayDays, enrollment.id]
    );
  } else {
    await setEnrollmentState(enrollment, 'completed', 'All steps sent', 'system');
  }
}

function initOutboundSequenceWorker() {
  outboundSequenceQueue.process('process-due-steps', async () => {
    try {
      const { rows: enrollments } = await pool.query(
        `SELECT e.*,
                l.name AS lead_name,
                l.email AS lead_email,
                l.company AS lead_company,
                l.title AS lead_title,
                l.status AS lead_status,
                l.suppression_reason
         FROM outbound_sequence_enrollments e
         JOIN outbound_leads l ON l.id = e.lead_id
         WHERE e.status = 'active'
           AND e.next_step_due_at <= NOW()
         ORDER BY e.next_step_due_at ASC
         LIMIT 100`
      );

      for (const enrollment of enrollments) {
        try {
          await processDueEnrollment(enrollment);
        } catch (err) {
          // Transient failures (ESP down, DNS, etc.) defer rather than kill the
          // enrollment; the compliance path above already handled hard stops.
          console.error(`[OutboundSequence] Error on enrollment ${enrollment.id}:`, err.message);
          await deferEnrollment(enrollment.id, `Send error: ${err.message}`);
        }
      }
      return { processed: enrollments.length };
    } catch (err) {
      console.error('[OutboundSequence] Global processor error:', err);
    }
  });

  outboundSequenceQueue.add('process-due-steps', {}, { repeat: { cron: '* * * * *' } });
  console.log('✅ Outbound sequence queue initialized');
}

module.exports = { outboundSequenceQueue, initOutboundSequenceWorker, processDueEnrollment };
