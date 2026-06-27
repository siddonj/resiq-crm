/**
 * Deal Stage Sequence Worker
 *
 * Runs hourly. Reads all enabled stage_automation_rules from the DB and for
 * each rule finds deals that:
 *  - are in the specified stage
 *  - belong to the rule's user
 *  - are NOT excluded from automation
 *  - have had no activity for >= inactivity_days
 *
 * For each qualifying deal it auto-creates a pending deal_followup_task so
 * the seller sees it in the Today View and can review/send the draft email.
 *
 * This complements (does not replace) the existing proposalFollowupWorker
 * which handles hard-coded 5- and 10-day proposal-stage tasks.
 */

const pool = require('../models/db');

/**
 * Render a template by substituting {{contact_name}}, {{deal_title}},
 * and {{days_since_activity}} placeholders.
 */
function renderTemplate(template, { contactName, dealTitle, elapsedDays }) {
  return template
    .replace(/\{\{contact_name\}\}/g, contactName)
    .replace(/\{\{deal_title\}\}/g, dealTitle)
    .replace(/\{\{days_since_activity\}\}/g, String(elapsedDays));
}

/**
 * Compute elapsed days since last activity (or created_at as fallback).
 */
function daysElapsed(lastActivityAt, createdAt) {
  const ref = lastActivityAt || createdAt;
  if (!ref) return 0;
  return Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Core check logic — separated for testability.
 */
async function runDealStageSequenceCheck() {
  console.log('[DealStageSequence] Starting check...');

  // Fetch all enabled rules
  const rulesResult = await pool.query(
    `SELECT * FROM stage_automation_rules WHERE enabled = true ORDER BY user_id, created_at`
  );
  const rules = rulesResult.rows;

  if (rules.length === 0) {
    console.log('[DealStageSequence] No enabled rules found. Done.');
    return { rulesChecked: 0, tasksCreated: 0 };
  }

  console.log(`[DealStageSequence] Processing ${rules.length} enabled rule(s)...`);

  let tasksCreated = 0;

  for (const rule of rules) {
    // Find deals in this stage for this user that are past the inactivity threshold
    const dealsResult = await pool.query(
      `SELECT
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
       WHERE d.stage::text = $1
         AND d.user_id = $2
         AND d.exclude_from_automation = false
         AND COALESCE(d.last_activity_at, d.created_at) < NOW() - ($3 || ' days')::INTERVAL
       ORDER BY d.created_at ASC`,
      [rule.stage, rule.user_id, rule.inactivity_days]
    );

    const deals = dealsResult.rows;
    if (deals.length === 0) continue;

    console.log(
      `[DealStageSequence] Rule "${rule.rule_name}" (${rule.stage}, ${rule.inactivity_days}d): ` +
      `${deals.length} qualifying deal(s)`
    );

    for (const deal of deals) {
      // Check if a pending task for this (deal, rule) combo already exists
      const existingResult = await pool.query(
        `SELECT id FROM deal_followup_tasks
         WHERE deal_id = $1 AND rule_id = $2 AND status = 'pending'`,
        [deal.id, rule.id]
      );
      if (existingResult.rows.length > 0) continue; // already has a pending task

      const contactName = deal.contact_name || 'there';
      const elapsedDays = daysElapsed(deal.last_activity_at, deal.created_at);

      const emailDraft = renderTemplate(rule.email_template, {
        contactName,
        dealTitle: deal.title,
        elapsedDays,
      });

      const taskBody = `${rule.rule_name}: Follow up on "${deal.title}" — ${elapsedDays} day${elapsedDays !== 1 ? 's' : ''} since last activity.`;

      // Insert task — use ON CONFLICT DO NOTHING to guard against races
      // The uq_deal_followup_rule partial index ensures at most one pending
      // task per (deal_id, rule_id) pair.
      await pool.query(
        `INSERT INTO deal_followup_tasks
           (deal_id, contact_id, day_offset, rule_id, task_body, email_draft, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         ON CONFLICT DO NOTHING`,
        [deal.id, deal.contact_id, rule.inactivity_days, rule.id, taskBody, emailDraft]
      );

      tasksCreated++;
      console.log(
        `[DealStageSequence] Created task for deal ${deal.id} ("${deal.title}") via rule "${rule.rule_name}"`
      );
    }
  }

  console.log(`[DealStageSequence] Done. Created ${tasksCreated} task(s).`);
  return { rulesChecked: rules.length, tasksCreated };
}

/**
 * Initialize and schedule the worker.
 * Runs once immediately on boot, then every hour.
 */
function startDealStageSequenceWorker() {
  console.log('[DealStageSequence] Worker starting...');

  // Run immediately (non-fatal on failure)
  runDealStageSequenceCheck().catch(err =>
    console.error('[DealStageSequence] Initial check failed:', err)
  );

  // Schedule hourly
  const HOUR_MS = 60 * 60 * 1000;
  setInterval(() => {
    runDealStageSequenceCheck().catch(err =>
      console.error('[DealStageSequence] Hourly check failed:', err)
    );
  }, HOUR_MS);

  console.log('[DealStageSequence] Worker scheduled (hourly).');
}

module.exports = { startDealStageSequenceWorker, runDealStageSequenceCheck };
