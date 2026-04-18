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
      // Fetch contact tags for trigger event
      const tagsResult = await pool.query(
        `SELECT t.id, t.name FROM tags t
         JOIN contact_tags ct ON ct.tag_id = t.id
         WHERE ct.contact_id = $1`,
        [newContact.id]
      );
      const contactTags = tagsResult.rows.map(t => t.name);

      workflowEngine.dispatchTrigger('contact.created', {
        contact: {
          id: newContact.id,
          name: newContact.name,
          email: newContact.email,
          company: newContact.company,
          type: newContact.type,
          tags: contactTags,
        },
        user_id: req.user.id,
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

// Get all tags for current user
router.get('/tags', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, color FROM tags WHERE user_id = $1 ORDER BY name ASC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new tag
router.post('/tags', auth, async (req, res) => {
  const { name, color } = req.body;
  try {
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const result = await pool.query(
      'INSERT INTO tags (user_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color',
      [req.user.id, name.trim(), color || '#3B82F6']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.message.includes('unique')) {
      return res.status(409).json({ error: 'Tag already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get tags for a contact
router.get('/:id/tags', auth, async (req, res) => {
  try {
    // Verify contact belongs to user
    const contact = await pool.query('SELECT id FROM contacts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (contact.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });

    const result = await pool.query(
      `SELECT t.id, t.name, t.color FROM tags t
       JOIN contact_tags ct ON ct.tag_id = t.id
       WHERE ct.contact_id = $1
       ORDER BY t.name ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add tag to contact
router.post('/:id/tags', auth, async (req, res) => {
  const { tag_id } = req.body;
  try {
    // Verify contact belongs to user
    const contact = await pool.query('SELECT id FROM contacts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (contact.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });

    // Verify tag belongs to user
    const tag = await pool.query('SELECT id FROM tags WHERE id = $1 AND user_id = $2', [tag_id, req.user.id]);
    if (tag.rows.length === 0) return res.status(404).json({ error: 'Tag not found' });

    // Add tag to contact (ignore if already exists)
    await pool.query(
      'INSERT INTO contact_tags (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, tag_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove tag from contact
router.delete('/:id/tags/:tagId', auth, async (req, res) => {
  try {
    // Verify contact belongs to user
    const contact = await pool.query('SELECT id FROM contacts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (contact.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });

    // Verify tag belongs to user
    const tag = await pool.query('SELECT id FROM tags WHERE id = $1 AND user_id = $2', [req.params.tagId, req.user.id]);
    if (tag.rows.length === 0) return res.status(404).json({ error: 'Tag not found' });

    await pool.query(
      'DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = $2',
      [req.params.id, req.params.tagId]
    );

    res.json({ success: true });
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
