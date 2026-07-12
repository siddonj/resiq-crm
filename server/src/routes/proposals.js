const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const { randomUUID } = require('crypto');
const { getOpenAiClient, isOpenAiConfigured } = require('../services/openaiClient');
const { db, sql, orgWhere, orgUserWhere } = require('../db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');
const trackingService = require('../services/trackingService');

const router = express.Router();

// Multer: memory storage, max 10 MB, docx/txt only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.docx') || file.originalname.endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('Only .docx and .txt files are supported'));
    }
  },
});

// Parse uploaded document and extract proposal data using AI
// POST /api/proposals/parse-doc
router.post('/parse-doc', auth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 10MB.' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message || 'Invalid file upload' });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    if (!(await isOpenAiConfigured())) {
      return res.status(503).json({ error: 'AI is not configured. Set OPENAI_API_KEY on the server to enable this feature.' });
    }

    try {
      // Extract raw text from the uploaded document
      let rawText = '';
      if (req.file.mimetype === 'text/plain' || req.file.originalname.endsWith('.txt')) {
        rawText = req.file.buffer.toString('utf8');
      } else {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        rawText = result.value;
      }

      if (!rawText.trim()) {
        return res.status(422).json({ error: 'Could not extract text from the uploaded file.' });
      }

      // Truncate to first 12,000 characters to stay within token limits
      const truncated = rawText.slice(0, 12000);

      const openai = await getOpenAiClient();

      const systemPrompt = `You are an expert at reading proposal documents and extracting structured data.
Given the raw text of a proposal document, extract the following and respond ONLY with valid JSON — no markdown, no explanation:
{
  "title": "string — the proposal title or subject",
  "sections": [
    { "id": "string (slug)", "title": "string", "content": "string" }
  ],
  "line_items": [
    { "description": "string", "quantity": number, "rate": number, "tax": 0, "discount": 0 }
  ]
}
Rules:
- sections should capture Scope of Work, Deliverables, Terms, Executive Summary, etc.
- line_items should capture any pricing, fees, or services with amounts. If no explicit quantity/rate, use quantity=1 and set rate to the total amount.
- If a field is unknown, use an empty string or 0.
- Keep section content concise but complete.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Here is the proposal document text:\n\n${truncated}` },
        ],
        response_format: { type: 'json_object' },
      });

      let extracted;
      try {
        extracted = JSON.parse(completion.choices[0].message.content);
      } catch {
        return res.status(500).json({ error: 'AI returned an invalid response. Please try again.' });
      }

      // Normalise line_items — ensure every item has required numeric fields and an id
      if (Array.isArray(extracted.line_items)) {
        extracted.line_items = extracted.line_items.map(item => {
          const quantity = Number(item.quantity);
          const rate = Number(item.rate);
          const tax = Number(item.tax);
          const discount = Number(item.discount);
          return {
            id: randomUUID(),
            description: item.description || '',
            quantity: Number.isFinite(quantity) ? quantity : 1,
            rate: Number.isFinite(rate) ? rate : 0,
            tax: Number.isFinite(tax) ? tax : 0,
            discount: Number.isFinite(discount) ? discount : 0,
          };
        });
      } else {
        extracted.line_items = [];
      }

      // Normalise sections — ensure every section has an id
      if (Array.isArray(extracted.sections)) {
        extracted.sections = extracted.sections.map((s, i) => ({
          id: s.id || `section-${i}`,
          title: s.title || '',
          content: s.content || '',
        }));
      } else {
        extracted.sections = [];
      }

      res.json(extracted);
    } catch (err) {
      console.error('[parse-doc] Error:', err);
      res.status(500).json({ error: 'Failed to parse document.' });
    }
  });
});

