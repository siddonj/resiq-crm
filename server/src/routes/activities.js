const express = require('express');
const { db, sql } = require('../db');
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

  const conditions = [sql`a.user_id = ${req.user.id}`];
  if (contact_id) conditions.push(sql`a.contact_id = ${contact_id}`);
  if (deal_id) conditions.push(sql`a.deal_id = ${deal_id}`);

  try {
    const result = await sql`
      SELECT a.*,
        c.name AS contact_name,
        d.title AS deal_title
      FROM activities a
      LEFT JOIN contacts c ON c.id = a.contact_id
      LEFT JOIN deals d ON d.id = a.deal_id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY a.occurred_at DESC
      LIMIT 200
    `.execute(db);

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
    const activity = await db.insertInto('activities')
      .values({
        user_id: req.user.id,
        type,
        description: description.trim(),
        contact_id: contact_id || null,
        deal_id: deal_id || null,
        occurred_at: occurred_at || new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    logAction(
      req.user.id, req.user.email, 'create', 'activity',
      activity.id, `${type}: ${description.substring(0, 50)}`
    );
    res.status(201).json(activity);
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
    const result = await db.deleteFrom('activities')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('id')
      .executeTakeFirst();

    if (!result) return res.status(404).json({ error: 'Activity not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Error deleting activity:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
