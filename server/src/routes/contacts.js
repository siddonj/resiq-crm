const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const Email = require('../models/email');

const router = express.Router();

// Workflow engine will be injected via middleware from index.js
let workflowEngine;

router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contacts WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  const { name, email, phone, company, type, service_line, notes } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO contacts (user_id, name, email, phone, company, type, service_line, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.user.id, name, email, phone, company, type || 'prospect', service_line, notes]
    );

    const newContact = result.rows[0];

    // ✨ Dispatch workflow trigger for contact creation
    if (workflowEngine) {
      workflowEngine.dispatchTrigger('contact.created', {
        contact_id: newContact.id,
        user_id: req.user.id,
        contact_type: newContact.type,
        contact_email: newContact.email,
        contact_name: newContact.name,
        contact_company: newContact.company,
      }).catch((err) => {
        console.error('Error dispatching workflow trigger:', err);
        // Don't fail the API call, just log the error
      });
    }

    res.status(201).json(newContact);
  } catch (err) {
    console.error('Error creating contact:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', auth, async (req, res) => {
  const { name, email, phone, company, type, service_line, notes } = req.body;
  try {
    const result = await pool.query(
      'UPDATE contacts SET name=$1, email=$2, phone=$3, company=$4, type=$5, service_line=$6, notes=$7 WHERE id=$8 AND user_id=$9 RETURNING *',
      [name, email, phone, company, type || 'prospect', service_line || null, notes, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM contacts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get contact timeline (emails + activities)
router.get('/:id/timeline', auth, async (req, res) => {
  try {
    const contact_id = req.params.id;

    // Verify contact belongs to user
    const contact = await pool.query('SELECT id FROM contacts WHERE id = $1 AND user_id = $2', [contact_id, req.user.id]);
    if (contact.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });

    // Get emails for contact
    const emails = await Email.getEmailsWithContact(req.user.id, contact_id);

    // Get activities for contact
    const activities = await pool.query(
      `SELECT id, type, description, occurred_at, 'activity' as item_type
       FROM activities
       WHERE user_id = $1 AND contact_id = $2
       ORDER BY occurred_at DESC
       LIMIT 100`,
      [req.user.id, contact_id]
    );

    // Merge and sort by date
    const timeline = [
      ...emails.map((e) => ({
        id: e.id,
        type: 'email',
        item_type: 'email',
        from: e.sender_email,
        to: e.recipient_email,
        subject: e.subject,
        is_outbound: e.is_outbound,
        date: e.received_at,
        created_at: e.created_at,
      })),
      ...activities.rows.map((a) => ({
        id: a.id,
        type: a.type,
        item_type: 'activity',
        description: a.description,
        date: a.occurred_at,
        created_at: a.occurred_at,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(timeline);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Allow workflow engine to be injected
function setWorkflowEngine(engine) {
  workflowEngine = engine;
}

module.exports = router;
module.exports.setWorkflowEngine = setWorkflowEngine;
