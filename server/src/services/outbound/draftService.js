const pool = require('../../models/db');
const outboundUtils = require('../../utils/outboundUtils');
const { getDailySendUsage, requireWithinDailyLimit } = require('../outboundScoring');
const { logAction } = require('../auditLogger');
const compliance = require('./complianceService');

/**
 * Generate an email or LinkedIn draft for a lead.
 */
async function generateDraft({ userId, orgId, leadId, channel, logLeadEventFn }) {
  const leadRes = await pool.query(
    `SELECT * FROM outbound_leads WHERE id = $1 AND user_id = $2`,
    [leadId, userId]
  );
  if (!leadRes.rows.length) {
    throw new Error('Lead not found.');
  }

  const lead = leadRes.rows[0];
  if (lead.status === 'suppressed' || lead.suppression_reason) {
    throw new Error('Lead is suppressed and cannot be contacted.');
  }

  let subject = null;
  let body = '';
  if (channel === 'email') {
    const emailDraft = outboundUtils.buildEmailDraft(lead);
    subject = emailDraft.subject;
    body = emailDraft.body;
  } else {
    body = outboundUtils.buildLinkedInDraft(lead);
  }

  const draftResult = await pool.query(
    `INSERT INTO outbound_message_drafts (user_id, lead_id, channel, subject, body, status)
     VALUES ($1, $2, $3, $4, $5, 'drafted')
     RETURNING *`,
    [userId, leadId, channel, subject, body]
  );

  const draft = draftResult.rows[0];
  let linkedinTask = null;

  if (channel === 'linkedin') {
    const taskResult = await pool.query(
      `INSERT INTO linkedin_outreach_tasks (user_id, lead_id, draft_id, task_type, status, due_at)
       VALUES ($1, $2, $3, 'manual_message', 'drafted', NOW() + INTERVAL '1 day')
       RETURNING id, status, due_at`,
      [userId, leadId, draft.id]
    );
    linkedinTask = taskResult.rows[0];
  }

  await logLeadEventFn({
    userId,
    leadId,
    eventType: 'draft_generated',
    channel,
    metadata: { draftId: draft.id },
  });

  logAction(userId, null, 'outbound_draft_generated', 'outbound_draft', draft.id, channel, { leadId, channel }, orgId);

  return {
    ...draft,
    linkedinTaskId: linkedinTask ? linkedinTask.id : null,
    linkedinTaskStatus: linkedinTask ? linkedinTask.status : null,
    linkedinTaskDueAt: linkedinTask ? linkedinTask.due_at : null,
  };
}

/**
 * Fetch draft inbox with optional filters and summary.
 */
