const express = require('express');
const multer = require('multer');
const { db, sql, ownershipWhere, orgWhere, orgUserWhere } = require('../db');
const auth = require('../middleware/auth');
const Email = require('../models/email');
const { logAction } = require('../services/auditLogger');

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
  const { search, type, service_line, tag, filter, sort } = req.query;
  const userId = req.user.id;
  const today = new Date().toISOString().slice(0, 10);
  const conditions = [ownershipWhere('c', 'contact', userId, req.user.role, req.orgId)];

  if (filter === 'overdue_actions') {
    conditions.push(sql`c.next_action_date IS NOT NULL AND c.next_action_date < ${today}::date`);
  } else if (filter === 'today_actions') {
    conditions.push(sql`c.next_action_date = ${today}::date`);
  } else {
    if (search) {
      const pct = `%${search}%`;
      conditions.push(sql`(c.name ILIKE ${pct} OR c.email ILIKE ${pct} OR c.company ILIKE ${pct})`);
    }
    if (type) conditions.push(sql`c.type::text = ${type}`);
    if (service_line) conditions.push(sql`c.service_line = ${service_line}`);
    if (tag) {
      conditions.push(sql`EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id AND LOWER(t.name) = ${tag.toLowerCase()})`);
    }
  }

  const whereClause = sql.join(conditions, sql` AND `);
  const orderClause = sort === 'next_action'
    ? sql`c.next_action_date ASC NULLS LAST, c.name ASC`
    : filter === 'overdue_actions'
      ? sql`c.next_action_date ASC`
      : sql`c.created_at DESC`;

  try {
    const { rows } = await sql`
      SELECT c.*,
        (c.user_id = ${userId}) AS is_owner,
        CASE
          WHEN c.user_id = ${userId} THEN 'edit'
          WHEN EXISTS (
            SELECT 1 FROM shared_resources sr2
            WHERE sr2.resource_type = 'contact' AND sr2.resource_id = c.id AND sr2.permission = 'edit'
            AND (sr2.shared_with_user_id = ${userId} OR sr2.shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = ${userId}))
          ) THEN 'edit'
          ELSE 'view'
        END AS access_permission
      FROM contacts c
      WHERE ${whereClause}
      ORDER BY ${orderClause}
    `.execute(db);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/export', auth, async (req, res) => {
  try {
    const rows = await db.selectFrom('contacts')
      .$call(orgWhere(req.orgId))
      .select([
        'name', 'email', 'phone', 'company', 'type', 'job_title',
        'service_line', 'industry', 'company_size', 'company_website',
        'linkedin_url', 'email_verified', 'enriched_at', 'notes', 'created_at',
      ])
      .where('user_id', '=', req.user.id)
      .orderBy('created_at', 'desc')
      .execute();
    const headers = ['Name', 'Email', 'Phone', 'Company', 'Type', 'Job Title', 'Service Line',
      'Industry', 'Company Size', 'Company Website', 'LinkedIn URL', 'Email Verified', 'Enriched At', 'Notes', 'Created At'];
    const escape = v => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
    const csvRows = rows.map(c =>
      [c.name, c.email, c.phone, c.company, c.type, c.job_title, c.service_line, c.industry,
       c.company_size, c.company_website, c.linkedin_url, c.email_verified, c.enriched_at, c.notes, c.created_at
      ].map(escape).join(',')
    );
    const csv = [headers.join(','), ...csvRows].join('\n');
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
        const contact = await db.insertInto('contacts')
          .values({
            organization_id: req.orgId,
            user_id: req.user.id,
            name: name.trim(),
            email: row.email || null,
            phone: row.phone || null,
            company: row.company || null,
            type,
            job_title: row.job_title || row.title || null,
            service_line: row.service_line || null,
            notes: row.notes || null,
            linkedin_url: row.linkedin_url || row.linkedin || null,
            company_website: row.company_website || row.website || null,
            industry: row.industry || null,
            company_size: row.company_size || null,
            custom_fields: JSON.stringify({}),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        created.push(contact);
        logAction(req.user.id, req.user.email, 'create', 'contact', contact.id, contact.name, {}, req.orgId);

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
  const { name, email, phone, company, type, service_line, notes, job_title, linkedin_url, company_website, industry, company_size, next_action_text, next_action_date } = ObjectToCreate;
  try {
    const newContact = await db.insertInto('contacts')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        name, email, phone, company,
        type: type || 'prospect',
        service_line, notes,
        custom_fields: JSON.stringify(customFields),
        job_title: job_title || null,
        linkedin_url: linkedin_url || null,
        company_website: company_website || null,
        industry: industry || null,
        company_size: company_size || null,
        next_action_text: next_action_text || null,
        next_action_date: next_action_date || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    logAction(req.user.id, req.user.email, 'create', 'contact', newContact.id, newContact.name, {}, req.orgId);

    if (workflowEngine) {
      const tags = await db.selectFrom('tags')
        .$call(orgWhere(req.orgId))
        .innerJoin('contact_tags', 'contact_tags.tag_id', 'tags.id')
        .where('contact_tags.contact_id', '=', newContact.id)
        .select(['tags.id', 'tags.name'])
        .execute();
      workflowEngine.dispatchTrigger('contact.created', req.orgId, {
        contact: { id: newContact.id, name: newContact.name, email: newContact.email, company: newContact.company, type: newContact.type, tags: tags.map(t => t.name) },
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
  const { name, email, phone, company, type, service_line, notes, job_title, linkedin_url, company_website, industry, company_size, next_action_text, next_action_date } = ObjectToUpdate;
  try {
    const { rows } = await sql`
      UPDATE contacts SET
        name = ${name}, email = ${email}, phone = ${phone}, company = ${company},
        type = ${type || 'prospect'}, service_line = ${service_line || null}, notes = ${notes},
        custom_fields = ${JSON.stringify(customFields)},
        job_title = ${job_title || null}, linkedin_url = ${linkedin_url || null},
        company_website = ${company_website || null}, industry = ${industry || null},
        company_size = ${company_size || null},
        next_action_text = ${next_action_text || null},
        next_action_date = ${next_action_date || null}
      WHERE id = ${req.params.id}
        AND (user_id = ${req.user.id} OR EXISTS (
          SELECT 1 FROM shared_resources
          WHERE resource_type = 'contact' AND resource_id = ${req.params.id} AND permission = 'edit'
          AND (shared_with_user_id = ${req.user.id} OR shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = ${req.user.id}))
        ))
      RETURNING *
    `.execute(db);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'update', 'contact', req.params.id, rows[0].name, {}, req.orgId);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/complete-action', auth, async (req, res) => {
  const { completed_text, next_action_text, next_action_date } = req.body;
  try {
    const contact = await db.selectFrom('contacts')
      .$call(orgWhere(req.orgId))
      .select('id')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!contact) return res.status(404).json({ error: 'Not found' });

    await db.insertInto('activities')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        contact_id: req.params.id,
        type: 'follow_up',
        description: completed_text || 'Follow-up completed',
        occurred_at: new Date(),
      })
      .execute();

    const { rows } = await sql`
      UPDATE contacts SET
        next_action_text = ${next_action_text || null},
        next_action_date = ${next_action_date || null}
      WHERE id = ${req.params.id} AND user_id = ${req.user.id}
      RETURNING *
    `.execute(db);

    res.json(rows[0]);
  } catch (err) {
    console.error('Error completing action:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await db.deleteFrom('contacts')
      .$call(orgWhere(req.orgId))
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('name')
      .executeTakeFirst();
    logAction(req.user.id, req.user.email, 'delete', 'contact', req.params.id, result?.name, {}, req.orgId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/timeline', auth, async (req, res) => {
  try {
    const contact_id = req.params.id;
    const contactCheck = await db.selectFrom('contacts')
      .$call(orgWhere(req.orgId))
      .select('id')
      .where('id', '=', contact_id)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!contactCheck) return res.status(404).json({ error: 'Contact not found' });

    const emails = await Email.getEmailsWithContact(req.user.id, contact_id);
    const { rows: activities } = await sql`
      SELECT id, type, description, occurred_at, 'activity' as item_type
      FROM activities
      WHERE user_id = ${req.user.id} AND contact_id = ${contact_id}
      ORDER BY occurred_at DESC
      LIMIT 100
    `.execute(db);

    const timeline = [
      ...emails.map(e => ({ id: e.id, type: 'email', item_type: 'email', from: e.sender_email, to: e.recipient_email, subject: e.subject, is_outbound: e.is_outbound, date: e.received_at, created_at: e.created_at })),
      ...activities.map(a => ({ id: a.id, type: a.type, item_type: 'activity', description: a.description, date: a.occurred_at, created_at: a.occurred_at })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(timeline);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/tags', auth, async (req, res) => {
  try {
    const rows = await db.selectFrom('tags')
      .$call(orgWhere(req.orgId))
      .select(['id', 'name', 'color'])
      .where('user_id', '=', req.user.id)
      .orderBy('name', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/tags', auth, async (req, res) => {
  const { name, color } = req.body;
  try {
    if (!name?.trim()) return res.status(400).json({ error: 'Tag name is required' });
    const tag = await db.insertInto('tags')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        name: name.trim(),
        color: color || '#3B82F6',
      })
      .returning(['id', 'name', 'color'])
      .executeTakeFirstOrThrow();
    res.status(201).json(tag);
  } catch (err) {
    if (err.message.includes('unique')) return res.status(409).json({ error: 'Tag already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/tags', auth, async (req, res) => {
  try {
    const contact = await db.selectFrom('contacts')
      .$call(orgWhere(req.orgId))
      .select('id')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const rows = await db.selectFrom('tags')
      .$call(orgWhere(req.orgId))
      .innerJoin('contact_tags', 'contact_tags.tag_id', 'tags.id')
      .where('contact_tags.contact_id', '=', req.params.id)
      .select(['tags.id', 'tags.name', 'tags.color'])
      .orderBy('tags.name', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tags', auth, async (req, res) => {
  const { tag_id } = req.body;
  try {
    const contact = await db.selectFrom('contacts')
      .$call(orgWhere(req.orgId))
      .select('id')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const tag = await db.selectFrom('tags')
      .$call(orgWhere(req.orgId))
      .select('id')
      .where('id', '=', tag_id)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    await db.insertInto('contact_tags')
      .values({ contact_id: req.params.id, tag_id })
      .onConflict((oc) => oc.doNothing())
      .execute();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tags/:tagId', auth, async (req, res) => {
  try {
    const contact = await db.selectFrom('contacts')
      .$call(orgWhere(req.orgId))
      .select('id')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const tag = await db.selectFrom('tags')
      .$call(orgWhere(req.orgId))
      .select('id')
      .where('id', '=', req.params.tagId)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    await db.deleteFrom('contact_tags')
      .where('contact_id', '=', req.params.id)
      .where('tag_id', '=', req.params.tagId)
      .execute();
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
    const deal = await db.selectFrom('deals')
      .$call(orgWhere(req.orgId))
      .select('id')
      .where('contact_id', '=', id)
      .where('user_id', '=', req.user.id)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const dealId = deal ? deal.id : null;

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
    const rows = await db.selectFrom('contacts')
      .$call(orgWhere(req.orgId))
      .select('id')
      .where('user_id', '=', req.user.id)
      .where((eb) => eb('email', 'is not', null).or('company', 'is not', null))
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    const contactIds = rows.map(r => r.id);
    await Promise.all(
      contactIds.map(contactId => enrichmentQueue.add({ contactId, dealId: null, userId: req.user.id }))
    );
    res.json({ queued: contactIds.length, message: `${contactIds.length} contacts queued for enrichment.` });
  } catch (error) {
    console.error('Error queuing bulk enrichment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Convert a lead into a contact
router.post('/from-lead', auth, async (req, res) => {
  const { leadId } = req.body;
  if (!leadId) {
    return res.status(400).json({ error: 'leadId is required' });
  }
  try {
    // Fetch the lead
    const lead = await db.selectFrom('outbound_leads')
      .selectAll()
      .where('id', '=', leadId)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Check if contact already exists with same email
    const existing = await db.selectFrom('contacts')
      .$call(orgWhere(req.orgId))
      .selectAll()
      .where('user_id', '=', req.user.id)
      .where('email', '=', lead.email)
      .where('email', 'is not', null)
      .executeTakeFirst();

    if (existing) {
      return res.status(409).json({ error: 'Contact already exists with this email', contactId: existing.id });
    }

    // Create the contact from the lead data
    const newContact = await db.insertInto('contacts')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        company: lead.company,
        type: 'prospect',
        service_line: null,
        notes: lead.notes,
        custom_fields: JSON.stringify({
          source: 'lead_conversion',
          lead_id: lead.id,
          title: lead.title,
          linkedin_url: lead.linkedin_url,
          website: lead.website,
          location: lead.location,
          fit_score: lead.fit_score,
          intent_score: lead.intent_score,
          total_score: lead.total_score,
          dedupe_key: lead.dedupe_key,
        }),
        job_title: lead.title || null,
        linkedin_url: lead.linkedin_url || null,
        company_website: lead.website || null,
        industry: null,
        company_size: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    logAction(req.user.id, req.user.email, 'convert_lead_to_contact', 'contact', newContact.id, newContact.name, {}, req.orgId);

    // Remove any workflow triggers that use 'contact.created'
    if (workflowEngine) {
      const tags = await db.selectFrom('tags')
        .$call(orgWhere(req.orgId))
        .innerJoin('contact_tags', 'contact_tags.tag_id', 'tags.id')
        .where('contact_tags.contact_id', '=', newContact.id)
        .select(['tags.id', 'tags.name'])
        .execute();
      workflowEngine.dispatchTrigger('contact.created', req.orgId, {
        contact: { id: newContact.id, name: newContact.name, email: newContact.email, company: newContact.company, type: newContact.type, tags: tags.map(t => t.name) },
        user_id: req.user.id,
      }).catch(err => console.error('Error dispatching workflow trigger:', err));
    }

    res.status(201).json(newContact);
  } catch (err) {
    console.error('Error converting lead to contact:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

function setWorkflowEngine(engine) { workflowEngine = engine; }

module.exports = router;
module.exports.setWorkflowEngine = setWorkflowEngine;
