/**
 * Proposal Follow-up Worker
 *
 * Runs hourly. Finds deals in a "proposal" stage with no logged activity
 * for 5+ days and automatically creates a follow-up task with a pre-drafted
 * email. A second task is created at 10 days.
 *
 * Tasks appear in the Today View (Overview page) and require the seller to
 * review the draft before clicking Send — no auto-sending.
 */

const pool = require('../models/db');

/**
 * Build the pre-drafted email body for a follow-up.
 * Returns an HTML string.
 */
function buildEmailDraft(contactName, dealTitle) {
  return `<p>Hi ${contactName},</p>
<p>I wanted to follow up on the proposal I sent for <strong>${dealTitle}</strong>. Happy to answer any questions or adjust the scope to better fit your needs.</p>
<p>Looking forward to hearing from you.</p>
<p>Best,<br>[Your name]</p>`;
}

/**
 * Compute how many days have elapsed since the reference timestamp.
 * Uses last_activity_at if set, otherwise falls back to created_at.
 */
function daysElapsed(deal) {
  const ref = deal.last_activity_at || deal.created_at;
  if (!ref) return 0;
  const ms = Date.now() - new Date(ref).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Core logic — separated for testability.
 */
async function runProposalFollowupCheck() {
  console.log('[ProposalFollowup] Starting check...');

  // Find deals in a proposal-like stage that are not closed.
  // The stage column is an ENUM; casting to text lets us use ILIKE.
  const dealsResult = await pool.query(`
    SELECT
      d.id,
      d.user_id,
      d.contact_id,
      d.title,
      d.stage::text AS stage,
      d.created_at,
      d.last_activity_at,
      c.name  AS contact_name,
      c.email AS contact_email
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE d.stage::text ILIKE '%proposal%'
      AND d.stage::text NOT ILIKE '%closed%'
    ORDER BY d.created_at ASC
  `);

  const deals = dealsResult.rows;
  console.log(`[ProposalFollowup] Found ${deals.length} deal(s) in proposal stage`);

  let created5 = 0;
  let created10 = 0;

  for (const deal of deals) {
    const days = daysElapsed(deal);
    const contactName = deal.contact_name || 'there';
    const dealTitle = deal.title;

    // Fetch existing follow-up tasks for this deal
    const existingResult = await pool.query(
      'SELECT day_offset FROM deal_followup_tasks WHERE deal_id = $1',
      [deal.id]
    );
    const existingOffsets = new Set(existingResult.rows.map(r => r.day_offset));

    // 10-day task (check first so 10-day can be created alongside 5-day on same run)
    if (days >= 10 && !existingOffsets.has(10)) {
      const taskBody = `Follow up again on "${dealTitle}" — 10 days since last activity. Review and send the draft email below.`;
      const emailDraft = buildEmailDraft(contactName, dealTitle);
      await pool.query(
        `INSERT INTO deal_followup_tasks
          (deal_id, contact_id, day_offset, task_body, email_draft, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (deal_id, day_offset) DO NOTHING`,
        [deal.id, deal.contact_id, 10, taskBody, emailDraft]
      );
      created10++;
      console.log(`[ProposalFollowup] Created 10-day task for deal ${deal.id} (${dealTitle})`);
    }

    // 5-day task
    if (days >= 5 && !existingOffsets.has(5)) {
      const taskBody = `Follow up on "${dealTitle}" — 5 days since last activity. Review and send the draft email below.`;
      const emailDraft = buildEmailDraft(contactName, dealTitle);
      await pool.query(
        `INSERT INTO deal_followup_tasks
          (deal_id, contact_id, day_offset, task_body, email_draft, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (deal_id, day_offset) DO NOTHING`,
        [deal.id, deal.contact_id, 5, taskBody, emailDraft]
      );
      created5++;
      console.log(`[ProposalFollowup] Created 5-day task for deal ${deal.id} (${dealTitle})`);
    }
  }

  console.log(
    `[ProposalFollowup] Done. Created ${created5} five-day task(s) and ${created10} ten-day task(s).`
  );

  return { checked: deals.length, created5, created10 };
}

/**
 * Initialize and schedule the worker.
 * Runs once immediately, then every hour.
 */
async function startProposalFollowupWorker() {
  console.log('[ProposalFollowup] Worker starting...');

  // Run immediately on boot (non-fatal)
  runProposalFollowupCheck().catch(err =>
    console.error('[ProposalFollowup] Initial check failed:', err)
  );

  // Schedule hourly
  const HOUR_MS = 60 * 60 * 1000;
  setInterval(() => {
    runProposalFollowupCheck().catch(err =>
      console.error('[ProposalFollowup] Hourly check failed:', err)
    );
  }, HOUR_MS);

  console.log('[ProposalFollowup] Worker scheduled (hourly).');
}

module.exports = { startProposalFollowupWorker, runProposalFollowupCheck };
