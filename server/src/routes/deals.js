const express = require('express');
const { db, sql, ownershipWhere } = require('../db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');
const GmailService = require('../services/gmail');

const router = express.Router();

let workflowEngine;

router.get('/', auth, async (req, res) => {
  const { search, stage, service_line } = req.query;

  const conditions = [ownershipWhere('d', 'deal', req.user.id, req.user.role)];
  if (search) conditions.push(sql`d.title ILIKE ${'%' + search + '%'}`);
  if (stage) conditions.push(sql`d.stage::text = ${stage}`);
  if (service_line) conditions.push(sql`d.service_line = ${service_line}`);

  try {
    const result = await sql`
      SELECT d.*,
        (d.user_id = ${req.user.id}) AS is_owner,
        CASE
          WHEN d.user_id = ${req.user.id} THEN 'edit'
          WHEN EXISTS (
            SELECT 1 FROM shared_resources sr2
            WHERE sr2.resource_type = 'deal' AND sr2.resource_id = d.id AND sr2.permission = 'edit'
            AND (sr2.shared_with_user_id = ${req.user.id} OR sr2.shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = ${req.user.id}))
          ) THEN 'edit'
          ELSE 'view'
        END AS access_permission
      FROM deals d
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY d.created_at DESC
    `.execute(db);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/export', auth, async (req, res) => {
  try {
    const result = await sql`
      SELECT d.title, c.name AS contact, d.stage, d.value, d.service_line, d.close_date, d.notes, d.created_at
      FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE d.user_id = ${req.user.id}
      ORDER BY d.created_at DESC
    `.execute(db);

    const headers = ['Title', 'Contact', 'Stage', 'Value', 'Service Line', 'Close Date', 'Notes', 'Created At'];
    const escape = v => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
    const rows = result.rows.map(d =>
      [d.title, d.contact, d.stage, d.value, d.service_line, d.close_date, d.notes, d.created_at].map(escape).join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="deals.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/deals/followup-pending
 * Returns deals in a proposal stage that have pending (unsent, undismissed)
 * follow-up tasks, along with the task details.
 * Used by the Today View to surface "Proposals needing follow-up".
 */
router.get('/followup-pending', auth, async (req, res) => {
  try {
    const result = await sql`
      SELECT
        d.id          AS deal_id,
        d.title       AS deal_title,
        d.stage::text AS stage,
        d.value,
        d.last_activity_at,
        d.created_at  AS deal_created_at,
        c.id          AS contact_id,
        c.name        AS contact_name,
        c.email       AS contact_email,
        ft.id         AS task_id,
        ft.day_offset,
        ft.task_body,
        ft.email_draft,
        ft.status     AS task_status,
        ft.created_at AS task_created_at
      FROM deal_followup_tasks ft
      JOIN deals d ON d.id = ft.deal_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE ft.status = 'pending'
        AND (d.user_id = ${req.user.id} OR EXISTS (
          SELECT 1 FROM shared_resources sr
          WHERE sr.resource_type = 'deal' AND sr.resource_id = d.id
            AND (sr.shared_with_user_id = ${req.user.id}
              OR sr.shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = ${req.user.id}))
        ))
      ORDER BY ft.day_offset DESC, ft.created_at ASC
    `.execute(db);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching followup-pending:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  const ObjectToCreate = req.body;
  const customFields = ObjectToCreate.custom_fields || {};
  const { title, contact_id, stage, value, service_line, close_date, notes, probability } = ObjectToCreate;
  try {
    const newDeal = await db.insertInto('deals')
      .values({
        user_id: req.user.id,
        contact_id,
        title,
        stage: stage || 'lead',
        value,
        service_line,
        close_date,
        notes,
        custom_fields: JSON.stringify(customFields),
        probability: probability != null ? probability : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    logAction(req.user.id, req.user.email, 'create', 'deal', newDeal.id, newDeal.title);

    if (workflowEngine) {
      workflowEngine.dispatchTrigger('deal.created', {
        deal_id: newDeal.id, contact_id: newDeal.contact_id, stage: newDeal.stage,
        user_id: req.user.id, deal_value: newDeal.value, deal_title: newDeal.title,
      }).catch(err => console.error('Error dispatching workflow trigger:', err));
    }

    res.status(201).json(newDeal);
  } catch (err) {
    console.error('Error creating deal:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id/stage', auth, async (req, res) => {
  const { stage } = req.body;
  try {
    const oldDeal = await db
      .selectFrom('deals')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .selectAll()
      .executeTakeFirst();

    if (!oldDeal) return res.status(404).json({ error: 'Deal not found' });

    const newDeal = await db.updateTable('deals')
      .set({ stage, updated_at: new Date() })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    if (oldDeal.stage !== newDeal.stage) {
      logAction(req.user.id, req.user.email, 'stage_change', 'deal', newDeal.id, newDeal.title, { from: oldDeal.stage, to: newDeal.stage });
      db.insertInto('deal_stage_history')
        .values({
          deal_id: newDeal.id,
          user_id: req.user.id,
          from_stage: oldDeal.stage,
          to_stage: newDeal.stage,
        })
        .execute()
        .catch(err => console.error(`Error recording stage history for deal ${newDeal.id} (${oldDeal.stage} → ${newDeal.stage}):`, err));
    }

    if (workflowEngine && oldDeal.stage !== newDeal.stage) {
      workflowEngine.dispatchTrigger('deal.stage_changed', {
        deal_id: newDeal.id, contact_id: newDeal.contact_id,
        old_stage: oldDeal.stage, new_stage: newDeal.stage,
        user_id: req.user.id, deal_value: newDeal.value, deal_title: newDeal.title,
      }).catch(err => console.error('Error dispatching workflow trigger:', err));
    }

    res.json(newDeal);
  } catch (err) {
    console.error('Error updating deal stage:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id/retainer-skip', auth, async (req, res) => {
  try {
    const deal = await db.updateTable('deals')
      .set({ retainer_skipped: true, updated_at: new Date() })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();
    if (!deal) return res.status(404).json({ error: 'Not found' });
    res.json(deal);
  } catch (err) {
    console.error('Error skipping retainer:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id/retainer-link', auth, async (req, res) => {
  const { retainer_invoice_id } = req.body;
  try {
    const deal = await db.updateTable('deals')
      .set({ retainer_invoice_id: retainer_invoice_id || null, updated_at: new Date() })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();
    if (!deal) return res.status(404).json({ error: 'Not found' });
    res.json(deal);
  } catch (err) {
    console.error('Error linking retainer invoice:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', auth, async (req, res) => {
  const ObjectToUpdate = req.body;
  const customFields = ObjectToUpdate.custom_fields || {};
  const { title, contact_id, stage, value, service_line, close_date, notes, probability } = ObjectToUpdate;
  try {
    const result = await sql`
      UPDATE deals SET
        title = ${title}, contact_id = ${contact_id}, stage = ${stage || 'lead'},
        value = ${value}, service_line = ${service_line || null},
        close_date = ${close_date || null}, notes = ${notes || null},
        custom_fields = ${JSON.stringify(customFields)}::jsonb,
        probability = ${probability != null ? probability : null}
      WHERE id = ${req.params.id}
        AND (user_id = ${req.user.id} OR EXISTS (
          SELECT 1 FROM shared_resources WHERE resource_type = 'deal' AND resource_id = ${req.params.id} AND permission = 'edit'
          AND (shared_with_user_id = ${req.user.id} OR shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = ${req.user.id}))
        ))
      RETURNING *
    `.execute(db);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'update', 'deal', req.params.id, result.rows[0].title);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/deals/:id/log-activity
 * Convenience endpoint: logs an activity on a deal and bumps last_activity_at.
 * Callers can also use POST /api/activities?deal_id=… — this is a thin wrapper
 * that ensures last_activity_at is always kept in sync.
 */
router.post('/:id/log-activity', auth, async (req, res) => {
  const { type, description, occurred_at } = req.body;
  const VALID_TYPES = ['call', 'meeting', 'email', 'note', 'task'];
  if (!type || !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  if (!description?.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }

  try {
    // Verify ownership
    const deal = await db.selectFrom('deals')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .select(['id', 'contact_id'])
      .executeTakeFirst();

    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    // Insert activity
    const activity = await db.insertInto('activities')
      .values({
        user_id: req.user.id,
        type,
        description: description.trim(),
        contact_id: deal.contact_id || null,
        deal_id: req.params.id,
        occurred_at: occurred_at || new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Bump last_activity_at on the deal
    await sql`
      UPDATE deals SET last_activity_at = NOW(), updated_at = NOW()
      WHERE id = ${req.params.id}
    `.execute(db);

    res.status(201).json(activity);
  } catch (err) {
    console.error('Error logging deal activity:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/deals/:id/followup-tasks
 * Returns all follow-up tasks for a specific deal (any status).
 */
router.get('/:id/followup-tasks', auth, async (req, res) => {
  try {
    // Ownership check
    const deal = await db.selectFrom('deals')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .select(['id'])
      .executeTakeFirst();

    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const result = await db.selectFrom('deal_followup_tasks')
      .where('deal_id', '=', req.params.id)
      .selectAll()
      .orderBy('day_offset', 'asc')
      .execute();

    res.json(result);
  } catch (err) {
    console.error('Error fetching followup tasks:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/deals/:id/followup-tasks/:taskId/send
 * Sends the draft email via Gmail and marks the task as sent.
 * Requires the user to have Gmail connected (oauth_provider = 'gmail').
 */
router.post('/:id/followup-tasks/:taskId/send', auth, async (req, res) => {
  try {
    // Ownership check
    const deal = await db.selectFrom('deals')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .selectAll()
      .executeTakeFirst();

    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    // Fetch the task
    const task = await db.selectFrom('deal_followup_tasks')
      .where('id', '=', req.params.taskId)
      .where('deal_id', '=', req.params.id)
      .selectAll()
      .executeTakeFirst();

    if (!task) return res.status(404).json({ error: 'Follow-up task not found' });
    if (task.status !== 'pending') {
      return res.status(409).json({ error: `Task is already ${task.status}` });
    }

    // Fetch contact email
    let toEmail = null;
    if (task.contact_id) {
      const contact = await db.selectFrom('contacts')
        .where('id', '=', task.contact_id)
        .select(['email', 'name'])
        .executeTakeFirst();
      toEmail = contact?.email;
    }

    if (!toEmail) {
      return res.status(422).json({ error: 'Contact has no email address — cannot send' });
    }

    const subject = `Following up on ${deal.title}`;

    // Send via Gmail — throws if not connected or auth fails
    await GmailService.sendEmail(req.user.id, toEmail, subject, task.email_draft);

    // Mark task sent
    await db.updateTable('deal_followup_tasks')
      .set({ status: 'sent', sent_at: new Date() })
      .where('id', '=', req.params.taskId)
      .execute();

    // Bump last_activity_at on the deal
    await sql`
      UPDATE deals SET last_activity_at = NOW(), updated_at = NOW()
      WHERE id = ${req.params.id}
    `.execute(db);

    logAction(req.user.id, req.user.email, 'send', 'deal_followup', task.id, deal.title);

    res.json({ success: true, sent_to: toEmail });
  } catch (err) {
    console.error('Error sending follow-up email:', err);
    // Surface Gmail auth errors clearly
    if (err.message && err.message.includes('invalid_grant')) {
      return res.status(403).json({ error: 'Gmail connection expired — please reconnect in Settings' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/deals/:id/followup-tasks/:taskId/dismiss
 * Dismisses a pending follow-up task (no email sent).
 */
router.post('/:id/followup-tasks/:taskId/dismiss', auth, async (req, res) => {
  try {
    // Ownership check
    const deal = await db.selectFrom('deals')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .select(['id'])
      .executeTakeFirst();

    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const task = await db.selectFrom('deal_followup_tasks')
      .where('id', '=', req.params.taskId)
      .where('deal_id', '=', req.params.id)
      .selectAll()
      .executeTakeFirst();

    if (!task) return res.status(404).json({ error: 'Follow-up task not found' });
    if (task.status !== 'pending') {
      return res.status(409).json({ error: `Task is already ${task.status}` });
    }

    await db.updateTable('deal_followup_tasks')
      .set({ status: 'dismissed', dismissed_at: new Date() })
      .where('id', '=', req.params.taskId)
      .execute();

    res.json({ success: true });
  } catch (err) {
    console.error('Error dismissing follow-up task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await db.deleteFrom('deals')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('title')
      .executeTakeFirst();

    logAction(req.user.id, req.user.email, 'delete', 'deal', req.params.id, result?.title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

function setWorkflowEngine(engine) { workflowEngine = engine; }

module.exports = router;
module.exports.setWorkflowEngine = setWorkflowEngine;
