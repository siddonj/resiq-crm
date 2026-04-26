const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const requireAuth = require('../middleware/auth');

// Apply auth middleware to all routes
router.use(requireAuth);

// Get all sequences for the current user
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, 
        COUNT(DISTINCT st.id) as step_count,
        COUNT(DISTINCT e.id) as active_enrollments
       FROM sequences s
       LEFT JOIN sequence_steps st ON s.id = st.sequence_id
       LEFT JOIN sequence_enrollments e ON s.id = e.sequence_id AND e.status = 'active'
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.updated_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching sequences:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new sequence
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO sequences (user_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.user.id, name, description]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating sequence:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get a specific sequence with its steps
router.get('/:id', async (req, res) => {
  try {
    const sequenceRes = await pool.query(
      `SELECT * FROM sequences WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (sequenceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Sequence not found' });
    }

    const stepsRes = await pool.query(
      `SELECT * FROM sequence_steps WHERE sequence_id = $1 ORDER BY step_number ASC`,
      [req.params.id]
    );

    // Also get active enrollments
    const enrollmentsRes = await pool.query(
      `SELECT e.*, c.first_name, c.last_name, c.email
       FROM sequence_enrollments e
       JOIN contacts c ON e.contact_id = c.id
       WHERE e.sequence_id = $1 AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [req.params.id]
    );

    res.json({
      ...sequenceRes.rows[0],
      steps: stepsRes.rows,
      enrollments: enrollmentsRes.rows
    });
  } catch (err) {
    console.error('Error fetching sequence:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update sequence steps (replaces all existing steps)
router.put('/:id/steps', async (req, res) => {
  const { steps } = req.body; // Array of step objects
  const sequenceId = req.params.id;

  try {
    // Verify ownership
    const seqCheck = await pool.query(
      `SELECT id FROM sequences WHERE id = $1 AND user_id = $2`,
      [sequenceId, req.user.id]
    );

    if (seqCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Sequence not found' });
    }

    await pool.query('BEGIN');

    // Delete existing steps
    await pool.query(`DELETE FROM sequence_steps WHERE sequence_id = $1`, [sequenceId]);

    // Insert new steps
    for (let i = 0; i < steps.length; i++) {
       const step = steps[i];
       await pool.query(
         `INSERT INTO sequence_steps (sequence_id, step_number, delay_days, type, subject, body)
          VALUES ($1, $2, $3, $4, $5, $6)`,
         [sequenceId, i + 1, step.delay_days || 0, step.type, step.subject || null, step.body]
       );
    }

    // Update sequence modified timestamp
    await pool.query(`UPDATE sequences SET updated_at = NOW() WHERE id = $1`, [sequenceId]);

    await pool.query('COMMIT');
    
    // Fetch and return the updated steps
    const { rows } = await pool.query(
      `SELECT * FROM sequence_steps WHERE sequence_id = $1 ORDER BY step_number ASC`,
      [sequenceId]
    );
    res.json(rows);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error updating sequence steps:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Enroll a contact in a sequence
router.post('/:id/enroll', async (req, res) => {
  const sequenceId = req.params.id;
  const { contactId } = req.body;

  try {
    // Verify sequence ownership
    const seqCheck = await pool.query(
      `SELECT id FROM sequences WHERE id = $1 AND user_id = $2`,
      [sequenceId, req.user.id]
    );

    if (seqCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Sequence not found' });
    }

    // Upsert enrollment (if exists, set active and reset to step 1)
    const { rows } = await pool.query(
      `INSERT INTO sequence_enrollments (sequence_id, contact_id, user_id, status, current_step, next_step_due_at)
       VALUES ($1, $2, $3, 'active', 1, NOW())
       ON CONFLICT (sequence_id, contact_id) 
       DO UPDATE SET 
         status = 'active', 
         current_step = 1, 
         next_step_due_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [sequenceId, contactId, req.user.id]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error enrolling contact:', err);
    res.status(500).json({ error: 'Server error check unique constraint or references' });
  }
});

module.exports = router;