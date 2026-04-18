const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/reminders
 * List reminders — filterable by ?completed=true/false, ?due=true (overdue + due today)
 */
router.get('/', auth, async (req, res) => {
  const { completed, due } = req.query;
  const params = [req.user.id];
  const conditions = ['r.user_id = $1'];

  if (completed !== undefined) {
    params.push(completed === 'true');
    conditions.push(`r.completed = $${params.length}`);
  }
  if (due === 'true') {
    conditions.push(`r.remind_at <= NOW() AND r.completed = FALSE`);
  }

  const where = conditions.join(' AND ');

  try {
    const result = await pool.query(
      `SELECT r.*,
        c.name AS contact_name,
        d.title AS deal_title
       FROM reminders r
       LEFT JOIN contacts c ON c.id = r.contact_id
       LEFT JOIN deals d ON d.id = r.deal_id
       WHERE ${where}
       ORDER BY r.remind_at ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching reminders:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/reminders
 * Create a reminder
 */
router.post('/', auth, async (req, res) => {
  const { message, remind_at, contact_id, deal_id } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
  if (!remind_at) return res.status(400).json({ error: 'remind_at is required' });
  try {
    const result = await pool.query(
      `INSERT INTO reminders (user_id, message, remind_at, contact_id, deal_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, message.trim(), remind_at, contact_id || null, deal_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating reminder:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PATCH /api/reminders/:id/complete
 * Toggle completed state
 */
router.patch('/:id/complete', auth, async (req, res) => {
  const { completed = true } = req.body;
  try {
    const result = await pool.query(
      'UPDATE reminders SET completed = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [completed, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Reminder not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating reminder:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/reminders/:id
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Reminder not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Error deleting reminder:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
