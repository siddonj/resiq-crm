const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

const VALID_TYPES = ['call', 'meeting', 'email', 'note', 'task'];

/**
 * GET /api/activities
 * List activities — filterable by ?contact_id=, ?deal_id=
 */
router.get('/', auth, async (req, res) => {
  const { contact_id, deal_id } = req.query;
  const params = [req.user.id];
  const conditions = ['a.user_id = $1'];

  if (contact_id) {
    params.push(contact_id);
    conditions.push(`a.contact_id = $${params.length}`);
  }
  if (deal_id) {
    params.push(deal_id);
    conditions.push(`a.deal_id = $${params.length}`);
  }

  try {
    const result = await pool.query(
      `SELECT a.*,
        c.name AS contact_name,
        d.title AS deal_title
       FROM activities a
       LEFT JOIN contacts c ON c.id = a.contact_id
       LEFT JOIN deals d ON d.id = a.deal_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.occurred_at DESC
       LIMIT 200`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching activities:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/activities
 * Log an activity
 */
router.post('/', auth, async (req, res) => {
  const { type, description, contact_id, deal_id, occurred_at } = req.body;
  if (!type || !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  if (!description?.trim()) return res.status(400).json({ error: 'description is required' });

  try {
    const result = await pool.query(
      `INSERT INTO activities (user_id, type, description, contact_id, deal_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, type, description.trim(), contact_id || null, deal_id || null, occurred_at || new Date()]
    );
    logAction(req.user.id, req.user.email, 'create', 'activity', result.rows[0].id, `${type}: ${description.substring(0, 50)}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating activity:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/activities/:id
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM activities WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Activity not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Error deleting activity:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
