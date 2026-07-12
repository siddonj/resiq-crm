const Queue = require('bull');
const pool = require('../models/db');
const emailMatcher = require('../services/emailMatcher');

// Create Bull queue for email syncing
const emailSyncQueue = new Queue('email-sync', process.env.REDIS_URL || 'redis://localhost:6379');

function extractPrimaryEmail(value) {
  if (!value) return null;

  const match = String(value).match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return match ? match[1].toLowerCase() : String(value).trim().toLowerCase();
}

/**
 * Fail-closed org resolution for jobs enqueued before orgId was threaded through
 * the Bull payload (or any other caller lacking a direct orgId). Mirrors
 * services/auditLogger.js's resolveOrgIdForUser (Task 5/6 pattern) — throws on
 * ambiguous (>1) or zero memberships rather than proceeding with a null
 * organization_id into a NOT NULL column.
 */
async function resolveOrgIdForUser(userId) {
  const res = await pool.query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1`,
    [userId]
  );
  if (res.rows.length > 1) {
    throw new Error(`emailSyncWorker: user ${userId} has multiple organization memberships; org id is ambiguous.`);
  }
  const orgId = res.rows[0]?.organization_id || null;
  if (!orgId) {
    throw new Error(`emailSyncWorker: could not resolve organization_id for user ${userId}`);
  }
  return orgId;
}

function isInboundReplyFromMatchedContact(syncResult) {
  if (!syncResult?.success || !syncResult.email || !syncResult.contact) {
    return false;
  }

  if (syncResult.email.is_outbound !== false) {
    return false;
  }

  const senderEmail = extractPrimaryEmail(syncResult.email.sender_email);
  const contactEmail = extractPrimaryEmail(syncResult.contact.email);

  // If both emails are known, only pause when the sender is the matched contact.
  if (senderEmail && contactEmail) {
    return senderEmail === contactEmail;
  }

  // Fallback: inbound + matched contact (legacy behavior when one side has no email).
  return true;
}

async function pauseActiveSequencesForInboundReplies(userId, syncResults = [], orgId) {
  if (!orgId) {
    // activities.organization_id is NOT NULL with no DEFAULT (migration 062) — fail
    // loudly here instead of letting Postgres raise a generic not-null-violation
    // (which is what happened silently before this fix).
    throw new Error('pauseActiveSequencesForInboundReplies: orgId is required');
  }

  let pausedEnrollments = 0;
  const pausedContacts = new Set();

  for (const result of syncResults) {
    if (!isInboundReplyFromMatchedContact(result)) {
      continue;
    }

    const updateRes = await pool.query(
      `UPDATE sequence_enrollments
       SET status = 'paused', updated_at = NOW()
       WHERE contact_id = $1 AND user_id = $2 AND status = 'active'
       RETURNING id`,
      [result.contact.id, userId]
    );

    if (updateRes.rowCount === 0) {
      continue;
    }

    pausedEnrollments += updateRes.rowCount;
    pausedContacts.add(result.contact.id);

    await pool.query(
      `INSERT INTO activities (user_id, contact_id, type, description, occurred_at, organization_id)
       VALUES ($1, $2, 'sequence_paused', $3, NOW(), $4)`,
      [
        userId,
        result.contact.id,
        `Auto-paused ${updateRes.rowCount} active sequence enrollment(s) after inbound email reply.`,
        orgId,
      ]
    );

    console.log(
      `[Auto-Pause] Paused ${updateRes.rowCount} active sequences for contact ${result.contact.id} due to inbound reply`
    );
  }

  return {
    pausedEnrollments,
    pausedContacts: pausedContacts.size,
  };
}

/**
 * Mirror of the contact-sequence auto-pause for the lead-based outbound
 * engine: an inbound reply from an outbound lead's email pauses its active
 * outbound_sequence_enrollments and flips the lead to 'replied'.
 */
async function pauseOutboundEnrollmentsForInboundReplies(userId, syncResults = []) {
  let pausedEnrollments = 0;

  for (const result of syncResults) {
    if (!result?.success || !result.email || result.email.is_outbound !== false) {
      continue;
    }
    const senderEmail = extractPrimaryEmail(result.email.sender_email);
    if (!senderEmail) continue;

    const leadRes = await pool.query(
      `SELECT id FROM outbound_leads WHERE user_id = $1 AND lower(email) = $2`,
      [userId, senderEmail.toLowerCase()]
    );
    if (!leadRes.rows.length) continue;

    for (const lead of leadRes.rows) {
      const updateRes = await pool.query(
        `UPDATE outbound_sequence_enrollments
         SET status = 'paused',
             pause_reason = 'Inbound reply received',
             paused_at = NOW(),
             last_transition_at = NOW(),
             updated_at = NOW()
         WHERE lead_id = $1 AND user_id = $2 AND status = 'active'
         RETURNING id`,
        [lead.id, userId]
      );

      await pool.query(
        `UPDATE outbound_leads
         SET status = CASE WHEN status IN ('new', 'qualified', 'queued', 'contacted') THEN 'replied' ELSE status END,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [lead.id, userId]
      );

      if (updateRes.rowCount > 0) {
        pausedEnrollments += updateRes.rowCount;
        for (const row of updateRes.rows) {
          await pool.query(
            `INSERT INTO sequence_enrollment_transitions
               (enrollment_id, user_id, from_state, to_state, reason, trigger_source, metadata)
             VALUES ($1, $2, 'active', 'paused', 'Inbound reply received', 'system', $3::jsonb)`,
            [row.id, userId, JSON.stringify({ leadId: lead.id })]
          );
        }
        await pool.query(
          `INSERT INTO lead_source_events (user_id, lead_id, event_type, channel, metadata)
           VALUES ($1, $2, 'reply_received', 'email', $3::jsonb)`,
          [userId, lead.id, JSON.stringify({ pausedEnrollments: updateRes.rowCount })]
        );
        console.log(
          `[Auto-Pause] Paused ${updateRes.rowCount} outbound enrollment(s) for lead ${lead.id} due to inbound reply`
        );
      }
    }
  }

  return { pausedEnrollments };
}

