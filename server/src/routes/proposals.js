const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const { randomUUID } = require('crypto');
const OpenAI = require('openai');
const pool = require('../models/db');
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

    if (!process.env.OPENAI_API_KEY?.trim()) {
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

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  const params = [req.user.id];
  const filters = [];

  if (status) {
    params.push(status);
    filters.push(`p.status = $${params.length}`);
  }
  if (deal_id) {
    params.push(deal_id);
    filters.push(`p.deal_id = $${params.length}`);
  }

  const filterSQL = filters.length ? 'AND ' + filters.join(' AND ') : '';

  try {
    const result = await pool.query(`
      SELECT p.*,
        d.title AS deal_title,
        c.name AS contact_name
      FROM proposals p
      LEFT JOIN deals d ON d.id = p.deal_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE p.user_id = $1
      ${filterSQL}
      ORDER BY p.created_at DESC
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// List templates — must come before /:id
router.get('/templates', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM proposal_templates WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create template
router.post('/templates', auth, async (req, res) => {
  const { name, sections } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await pool.query(
      'INSERT INTO proposal_templates (user_id, name, sections) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, name, JSON.stringify(sections || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete template
router.delete('/templates/:id', auth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM proposal_templates WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single proposal
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, d.title AS deal_title, c.name AS contact_name
      FROM proposals p
      LEFT JOIN deals d ON d.id = p.deal_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE p.id = $1 AND p.user_id = $2
    `, [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get proposal with tracking pixel (for sharing/rendering)
// Pass ?tracked=true to inject pixel and create tracking record
router.get('/:id/render', auth, async (req, res) => {
  const { tracked } = req.query;
  try {
    const result = await pool.query(`
      SELECT p.*, d.title AS deal_title, c.id AS contact_id, c.name AS contact_name
      FROM proposals p
      LEFT JOIN deals d ON d.id = p.deal_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE p.id = $1 AND p.user_id = $2
    `, [req.params.id, req.user.id]);
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    
    let proposal = result.rows[0];
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
      html_content: html
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
    const result = await pool.query(
      `INSERT INTO proposals (user_id, deal_id, title, sections, line_items)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, deal_id || null, title, JSON.stringify(sections || []), JSON.stringify(line_items || [])]
    );
    const proposal = result.rows[0];
    logAction(req.user.id, req.user.email, 'create', 'proposal', proposal.id, proposal.title);
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
    const result = await pool.query(
      `UPDATE proposals SET title=$1, deal_id=$2, sections=$3, line_items=$4, updated_at=NOW()
       WHERE id=$5 AND user_id=$6 AND status='draft' RETURNING *`,
      [title, deal_id || null, JSON.stringify(sections || []), JSON.stringify(line_items || []), req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found or not editable' });
    logAction(req.user.id, req.user.email, 'update', 'proposal', req.params.id, result.rows[0].title);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Change status
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['draft', 'sent', 'viewed', 'signed', 'declined'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const timestampField = { sent: ', sent_at = NOW()', viewed: ', viewed_at = NOW()', signed: ', signed_at = NOW()' }[status] || '';

  try {
    const result = await pool.query(
      `UPDATE proposals SET status=$1${timestampField}, updated_at=NOW()
       WHERE id=$2 AND user_id=$3 RETURNING *`,
      [status, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'status_change', 'proposal', req.params.id, result.rows[0].title, { status });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// E-sign proposal
router.post('/:id/sign', auth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Signature name is required' });
  try {
    const result = await pool.query(
      `UPDATE proposals
       SET status='signed', signature_name=$1, signature_at=NOW(), signed_at=NOW(), updated_at=NOW()
       WHERE id=$2 AND user_id=$3 AND status IN ('sent', 'viewed') RETURNING *`,
      [name, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found or cannot sign in current status' });
    logAction(req.user.id, req.user.email, 'sign', 'proposal', req.params.id, result.rows[0].title, { signature_name: name });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete proposal
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM proposals WHERE id=$1 AND user_id=$2 RETURNING title',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'proposal', req.params.id, result.rows[0].title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
