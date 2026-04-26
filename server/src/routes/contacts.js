const express = require('express');
const multer = require('multer');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const Email = require('../models/email');
const { logAction } = require('../services/auditLogger');
const { buildOwnershipClause } = require('../utils/ownershipClause');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Simple CSV parser that handles quoted fields
function parseCSVRow(line) {
  const MAX_LINE_LENGTH = 100000;
  const safeLen = Math.min(line.length, MAX_LINE_LENGTH);
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < safeLen; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map(line => {
    const values = parseCSVRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  }).filter(row => Object.values(row).some(v => v.trim()));
}

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
    filters.push(`c.service_line = $${params.length}`);
  }
  if (tag) {
    params.push(tag.toLowerCase());
    filters.push(`EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id AND LOWER(t.name) = $${params.length})`);
  }

  const filterSQL = filters.length ? 'AND ' + filters.join(' AND ') : '';
  const ownershipClause = buildOwnershipClause('c', 'contact', req.user.role);

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
      WHERE ${ownershipClause}
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
      `SELECT name, email, phone, company, type, job_title, service_line, industry, company_size,
              company_website, linkedin_url, email_verified, enriched_at, notes, created_at
       FROM contacts WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    const headers = ['Name', 'Email', 'Phone', 'Company', 'Type', 'Job Title', 'Service Line',
      'Industry', 'Company Size', 'Company Website', 'LinkedIn URL', 'Email Verified', 'Enriched At', 'Notes', 'Created At'];
    const escape = v => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
    const rows = result.rows.map(c =>
      [c.name, c.email, c.phone, c.company, c.type, c.job_title, c.service_line, c.industry,
       c.company_size, c.company_website, c.linkedin_url, c.email_verified, c.enriched_at, c.notes, c.created_at
      ].map(escape).join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// CSV bulk import with optional background enrichment
router.post('/import', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
    const enrich = req.query.enrich === 'true';
    const text = req.file.buffer.toString('utf8');
    const rows = parseCSV(text);
    if (rows.length === 0) return res.status(400).json({ error: 'No valid rows found in CSV' });

    const VALID_TYPES = ['prospect', 'partner', 'vendor'];
    const created = [];
    const errors = [];

    for (const row of rows) {
      const name = row.name || row.full_name || '';
      if (!name.trim()) { errors.push({ row, error: 'Missing name' }); continue; }

      const type = VALID_TYPES.includes(row.type) ? row.type : 'prospect';
      try {
        const result = await pool.query(
          `INSERT INTO contacts
            (user_id, name, email, phone, company, type, job_title, service_line, notes,
             linkedin_url, company_website, industry, company_size, custom_fields)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            req.user.id,
            name.trim(),
            row.email || null,
            row.phone || null,
            row.company || null,
            type,
            row.job_title || row.title || null,
            row.service_line || null,
            row.notes || null,
            row.linkedin_url || row.linkedin || null,
            row.company_website || row.website || null,
            row.industry || null,
            row.company_size || null,
            JSON.stringify({}),
          ]
        );
        const contact = result.rows[0];
        created.push(contact);
        logAction(req.user.id, req.user.email, 'create', 'contact', contact.id, contact.name);

        if (enrich) {
          const { enrichmentQueue } = require('../workers/enrichmentWorker');
          enrichmentQueue.add({ contactId: contact.id, dealId: null, userId: req.user.id })
            .catch(e => console.error('Failed to queue enrichment:', e));
        }
      } catch (err) {
        errors.push({ row, error: err.message });
      }
    }

    res.status(201).json({
      imported: created.length,
      errors: errors.length,
      errorDetails: errors.slice(0, 10),
      enrichmentQueued: enrich && created.length > 0,
    });
  } catch (err) {
    console.error('CSV import error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  const ObjectToCreate = req.body;
  const customFields = ObjectToCreate.custom_fields || {};
  const { name, email, phone, company, type, service_line, notes, job_title, linkedin_url, company_website, industry, company_size } = ObjectToCreate;
  try {
    const result = await pool.query(
      `INSERT INTO contacts
        (user_id, name, email, phone, company, type, service_line, notes, custom_fields,
         job_title, linkedin_url, company_website, industry, company_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user.id, name, email, phone, company, type || 'prospect', service_line, notes,
       JSON.stringify(customFields), job_title || null, linkedin_url || null, company_website || null,
       industry || null, company_size || null]
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
  const { name, email, phone, company, type, service_line, notes, job_title, linkedin_url, company_website, industry, company_size } = ObjectToUpdate;
  try {
    const result = await pool.query(
      `UPDATE contacts SET
        name=$1, email=$2, phone=$3, company=$4, type=$5, service_line=$6, notes=$7, custom_fields=$10,
        job_title=$11, linkedin_url=$12, company_website=$13, industry=$14, company_size=$15
       WHERE id=$8 AND (user_id=$9 OR EXISTS (
         SELECT 1 FROM shared_resources WHERE resource_type='contact' AND resource_id=$8 AND permission='edit'
         AND (shared_with_user_id=$9 OR shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id=$9))
       )) RETURNING *`,
      [name, email, phone, company, type || 'prospect', service_line || null, notes,
       req.params.id, req.user.id, JSON.stringify(customFields),
       job_title || null, linkedin_url || null, company_website || null, industry || null, company_size || null]
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

// Bulk AI enrichment for all contacts belonging to the user
router.post('/enrich-all', auth, async (req, res) => {
  try {
    const { enrichmentQueue } = require('../workers/enrichmentWorker');
    const result = await pool.query(
      `SELECT id FROM contacts WHERE user_id = $1 AND (email IS NOT NULL OR company IS NOT NULL)
       ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );
    const contactIds = result.rows.map(r => r.id);
    await Promise.all(
      contactIds.map(contactId => enrichmentQueue.add({ contactId, dealId: null, userId: req.user.id }))
    );
    res.json({ queued: contactIds.length, message: `${contactIds.length} contacts queued for enrichment.` });
  } catch (error) {
    console.error('Error queuing bulk enrichment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

function setWorkflowEngine(engine) { workflowEngine = engine; }

module.exports = router;
module.exports.setWorkflowEngine = setWorkflowEngine;