/**
 * Process email sync job for a user
 * Max 2 concurrent jobs with exponential backoff retry
 */
emailSyncQueue.process(2, async (job) => {
  const { userId, pageToken = null, labelIds = null } = job.data;

  try {
    const labelText = labelIds && labelIds.length > 0
      ? `, labels: [${labelIds.join(', ')}]`
      : '';
    console.log(`Starting email sync for user ${userId}, page: ${pageToken || 'first'}${labelText}`);

    // Resolve org context. Jobs queued after this fix carry orgId directly
    // (routes/integrations.js's /gmail/sync stamps req.orgId). Jobs already
    // in-flight when this fix deploys (or the recurring scheduler's jobs, which
    // have no req in scope) fall back to a fail-closed membership lookup —
    // contacts/activities.organization_id is NOT NULL with no DEFAULT, so we
    // must never proceed into those inserts without a resolved orgId.
    const orgId = job.data.orgId || await resolveOrgIdForUser(userId);

    // Check if user still has Gmail connected
    const userResult = await pool.query(
      'SELECT id, oauth_provider FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult.rows[0]) {
      throw new Error('User not found');
    }

    if (userResult.rows[0].oauth_provider !== 'gmail') {
      console.log(`User ${userId} not connected to Gmail, skipping`);
      return { skipped: true, reason: 'Not connected to Gmail' };
    }

    // Sync emails from Gmail
    const result = await emailMatcher.syncUserEmails(userId, {
      maxResults: 20,
      pageToken,
      labelIds,
    }, orgId);

    if (!result.success) {
      throw new Error(result.error || 'Failed to sync emails');
    }

    console.log(`Synced ${result.count} emails for user ${userId}`);

    // Auto-pause active sequences when a contact replies inbound.
    if (Array.isArray(result.results) && result.results.length > 0) {
      const pauseSummary = await pauseActiveSequencesForInboundReplies(userId, result.results, orgId);
      if (pauseSummary.pausedEnrollments > 0) {
        console.log(
          `[Auto-Pause] Total paused enrollments: ${pauseSummary.pausedEnrollments} across ${pauseSummary.pausedContacts} contact(s)`
        );
      }
      await pauseOutboundEnrollmentsForInboundReplies(userId, result.results);
    }

    // If there's a next page, queue another job to continue pagination
    if (result.nextPageToken) {
      await emailSyncQueue.add(
        { userId, pageToken: result.nextPageToken, orgId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
        }
      );
      console.log(`Queued next page for user ${userId}`);
    }

    return result;
  } catch (err) {
    console.error(`Email sync failed for user ${userId}:`, err);
    throw err; // Bull will handle retry with backoff
  }
});

/**
 * Event handlers
 */
emailSyncQueue.on('completed', (job) => {
  console.log(`✅ Email sync completed for job ${job.id}`);
});

emailSyncQueue.on('failed', (job, err) => {
  console.error(`❌ Email sync failed for job ${job.id}: ${err.message}`);
});

emailSyncQueue.on('error', (err) => {
  console.error('Email sync queue error:', err);
});

/**
 * Schedule recurring sync jobs for all connected users
 * Run every 5 minutes
 */
async function scheduleRecurringSyncs() {
  try {
    // Get all users with Gmail connected
    const result = await pool.query(
      'SELECT id FROM users WHERE oauth_provider = $1 ORDER BY RANDOM()',
      ['gmail']
    );

    const users = result.rows;
    console.log(`Scheduling email sync for ${users.length} connected users`);

    for (const user of users) {
      // Check if job already exists for this user
      const existingJobs = await emailSyncQueue.getRepeatableJobs();
      const hasJob = existingJobs.some(
        (j) => j.key.includes(`${user.id}`) && j.every === 5 * 60 * 1000
      );

      if (!hasJob) {
        // Add repeating job: every 5 minutes
        await emailSyncQueue.add(
          { userId: user.id },
          {
            repeat: { every: 5 * 60 * 1000 }, // 5 minutes
            removeOnComplete: true,
          }
        );
        console.log(`Scheduled recurring sync for user ${user.id}`);
      }
    }
  } catch (err) {
    console.error('Error scheduling recurring syncs:', err);
  }
}

/**
 * Initialize queue and schedule syncs
 */
async function initEmailSyncWorker() {
  try {
    // Wait for queue to be ready
    await emailSyncQueue.isReady();
    console.log('Email sync queue ready');

    // Schedule recurring syncs
    await scheduleRecurringSyncs();

    // Re-schedule every hour in case new users connected
    setInterval(scheduleRecurringSyncs, 60 * 60 * 1000);
  } catch (err) {
    console.error('Failed to initialize email sync worker:', err);
  }
}

/**
 * Clean up queue on shutdown
 */
process.on('SIGTERM', async () => {
  console.log('Closing email sync queue...');
  await emailSyncQueue.close();
});

module.exports = {
  emailSyncQueue,
  initEmailSyncWorker,
  pauseActiveSequencesForInboundReplies,
  pauseOutboundEnrollmentsForInboundReplies,
  isInboundReplyFromMatchedContact,
  resolveOrgIdForUser,
};
