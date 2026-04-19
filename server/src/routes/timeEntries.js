const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

// List entries
router.get('/', auth, async (req, res) => {
  const { deal_id, contact_id, billable } = req.query;
  const params = [req.user.id];
  const filters = [];

  if (deal_id) { params.push(deal_id); filters.push(`t.deal_id = $${params.length}`); }
  if (contact_id) { params.push(contact_id); filters.push(`t.contact_id = $${params.length}`); }
  if (billable !== undefined) { params.push(billable === 'true'); filters.push(`t.billable = $${params.length}`); }

  const filterSQL = filters.length ? 'AND ' + filters.join(' AND ') : '';

  try {
    const result = await pool.query(`
      SELECT t.*,
        d.title AS deal_title,
        c.name AS contact_name
      FROM time_entries t
      LEFT JOIN deals d ON d.id = t.deal_id
      LEFT JOIN contacts c ON c.id = COALESCE(t.contact_id, d.contact_id)
      WHERE t.user_id = $1 ${filterSQL}
      ORDER BY t.date DESC, t.created_at DESC
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Deal time report
router.get('/report/deal/:deal_id', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        SUM(minutes) AS total_minutes,
        SUM(CASE WHEN billable THEN minutes ELSE 0 END) AS billable_minutes,
        SUM(CASE WHEN billable THEN minutes * hourly_rate / 60.0 ELSE 0 END) AS billable_amount,
        COUNT(*) AS entry_count,
        json_agg(t.* ORDER BY t.date DESC) AS entries
      FROM time_entries t
      WHERE t.deal_id = $1 AND t.user_id = $2
    `, [req.params.deal_id, req.user.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single entry
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM time_entries WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create entry
router.post('/', auth, async (req, res) => {
  const { deal_id, contact_id, description, minutes, hourly_rate, billable, date } = req.body;
  if (!minutes || minutes < 0) return res.status(400).json({ error: 'Minutes must be a positive number' });
  try {
    const result = await pool.query(
      `INSERT INTO time_entries (user_id, deal_id, contact_id, description, minutes, hourly_rate, billable, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.id, deal_id || null, contact_id || null, description || '',
       minutes, hourly_rate || 0, billable !== false, date || new Date().toISOString().slice(0, 10)]
    );
    const entry = result.rows[0];
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
    await pool.query(
      `UPDATE time_entries
       SET stopped_at = NOW(),
           minutes = GREATEST(1, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int,
           updated_at = NOW()
       WHERE user_id = $1 AND started_at IS NOT NULL AND stopped_at IS NULL`,
      [req.user.id]
    );
    const result = await pool.query(
      `INSERT INTO time_entries (user_id, deal_id, contact_id, description, minutes, hourly_rate, billable, started_at, date)
       VALUES ($1, $2, $3, $4, 0, $5, $6, NOW(), CURRENT_DATE) RETURNING *`,
      [req.user.id, deal_id || null, contact_id || null, description || '',
       hourly_rate || 0, billable !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Stop timer
router.patch('/timer/stop', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE time_entries
       SET stopped_at = NOW(),
           minutes = GREATEST(1, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int,
           updated_at = NOW()
       WHERE user_id = $1 AND started_at IS NOT NULL AND stopped_at IS NULL
       RETURNING *`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No running timer' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get active timer
router.get('/timer/active', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, d.title AS deal_title, c.name AS contact_name
       FROM time_entries t
       LEFT JOIN deals d ON d.id = t.deal_id
       LEFT JOIN contacts c ON c.id = COALESCE(t.contact_id, d.contact_id)
       WHERE t.user_id = $1 AND t.started_at IS NOT NULL AND t.stopped_at IS NULL
       LIMIT 1`,
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update entry
router.put('/:id', auth, async (req, res) => {
  const { description, minutes, hourly_rate, billable, date, deal_id, contact_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE time_entries
       SET description=$1, minutes=$2, hourly_rate=$3, billable=$4, date=$5, deal_id=$6, contact_id=$7, updated_at=NOW()
       WHERE id=$8 AND user_id=$9 RETURNING *`,
      [description || '', minutes, hourly_rate || 0, billable !== false,
       date, deal_id || null, contact_id || null, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete entry
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM time_entries WHERE id=$1 AND user_id=$2 RETURNING description',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'time_entry', req.params.id, result.rows[0].description);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