async function getDraftInbox({ userId, status, channel, leadId, limit = 100 }) {
  const params = [userId];
  const filters = ['d.user_id = $1'];

  if (status) {
    params.push(status);
    filters.push(`d.status = $${params.length}`);
  }
  if (channel) {
    params.push(channel);
    filters.push(`d.channel = $${params.length}`);
  }
  if (leadId) {
    params.push(leadId);
    filters.push(`d.lead_id = $${params.length}`);
  }

  params.push(Math.min(500, Math.max(1, Number(limit))));
  const limitIdx = params.length;

  const [draftsRes, summaryRes] = await Promise.all([
    pool.query(
      `SELECT
         d.*,
         l.name AS lead_name,
         l.email AS lead_email,
         l.company AS lead_company,
         l.title AS lead_title,
         l.total_score AS lead_total_score,
         l.status AS lead_status,
         t.id AS linkedin_task_id,
         t.status AS linkedin_task_status,
         t.due_at AS linkedin_task_due_at,
         t.completed_at AS linkedin_task_completed_at
       FROM outbound_message_drafts d
       LEFT JOIN outbound_leads l ON l.id = d.lead_id
       LEFT JOIN linkedin_outreach_tasks t ON t.draft_id = d.id AND t.user_id = d.user_id
       WHERE ${filters.join(' AND ')}
       ORDER BY d.updated_at DESC
       LIMIT $${limitIdx}`,
      params
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE status = 'drafted')::int AS drafted_count,
         COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
         COUNT(*) FILTER (WHERE channel = 'linkedin' AND status IN ('drafted', 'approved'))::int AS pending_linkedin_count
       FROM outbound_message_drafts
       WHERE user_id = $1`,
      [userId]
    ),
  ]);

  return {
    drafts: draftsRes.rows.map(outboundUtils.mapDraftInboxRow),
    summary: summaryRes.rows[0],
  };
}

/**
 * Approve a draft by ID.
 */
async function approveDraft({ userId, orgId, draftId, logLeadEventFn }) {
  const draftRes = await pool.query(
    `UPDATE outbound_message_drafts
     SET status = 'approved',
         approved_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'drafted'
     RETURNING *`,
    [draftId, userId]
  );

  if (draftRes.rows.length === 0) {
    throw new Error('Draft not found or already approved/sent.');
  }

  const draft = draftRes.rows[0];

  if (draft.channel === 'linkedin') {
    await pool.query(
      `UPDATE linkedin_outreach_tasks
       SET status = 'approved',
           updated_at = NOW()
       WHERE draft_id = $1 AND user_id = $2`,
      [draft.id, userId]
    );
  }

  await logLeadEventFn({
    userId,
    leadId: draft.lead_id,
    eventType: 'draft_approved',
    channel: draft.channel,
    metadata: { draftId: draft.id },
  });

  logAction(userId, null, 'outbound_draft_approved', 'outbound_draft', draft.id, draft.channel, {
    channel: draft.channel,
    leadId: draft.lead_id,
  }, orgId);

  return draft;
}

/**
 * Mark an email draft as sent.
 */
async function sendDraft({ userId, orgId, draftId, logLeadEventFn }) {
  const draftRes = await pool.query(
    `SELECT * FROM outbound_message_drafts WHERE id = $1 AND user_id = $2`,
    [draftId, userId]
  );

  if (!draftRes.rows.length) {
    throw new Error('Draft not found.');
  }

  const draft = draftRes.rows[0];
  if (draft.channel !== 'email') {
    throw new Error('Only email drafts can be sent from this endpoint.');
  }
  if (draft.status === 'sent') {
    throw new Error('Draft already sent.');
  }
  if (draft.status !== 'approved') {
    throw new Error('Draft must be approved before sending.');
  }

  const leadRes = await pool.query(
    `SELECT id, email, status, suppression_reason FROM outbound_leads WHERE id = $1 AND user_id = $2`,
    [draft.lead_id, userId]
  );
  if (!leadRes.rows.length) {
    throw new Error('Lead not found for this draft.');
  }
  const lead = leadRes.rows[0];

  // M3 compliance: enforce per-lead flag AND the centralized do-not-contact list.
  await compliance.assertSendAllowed(
    userId,
    { email: lead.email, leadStatus: lead.status, suppressionReason: lead.suppression_reason, leadId: lead.id },
    'email'
  );

  const usage = await getDailySendUsage(userId, 'email');
  if (!requireWithinDailyLimit(usage)) {
    const err = new Error(`Daily email send limit reached (${usage.limit}).`);
    err.statusCode = 429;
    err.dailyUsage = usage;
    throw err;
  }

  // CAN-SPAM: ensure the transmitted body carries the unsubscribe link + physical address.
  const finalBody = await compliance.appendComplianceFooter({ userId, email: lead.email, body: draft.body });

  const updatedRes = await pool.query(
    `UPDATE outbound_message_drafts
     SET status = 'sent',
         body = $3,
         sent_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [draftId, userId, finalBody]
  );
  const updatedDraft = updatedRes.rows[0];

  await pool.query(
    `UPDATE outbound_leads
     SET status = CASE WHEN status IN ('new', 'qualified', 'queued') THEN 'contacted' ELSE status END,
         last_outreach_channel = 'email',
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [updatedDraft.lead_id, userId]
  );

  await logLeadEventFn({
    userId,
    leadId: updatedDraft.lead_id,
    eventType: 'draft_sent',
    channel: 'email',
    metadata: { draftId: updatedDraft.id },
  });

  logAction(userId, null, 'outbound_email_sent', 'outbound_draft', updatedDraft.id, 'email', {
    leadId: updatedDraft.lead_id,
  }, orgId);

  return {
    draft: updatedDraft,
    dailyUsage: {
      ...usage,
      used: usage.used + 1,
      remaining: Math.max(0, usage.limit - (usage.used + 1)),
    },
  };
}

module.exports = {
  generateDraft,
  getDraftInbox,
  approveDraft,
  sendDraft,
};