// List proposals
router.get('/', auth, async (req, res) => {
  const { status, deal_id } = req.query;

  try {
    let query = db.selectFrom('proposals as p')
      .$call(orgWhere(req.orgId))
      .leftJoin('deals as d', 'd.id', 'p.deal_id')
      .leftJoin('contacts as c', 'c.id', 'd.contact_id')
      .select([
        'p.*',
        'd.title as deal_title',
        'c.name as contact_name',
      ])
      .where('p.user_id', '=', req.user.id);

    if (status) {
      query = query.where('p.status', '=', status);
    }
    if (deal_id) {
      query = query.where('p.deal_id', '=', deal_id);
    }

    const result = await query
      .orderBy('p.created_at', 'desc')
      .execute();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// List templates — must come before /:id
router.get('/templates', auth, async (req, res) => {
  try {
    const result = await db.selectFrom('proposal_templates')
      .$call(orgWhere(req.orgId))
      .selectAll()
      .where('user_id', '=', req.user.id)
      .orderBy('created_at', 'desc')
      .execute();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create template
router.post('/templates', auth, async (req, res) => {
  const { name, sections } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await db.insertInto('proposal_templates')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        name,
        sections: JSON.stringify(sections || []),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete template
router.delete('/templates/:id', auth, async (req, res) => {
  try {
    await db.deleteFrom('proposal_templates')
      .$call(orgWhere(req.orgId))
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .execute();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single proposal
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.selectFrom('proposals as p')
      .$call(orgWhere(req.orgId))
      .leftJoin('deals as d', 'd.id', 'p.deal_id')
      .leftJoin('contacts as c', 'c.id', 'd.contact_id')
      .select([
        'p.*',
        'd.title as deal_title',
        'c.name as contact_name',
      ])
      .where('p.id', '=', req.params.id)
      .where('p.user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get proposal with tracking pixel (for sharing/rendering)
// Pass ?tracked=true to inject pixel and create tracking record
router.get('/:id/render', auth, async (req, res) => {
  const { tracked } = req.query;
  try {
    const result = await db.selectFrom('proposals as p')
      .$call(orgWhere(req.orgId))
      .leftJoin('deals as d', 'd.id', 'p.deal_id')
      .leftJoin('contacts as c', 'c.id', 'd.contact_id')
      .select([
        'p.*',
        'd.title as deal_title',
        'c.id as contact_id',
        'c.name as contact_name',
      ])
      .where('p.id', '=', req.params.id)
      .where('p.user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!result) return res.status(404).json({ error: 'Not found' });

    let proposal = result;
    let html = proposal.html_content || '<p>No content</p>';

    // Inject tracking pixel if requested and contact exists
    if (tracked === 'true' && proposal.contact_id) {
      html = await trackingService.injectAssetPixel(
        html,
        req.user.id,
        proposal.contact_id,
        'proposal',
        req.params.id
      );
    }

    res.json({
      ...proposal,
      html_content: html,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create proposal
router.post('/', auth, async (req, res) => {
  const { title, deal_id, sections, line_items } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  try {
    const result = await db.insertInto('proposals')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        deal_id: deal_id || null,
        title,
        sections: JSON.stringify(sections || []),
        line_items: JSON.stringify(line_items || []),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const proposal = result;
    logAction(req.user.id, req.user.email, 'create', 'proposal', proposal.id, proposal.title, {}, req.orgId);
    res.status(201).json(proposal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update proposal (draft only)
router.put('/:id', auth, async (req, res) => {
  const { title, deal_id, sections, line_items } = req.body;
  try {
    const result = await db.updateTable('proposals')
      .$call(orgWhere(req.orgId))
      .set({
        title,
        deal_id: deal_id || null,
        sections: JSON.stringify(sections || []),
        line_items: JSON.stringify(line_items || []),
        updated_at: sql`NOW()`,
      })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .where('status', '=', 'draft')
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found or not editable' });
    logAction(req.user.id, req.user.email, 'update', 'proposal', req.params.id, result.title, {}, req.orgId);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Change status
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['draft', 'sent', 'viewed', 'signed', 'declined'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  try {
    const setValues = {
      status,
      updated_at: sql`NOW()`,
    };
    if (status === 'sent') setValues.sent_at = sql`NOW()`;
    if (status === 'viewed') setValues.viewed_at = sql`NOW()`;
    if (status === 'signed') setValues.signed_at = sql`NOW()`;

    const result = await db.updateTable('proposals')
      .$call(orgWhere(req.orgId))
      .set(setValues)
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'status_change', 'proposal', req.params.id, result.title, { status }, req.orgId);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// E-sign proposal
router.post('/:id/sign', auth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Signature name is required' });
  try {
    const result = await db.updateTable('proposals')
      .$call(orgWhere(req.orgId))
      .set({
        status: 'signed',
        signature_name: name,
        signature_at: sql`NOW()`,
        signed_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .where('status', 'in', ['sent', 'viewed'])
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found or cannot sign in current status' });
    logAction(req.user.id, req.user.email, 'sign', 'proposal', req.params.id, result.title, { signature_name: name }, req.orgId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete proposal
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await db.deleteFrom('proposals')
      .$call(orgWhere(req.orgId))
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('title')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'proposal', req.params.id, result.title, {}, req.orgId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Convert proposal to invoice (creates a draft invoice pre-filled from proposal line items)
router.post('/:id/convert-to-invoice', auth, async (req, res) => {
  try {
    // Fetch proposal + deal (to get contact_id)
    const proposal = await db.selectFrom('proposals as p')
      .$call(orgWhere(req.orgId))
      .leftJoin('deals as d', 'd.id', 'p.deal_id')
      .select([
        'p.id',
        'p.title',
        'p.deal_id',
        'p.line_items',
        'p.user_id',
        'd.contact_id',
      ])
      .where('p.id', '=', req.params.id)
      .where('p.user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

    // Check if already converted — look for an invoice with proposal_id = this proposal's id
    const existing = await db.selectFrom('invoices')
      .$call(orgWhere(req.orgId))
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (existing) {
      return res.status(200).json({ alreadyConverted: true, invoice: existing });
    }

    // Generate invoice number
    const seqResult = await sql`SELECT nextval('invoice_number_seq') AS num`.execute(db);
    const invoice_number = `INV-${seqResult.rows[0].num}`;

    // Map proposal line_items to invoice line_items
    const lineItems = (proposal.line_items || []).map(item => ({
      description: item.description || '',
      quantity: item.quantity ?? 1,
      rate: item.rate ?? 0,
      discount: item.discount ?? 0,
      tax: item.tax ?? 0,
    }));

    // Insert invoice
    const invoice = await db.insertInto('invoices')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        deal_id: proposal.deal_id || null,
        proposal_id: proposal.id,
        contact_id: proposal.contact_id || null,
        invoice_number,
        title: proposal.title,
        line_items: JSON.stringify(lineItems),
        status: 'draft',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    logAction(req.user.id, req.user.email, 'convert_to_invoice', 'proposal', proposal.id, proposal.title, { invoice_id: invoice.id }, req.orgId);
    res.status(201).json({ invoice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
