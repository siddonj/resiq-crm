const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

let workflowEngine;

router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*,
        (d.user_id = $1) AS is_owner,
        CASE
          WHEN d.user_id = $1 THEN 'edit'
          WHEN EXISTS (
            SELECT 1 FROM shared_resources sr2
            WHERE sr2.resource_type = 'deal' AND sr2.resource_id = d.id AND sr2.permission = 'edit'
            AND (sr2.shared_with_user_id = $1 OR sr2.shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
          ) THEN 'edit'
          ELSE 'view'
        END AS access_permission
      FROM deals d
      WHERE d.user_id = $1
        OR EXISTS (
          SELECT 1 FROM shared_resources sr
          WHERE sr.resource_type = 'deal' AND sr.resource_id = d.id
          AND (sr.shared_with_user_id = $1 OR sr.shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
        )
      ORDER BY d.created_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  const { title, contact_id, stage, value, service_line, close_date, notes } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO deals (user_id, contact_id, title, stage, value, service_line, close_date, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.user.id, contact_id, title, stage || 'lead', value, service_line, close_date, notes]
    );

    const newDeal = result.rows[0];
    logAction(req.user.id, req.user.email, 'create', 'deal', newDeal.id, newDeal.title);

    if (workflowEngine) {
      workflowEngine.dispatchTrigger('deal.created', {
        deal_id: newDeal.id, contact_id: newDeal.contact_id, stage: newDeal.stage,
        user_id: req.user.id, deal_value: newDeal.value, deal_title: newDeal.title,
      }).catch((err) => console.error('Error dispatching workflow trigger:', err));
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
    const oldResult = await pool.query('SELECT * FROM deals WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (oldResult.rows.length === 0) return res.status(404).json({ error: 'Deal not found' });

    const oldDeal = oldResult.rows[0];
    const result = await pool.query(
      'UPDATE deals SET stage = $1, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING *',
      [stage, req.params.id, req.user.id]
    );
    const newDeal = result.rows[0];

    if (oldDeal.stage !== newDeal.stage) {
      logAction(req.user.id, req.user.email, 'stage_change', 'deal', newDeal.id, newDeal.title, { from: oldDeal.stage, to: newDeal.stage });
    }

    if (workflowEngine && oldDeal.stage !== newDeal.stage) {
      workflowEngine.dispatchTrigger('deal.stage_changed', {
        deal_id: newDeal.id, contact_id: newDeal.contact_id,
        old_stage: oldDeal.stage, new_stage: newDeal.stage,
        user_id: req.user.id, deal_value: newDeal.value, deal_title: newDeal.title,
      }).catch((err) => console.error('Error dispatching workflow trigger:', err));
    }

    res.json(newDeal);
  } catch (err) {
    console.error('Error updating deal stage:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', auth, async (req, res) => {
  const { title, contact_id, stage, value, service_line, close_date, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE deals SET title=$1, contact_id=$2, stage=$3, value=$4, service_line=$5, close_date=$6, notes=$7
       WHERE id=$8 AND (user_id=$9 OR EXISTS (
         SELECT 1 FROM shared_resources WHERE resource_type='deal' AND resource_id=$8 AND permission='edit'
         AND (shared_with_user_id=$9 OR shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id=$9))
       )) RETURNING *`,
      [title, contact_id, stage || 'lead', value, service_line || null, close_date || null, notes || null, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'update', 'deal', req.params.id, result.rows[0].title);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM deals WHERE id = $1 AND user_id = $2 RETURNING title',
      [req.params.id, req.user.id]
    );
    logAction(req.user.id, req.user.email, 'delete', 'deal', req.params.id, result.rows[0]?.title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

function setWorkflowEngine(engine) {
  workflowEngine = engine;
}

module.exports = router;
module.exports.setWorkflowEngine = setWorkflowEngine;
