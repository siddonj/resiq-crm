const express = require('express');
const { db, sql } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/reminders
 * List reminders — filterable by ?completed=true/false, ?due=true (overdue + due today)
 */
router.get('/', auth, async (req, res) => {
  const { completed, due } = req.query;
  const conditions = [sql`r.user_id = ${req.user.id}`];

  if (completed !== undefined) {
    conditions.push(sql`r.completed = ${completed === 'true'}`);
  }
  if (due === 'true') {
    conditions.push(sql`r.remind_at <= NOW() AND r.completed = FALSE`);
  }

  const where = sql.join(conditions, ' AND ');

  try {
    const result = await db.selectFrom('reminders as r')
      .leftJoin('contacts as c', 'c.id', 'r.contact_id')
      .leftJoin('deals as d', 'd.id', 'r.deal_id')
      .select([
        'r.*',
        'c.name as contact_name',
        'd.title as deal_title',
      ])
      .where(where)
      .orderBy('r.remind_at', 'asc')
      .execute();
    res.json(result);
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
    const result = await db.insertInto('reminders')
      .values({
        user_id: req.user.id,
        message: message.trim(),
        remind_at,
        contact_id: contact_id || null,
        deal_id: deal_id || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(result);
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
    const result = await db.updateTable('reminders')
      .set({ completed })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Reminder not found' });
    res.json(result);
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
    const result = await db.deleteFrom('reminders')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('id')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Reminder not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Error deleting reminder:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
