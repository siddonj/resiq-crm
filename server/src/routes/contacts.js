const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const Email = require('../models/email');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

let workflowEngine;

router.get('/', auth, async (req, res) => {
  const { search, type, service_line, tag } = req.query;
  const params = [req.user.id];
  const filters = [];

  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    filters.push(`(c.name ILIKE $${n} OR c.email ILIKE $${n} OR c.company ILIKE $${n})`);
  }
  if (type) {
    params.push(type);
    filters.push(`c.type::text = $${params.length}`);
  }
  if (service_line) {
    params.push(service_line);
    filters.push(`c.service_line::text = $${params.length}`);
  }
  if (tag) {
    params.push(tag.toLowerCase());
    filters.push(`EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id AND LOWER(t.name) = $${params.length})`);
  }

  const filterSQL = filters.length ? 'AND ' + filters.join(' AND ') : '';

  try {
    const result = await pool.query(`
      SELECT c.*,
        (c.user_id = $1) AS is_owner,
        CASE
          WHEN c.user_id = $1 THEN 'edit'
          WHEN EXISTS (
            SELECT 1 FROM shared_resources sr2
            WHERE sr2.resource_type = 'contact' AND sr2.resource_id = c.id AND sr2.permission = 'edit'
            AND (sr2.shared_with_user_id = $1 OR sr2.shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
          ) THEN 'edit'
          ELSE 'view'
        END AS access_permission
      FROM contacts c
      WHERE (c.user_id = $1 OR EXISTS (
        SELECT 1 FROM shared_resources sr
        WHERE sr.resource_type = 'contact' AND sr.resource_id = c.id
        AND (sr.shared_with_user_id = $1 OR sr.shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
      ))
      ${filterSQL}
      ORDER BY c.created_at DESC
    `, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/export', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT name, email, phone, company, type, service_line, notes, created_at FROM contacts WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    const headers = ['Name', 'Email', 'Phone', 'Company', 'Type', 'Service Line', 'Notes', 'Created At'];
    const escape = v => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
    const rows = result.rows.map(c =>
      [c.name, c.email, c.phone, c.company, c.type, c.service_line, c.notes, c.created_at].map(escape).join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  const ObjectToCreate = req.body;
  const customFields = ObjectToCreate.custom_fields || {};
  const { name, email, phone, company, type, service_line, notes } = ObjectToCreate;
  try {
    const result = await pool.query(
      'INSERT INTO contacts (user_id, name, email, phone, company, type, service_line, notes, custom_fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.user.id, name, email, phone, company, type || 'prospect', service_line, notes, JSON.stringify(customFields)]
    );
    const newContact = result.rows[0];
    logAction(req.user.id, req.user.email, 'create', 'contact', newContact.id, newContact.name);

    if (workflowEngine) {
      const tagsResult = await pool.query(
        `SELECT t.id, t.name FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = $1`,
        [newContact.id]
      );
      workflowEngine.dispatchTrigger('contact.created', {
        contact: { id: newContact.id, name: newContact.name, email: newContact.email, company: newContact.company, type: newContact.type, tags: tagsResult.rows.map(t => t.name) },
        user_id: req.user.id,
      }).catch(err => console.error('Error dispatching workflow trigger:', err));
    }

    res.status(201).json(newContact);
  } catch (err) {
    console.error('Error creating contact:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', auth, async (req, res) => {
  const ObjectToUpdate = req.body;
  const customFields = ObjectToUpdate.custom_fields || {};
  const { name, email, phone, company, type, service_line, notes } = ObjectToUpdate;
  try {
    const result = await pool.query(
      `UPDATE contacts SET name=$1, email=$2, phone=$3, company=$4, type=$5, service_line=$6, notes=$7, custom_fields=$10
       WHERE id=$8 AND (user_id=$9 OR EXISTS (
         SELECT 1 FROM shared_resources WHERE resource_type='contact' AND resource_id=$8 AND permission='edit'
         AND (shared_with_user_id=$9 OR shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id=$9))
       )) RETURNING *`,
      [name, email, phone, company, type || 'prospect', service_line || null, notes, req.params.id, req.user.id, JSON.stringify(customFields)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'update', 'contact', req.params.id, result.rows[0].name);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM contacts WHERE id = $1 AND user_id = $2 RETURNING name',
      [req.params.id, req.user.id]
    );
    logAction(req.user.id, req.user.email, 'delete', 'contact', req.params.id, result.rows[0]?.name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/timeline', auth, async (req, res) => {
  try {
    const contact_id = req.params.id;
    const contactCheck = await pool.query('SELECT id FROM contacts WHERE id = $1 AND user_id = $2', [contact_id, req.user.id]);
    if (contactCheck.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });

    const emails = await Email.getEmailsWithContact(req.user.id, contact_id);
    const activities = await pool.query(
      `SELECT id, type, description, occurred_at, 'activity' as item_type FROM activities WHERE user_id = $1 AND contact_id = $2 ORDER BY occurred_at DESC LIMIT 100`,
      [req.user.id, contact_id]
    );

    const timeline = [
      ...emails.map(e => ({ id: e.id, type: 'email', item_type: 'email', from: e.sender_email, to: e.recipient_email, subject: e.subject, is_outbound: e.is_outbound, date: e.received_at, created_at: e.created_at })),
      ...activities.rows.map(a => ({ id: a.id, type: a.type, item_type: 'activity', description: a.description, date: a.occurred_at, created_at: a.occurred_at })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(timeline);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/tags', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, color FROM tags WHERE user_id = $1 ORDER BY name ASC', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/tags', auth, async (req, res) => {
  const { name, color } = req.body;
  try {
    if (!name?.trim()) return res.status(400).json({ error: 'Tag name is required' });
    const result = await pool.query(
      'INSERT INTO tags (user_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color',
      [req.user.id, name.trim(), color || '#3B82F6']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.message.includes('unique')) return res.status(409).json({ error: 'Tag already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/tags', auth, async (req, res) => {
  try {
    const contact = await pool.query('SELECT id FROM contacts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (contact.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });
    const result = await pool.query(
      `SELECT t.id, t.name, t.color FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = $1 ORDER BY t.name ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tags', auth, async (req, res) => {
  const { tag_id } = req.body;
  try {
    const contact = await pool.query('SELECT id FROM contacts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (contact.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });
    const tag = await pool.query('SELECT id FROM tags WHERE id = $1 AND user_id = $2', [tag_id, req.user.id]);
    if (tag.rows.length === 0) return res.status(404).json({ error: 'Tag not found' });
    await pool.query('INSERT INTO contact_tags (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, tag_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tags/:tagId', auth, async (req, res) => {
  try {
    const contact = await pool.query('SELECT id FROM contacts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (contact.rows.length === 0) return res.status(404).json({ error: 'Contact not found' });
    const tag = await pool.query('SELECT id FROM tags WHERE id = $1 AND user_id = $2', [req.params.tagId, req.user.id]);
    if (tag.rows.length === 0) return res.status(404).json({ error: 'Tag not found' });
    await pool.query('DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = $2', [req.params.id, req.params.tagId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Manual AI Auto-Enrichment (Phase 17)
router.post('/:id/enrich', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { enrichmentQueue } = require('../workers/enrichmentWorker');
    
    // Find the latest deal for this contact if any
    const dealRes = await pool.query('SELECT id FROM deals WHERE contact_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1', [id, req.user.id]);
    const dealId = dealRes.rows.length ? dealRes.rows[0].id : null;

    await enrichmentQueue.add({
      contactId: id,
      dealId: dealId,
      userId: req.user.id
    });

    res.json({ message: 'Auto-Enrichment executed in background.' });
  } catch (error) {
    console.error('Error queuing manual enrichment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

function setWorkflowEngine(engine) { workflowEngine = engine; }

module.exports = router;
module.exports.setWorkflowEngine = setWorkflowEngine;
