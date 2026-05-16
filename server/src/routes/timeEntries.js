const express = require('express');
const { db, sql } = require('../db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

// List entries
router.get('/', auth, async (req, res) => {
  const { deal_id, contact_id, billable } = req.query;
  const conditions = [sql`t.user_id = ${req.user.id}`];

  if (deal_id) {
    conditions.push(sql`t.deal_id = ${deal_id}`);
  }
  if (contact_id) {
    conditions.push(sql`t.contact_id = ${contact_id}`);
  }
  if (billable !== undefined) {
    conditions.push(sql`t.billable = ${billable === 'true'}`);
  }

  const filterSQL = sql.join(conditions, ' AND ');

  try {
    const result = await db.selectFrom('time_entries as t')
      .leftJoin('deals as d', 'd.id', 't.deal_id')
      .leftJoin('contacts as c', sql`c.id = COALESCE(t.contact_id, d.contact_id)`)
      .select([
        't.*',
        'd.title as deal_title',
        'c.name as contact_name',
      ])
      .where(filterSQL)
      .orderBy('t.date', 'desc')
      .orderBy('t.created_at', 'desc')
      .execute();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Deal time report
router.get('/report/deal/:deal_id', auth, async (req, res) => {
  try {
    const result = await db.selectFrom('time_entries as t')
      .select([
        sql`SUM(minutes)`.as('total_minutes'),
        sql`SUM(CASE WHEN billable THEN minutes ELSE 0 END)`.as('billable_minutes'),
        sql`SUM(CASE WHEN billable THEN minutes * hourly_rate / 60.0 ELSE 0 END)`.as('billable_amount'),
        sql`COUNT(*)`.as('entry_count'),
        sql`json_agg(t.* ORDER BY t.date DESC)`.as('entries'),
      ])
      .where('t.deal_id', '=', req.params.deal_id)
      .where('t.user_id', '=', req.user.id)
      .executeTakeFirst();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single entry
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.selectFrom('time_entries')
      .selectAll()
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create entry
router.post('/', auth, async (req, res) => {
  const { deal_id, contact_id, description, minutes, hourly_rate, billable, date } = req.body;
  if (!minutes || minutes < 0) return res.status(400).json({ error: 'Minutes must be a positive number' });
  try {
    const result = await db.insertInto('time_entries')
      .values({
        user_id: req.user.id,
        deal_id: deal_id || null,
        contact_id: contact_id || null,
        description: description || '',
        minutes,
        hourly_rate: hourly_rate || 0,
        billable: billable !== false,
        date: date || new Date().toISOString().slice(0, 10),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const entry = result;
    logAction(req.user.id, req.user.email, 'create', 'time_entry', entry.id, description || `${minutes}m`);
    res.status(201).json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start timer
router.post('/timer/start', auth, async (req, res) => {
  const { deal_id, contact_id, description, hourly_rate, billable } = req.body;
  try {
    // Stop any running timer first
    await db.updateTable('time_entries')
      .set({
        stopped_at: sql`NOW()`,
        minutes: sql`GREATEST(1, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int`,
        updated_at: sql`NOW()`,
      })
      .where('user_id', '=', req.user.id)
      .where('started_at', 'is not', null)
      .where('stopped_at', 'is', null)
      .execute();

    const result = await db.insertInto('time_entries')
      .values({
        user_id: req.user.id,
        deal_id: deal_id || null,
        contact_id: contact_id || null,
        description: description || '',
        minutes: 0,
        hourly_rate: hourly_rate || 0,
        billable: billable !== false,
        started_at: sql`NOW()`,
        date: sql`CURRENT_DATE`,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Stop timer
router.patch('/timer/stop', auth, async (req, res) => {
  try {
    const result = await db.updateTable('time_entries')
      .set({
        stopped_at: sql`NOW()`,
        minutes: sql`GREATEST(1, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int`,
        updated_at: sql`NOW()`,
      })
      .where('user_id', '=', req.user.id)
      .where('started_at', 'is not', null)
      .where('stopped_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'No running timer' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get active timer
router.get('/timer/active', auth, async (req, res) => {
  try {
    const result = await db.selectFrom('time_entries as t')
      .leftJoin('deals as d', 'd.id', 't.deal_id')
      .leftJoin('contacts as c', sql`c.id = COALESCE(t.contact_id, d.contact_id)`)
      .select([
        't.*',
        'd.title as deal_title',
        'c.name as contact_name',
      ])
      .where('t.user_id', '=', req.user.id)
      .where('t.started_at', 'is not', null)
      .where('t.stopped_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    res.json(result || null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update entry
router.put('/:id', auth, async (req, res) => {
  const { description, minutes, hourly_rate, billable, date, deal_id, contact_id } = req.body;
  try {
    const result = await db.updateTable('time_entries')
      .set({
        description: description || '',
        minutes,
        hourly_rate: hourly_rate || 0,
        billable: billable !== false,
        date,
        deal_id: deal_id || null,
        contact_id: contact_id || null,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete entry
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await db.deleteFrom('time_entries')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('description')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'time_entry', req.params.id, result.description);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
