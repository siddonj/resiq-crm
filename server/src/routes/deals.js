const express = require('express');
const { db, sql, ownershipWhere } = require('../db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');

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
      WHERE ${sql.join(conditions, ' AND ')}
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
