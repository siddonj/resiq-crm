const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM deals WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
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
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id/stage', auth, async (req, res) => {
  const { stage } = req.body;
  try {
    const result = await pool.query(
      'UPDATE deals SET stage = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [stage, req.params.id, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', auth, async (req, res) => {
  const { title, contact_id, stage, value, service_line, close_date, notes } = req.body;
  try {
    const result = await pool.query(
      'UPDATE deals SET title=$1, contact_id=$2, stage=$3, value=$4, service_line=$5, close_date=$6, notes=$7 WHERE id=$8 AND user_id=$9 RETURNING *',
      [title, contact_id, stage || 'lead', value, service_line || null, close_date || null, notes || null, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM deals WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
