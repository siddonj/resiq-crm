const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

function lineTotal(item) {
  const gross = Number(item.quantity) * Number(item.rate);
  const discounted = gross * (1 - Number(item.discount || 0) / 100);
  return discounted * (1 + Number(item.tax || 0) / 100);
}

function invoiceTotal(lineItems) {
  return lineItems.reduce((sum, item) => sum + lineTotal(item), 0);
}

// List invoices
router.get('/', auth, async (req, res) => {
  const { status, deal_id, proposal_id } = req.query;
  const params = [req.user.id];
  const filters = [];

  if (status) { params.push(status); filters.push(`i.status = $${params.length}`); }
  if (deal_id) { params.push(deal_id); filters.push(`i.deal_id = $${params.length}`); }
  if (proposal_id) { params.push(proposal_id); filters.push(`i.proposal_id = $${params.length}`); }

  const filterSQL = filters.length ? 'AND ' + filters.join(' AND ') : '';

  try {
    const result = await pool.query(`
      SELECT i.*,
        d.title AS deal_title,
        c.name AS contact_name,
        p.title AS proposal_title
      FROM invoices i
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN proposals p ON p.id = i.proposal_id
      WHERE i.user_id = $1 ${filterSQL}
      ORDER BY i.created_at DESC
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single invoice
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.*, d.title AS deal_title, c.name AS contact_name, p.title AS proposal_title
      FROM invoices i
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN proposals p ON p.id = i.proposal_id
      WHERE i.id = $1 AND i.user_id = $2
    `, [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create invoice
router.post('/', auth, async (req, res) => {
  const { title, deal_id, proposal_id, line_items, notes, due_date } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  try {
    // Generate invoice number
    const seqResult = await pool.query(`SELECT nextval('invoice_number_seq') AS num`);
    const invoice_number = `INV-${seqResult.rows[0].num}`;

    const result = await pool.query(
      `INSERT INTO invoices (user_id, deal_id, proposal_id, invoice_number, title, line_items, notes, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.id, deal_id || null, proposal_id || null, invoice_number, title,
       JSON.stringify(line_items || []), notes || null, due_date || null]
    );
    const invoice = result.rows[0];
    logAction(req.user.id, req.user.email, 'create', 'invoice', invoice.id, invoice.title);
    res.status(201).json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update invoice (draft only)
router.put('/:id', auth, async (req, res) => {
  const { title, deal_id, proposal_id, line_items, notes, due_date } = req.body;
  try {
    const result = await pool.query(
      `UPDATE invoices
       SET title=$1, deal_id=$2, proposal_id=$3, line_items=$4, notes=$5, due_date=$6, updated_at=NOW()
       WHERE id=$7 AND user_id=$8 AND status='draft' RETURNING *`,
      [title, deal_id || null, proposal_id || null, JSON.stringify(line_items || []),
       notes || null, due_date || null, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found or not editable' });
    logAction(req.user.id, req.user.email, 'update', 'invoice', req.params.id, result.rows[0].title);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Change status
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['draft', 'sent', 'paid', 'overdue'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const timestampField = { sent: ', sent_at = NOW()', paid: ', paid_at = NOW()' }[status] || '';

  try {
    const result = await pool.query(
      `UPDATE invoices SET status=$1${timestampField}, updated_at=NOW()
       WHERE id=$2 AND user_id=$3 RETURNING *`,
      [status, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'status_change', 'invoice', req.params.id, result.rows[0].title, { status });

    // Auto-create overdue reminder when sent
    if (status === 'sent' && result.rows[0].due_date) {
      try {
        await pool.query(
          `INSERT INTO reminders (user_id, title, due_date, related_type, related_id)
           VALUES ($1, $2, $3, 'invoice', $4)`,
          [req.user.id, `Invoice overdue: ${result.rows[0].title}`, result.rows[0].due_date, result.rows[0].id]
        );
      } catch (_) { /* non-fatal */ }
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Set Stripe payment URL
router.patch('/:id/payment-url', auth, async (req, res) => {
  const { stripe_payment_url } = req.body;
  try {
    const result = await pool.query(
      `UPDATE invoices SET stripe_payment_url=$1, updated_at=NOW()
       WHERE id=$2 AND user_id=$3 RETURNING *`,
      [stripe_payment_url || null, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete invoice
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM invoices WHERE id=$1 AND user_id=$2 RETURNING title',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'invoice', req.params.id, result.rows[0].title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
