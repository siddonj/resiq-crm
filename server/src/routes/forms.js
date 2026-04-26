const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all forms for the authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM forms WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching forms:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new form
router.post('/', auth, async (req, res) => {
  const { title, redirect_url, fields } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    const result = await pool.query(
      'INSERT INTO forms (user_id, title, redirect_url, fields) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, title, redirect_url || null, JSON.stringify(fields || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating form:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a form
router.put('/:id', auth, async (req, res) => {
  const { title, redirect_url, fields } = req.body;
  try {
    const result = await pool.query(
      'UPDATE forms SET title = $1, redirect_url = $2, fields = $3 WHERE id = $4 AND user_id = $5 RETURNING *',
      [title, redirect_url || null, JSON.stringify(fields || []), req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Form not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating form:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a form
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM forms WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting form:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
