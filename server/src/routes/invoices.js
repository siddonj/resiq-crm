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
    const invoice = result.rows[0];

    // Load payments
    let payments = [];
    try {
      const payRes = await pool.query(
        `SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY payment_date DESC, created_at DESC`,
        [req.params.id]
      );
      payments = payRes.rows;
    } catch (_) { /* table may not exist */ }

    // Calculate totals
    const lineTotal = (items) => items.reduce((sum, item) => {
      const gross = Number(item.quantity || 0) * Number(item.rate || 0);
      const discounted = gross * (1 - Number(item.discount || 0) / 100);
      return sum + discounted * (1 + Number(item.tax || 0) / 100);
    }, 0);
    const total = lineTotal(invoice.line_items || []);
    const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    invoice.payments = payments;
    invoice.total = total;
    invoice.paid = paid;
    invoice.balance = Math.max(0, total - paid);

    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create invoice
router.post('/', auth, async (req, res) => {
  const { title, deal_id, proposal_id, line_items, notes, due_date, template_id, payment_gateway } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  try {
    // Generate invoice number
    const seqResult = await pool.query(`SELECT nextval('invoice_number_seq') AS num`);
    const invoice_number = `INV-${seqResult.rows[0].num}`;

    const result = await pool.query(
      `INSERT INTO invoices (user_id, deal_id, proposal_id, invoice_number, title, line_items, notes, due_date, template_id, payment_gateway)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.user.id, deal_id || null, proposal_id || null, invoice_number, title,
       JSON.stringify(line_items || []), notes || null, due_date || null,
       template_id || null, payment_gateway || 'stripe']
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
  const { title, deal_id, proposal_id, line_items, notes, due_date, template_id, payment_gateway } = req.body;
  try {
    const result = await pool.query(
      `UPDATE invoices
       SET title=$1, deal_id=$2, proposal_id=$3, line_items=$4, notes=$5, due_date=$6, template_id=$7, payment_gateway=$8, updated_at=NOW()
       WHERE id=$9 AND user_id=$10 AND status='draft' RETURNING *`,
      [title, deal_id || null, proposal_id || null, JSON.stringify(line_items || []),
       notes || null, due_date || null, template_id || null, payment_gateway || 'stripe',
       req.params.id, req.user.id]
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

// ── Recurring Invoices ───────────────────────────────────────────

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}
function nextDate(date, frequency) {
  switch (frequency) {
    case 'weekly': return addDays(date, 7);
    case 'biweekly': return addDays(date, 14);
    case 'monthly': return addMonths(date, 1);
    case 'quarterly': return addMonths(date, 3);
    case 'semiannually': return addMonths(date, 6);
    case 'annually': return addMonths(date, 12);
    default: return addMonths(date, 1);
  }
}

router.get('/recurring/all', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ri.*, c.name AS contact_name, d.title AS deal_title
       FROM recurring_invoices ri
       LEFT JOIN contacts c ON c.id = ri.contact_id
       LEFT JOIN deals d ON d.id = ri.deal_id
       WHERE ri.user_id = $1
       ORDER BY ri.next_send_date ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listing recurring invoices:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/recurring', auth, async (req, res) => {
  const { title, deal_id, contact_id, frequency, start_date, end_date, line_items, notes, due_days, auto_send } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!frequency) return res.status(400).json({ error: 'Frequency is required' });
  if (!start_date) return res.status(400).json({ error: 'Start date is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO recurring_invoices (user_id, deal_id, contact_id, title, frequency, start_date, end_date, next_send_date, line_items, notes, due_days, auto_send)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [req.user.id, deal_id || null, contact_id || null, title.trim(), frequency, start_date, end_date || null, start_date, JSON.stringify(line_items || []), notes || null, due_days || 14, auto_send || false]
    );
    logAction(req.user.id, req.user.email, 'create', 'recurring_invoice', rows[0].id, rows[0].title);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating recurring invoice:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/recurring/:id', auth, async (req, res) => {
  const { title, deal_id, contact_id, frequency, end_date, line_items, notes, due_days, auto_send, status, next_send_date } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE recurring_invoices
         SET title = COALESCE($1, title),
             deal_id = COALESCE($2, deal_id),
             contact_id = COALESCE($3, contact_id),
             frequency = COALESCE($4, frequency),
             end_date = COALESCE($5, end_date),
             line_items = COALESCE($6, line_items),
             notes = COALESCE($7, notes),
             due_days = COALESCE($8, due_days),
             auto_send = COALESCE($9, auto_send),
             status = COALESCE($10, status),
             next_send_date = COALESCE($11, next_send_date),
             updated_at = NOW()
       WHERE id = $12 AND user_id = $13
       RETURNING *`,
      [title, deal_id, contact_id, frequency, end_date, line_items ? JSON.stringify(line_items) : null, notes, due_days, auto_send, status, next_send_date, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'update', 'recurring_invoice', rows[0].id, rows[0].title);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating recurring invoice:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/recurring/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM recurring_invoices WHERE id=$1 AND user_id=$2 RETURNING title',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'recurring_invoice', req.params.id, rows[0].title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Generate invoice from recurring invoice
router.post('/recurring/:id/generate', auth, async (req, res) => {
  try {
    const { rows: riRows } = await pool.query(
      `SELECT * FROM recurring_invoices WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!riRows[0]) return res.status(404).json({ error: 'Recurring invoice not found' });
    const ri = riRows[0];

    // Generate invoice number
    const seqResult = await pool.query(`SELECT nextval('invoice_number_seq') AS num`);
    const invoice_number = `INV-${seqResult.rows[0].num}`;

    // Calculate due date
    const dueDate = ri.due_days ? addDays(ri.next_send_date, ri.due_days) : null;

    const { rows: invRows } = await pool.query(
      `INSERT INTO invoices (user_id, deal_id, invoice_number, title, line_items, notes, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft') RETURNING *`,
      [req.user.id, ri.deal_id, invoice_number, ri.title, JSON.stringify(ri.line_items), ri.notes, dueDate]
    );
    const invoice = invRows[0];

    // Log generation
    await pool.query(
      `INSERT INTO recurring_invoice_logs (recurring_invoice_id, invoice_id, status) VALUES ($1, $2, 'generated')`,
      [ri.id, invoice.id]
    );

    // Advance next_send_date
    const newNext = nextDate(ri.next_send_date, ri.frequency);
    let newStatus = ri.status;
    if (ri.end_date && newNext > ri.end_date) newStatus = 'completed';
    await pool.query(
      `UPDATE recurring_invoices SET next_send_date = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [newNext, newStatus, ri.id]
    );

    logAction(req.user.id, req.user.email, 'generate', 'invoice_from_recurring', invoice.id, ri.title);
    res.status(201).json(invoice);
  } catch (err) {
    console.error('Error generating invoice:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Subscriptions ────────────────────────────────────────────────

router.get('/subscriptions/all', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, c.name AS contact_name
       FROM subscriptions s
       LEFT JOIN contacts c ON c.id = s.contact_id
       WHERE s.user_id = $1
       ORDER BY s.next_billing_date ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listing subscriptions:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/subscriptions', auth, async (req, res) => {
  const { contact_id, plan_name, description, amount, frequency, start_date, end_date } = req.body || {};
  if (!contact_id) return res.status(400).json({ error: 'contact_id is required' });
  if (!plan_name?.trim()) return res.status(400).json({ error: 'Plan name is required' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount must be > 0' });
  if (!frequency) return res.status(400).json({ error: 'Frequency is required' });
  if (!start_date) return res.status(400).json({ error: 'Start date is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO subscriptions (user_id, contact_id, plan_name, description, amount, frequency, start_date, end_date, next_billing_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.id, contact_id, plan_name.trim(), description || null, amount, frequency, start_date, end_date || null, start_date]
    );
    logAction(req.user.id, req.user.email, 'create', 'subscription', rows[0].id, rows[0].plan_name);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating subscription:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/subscriptions/:id', auth, async (req, res) => {
  const { plan_name, description, amount, frequency, end_date, status, next_billing_date } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE subscriptions
         SET plan_name = COALESCE($1, plan_name),
             description = COALESCE($2, description),
             amount = COALESCE($3, amount),
             frequency = COALESCE($4, frequency),
             end_date = COALESCE($5, end_date),
             status = COALESCE($6, status),
             next_billing_date = COALESCE($7, next_billing_date),
             updated_at = NOW()
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [plan_name, description, amount, frequency, end_date, status, next_billing_date, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'update', 'subscription', rows[0].id, rows[0].plan_name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating subscription:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/subscriptions/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM subscriptions WHERE id=$1 AND user_id=$2 RETURNING plan_name',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'subscription', req.params.id, rows[0].plan_name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Vendors ──────────────────────────────────────────────────────

router.get('/vendors', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM vendors WHERE user_id=$1 ORDER BY name ASC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/vendors', auth, async (req, res) => {
  const { name, email, phone, address, city, state, postal_code, country, tax_number, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO vendors (user_id, name, email, phone, address, city, state, postal_code, country, tax_number, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, name.trim(), email || null, phone || null, address || null, city || null, state || null, postal_code || null, country || null, tax_number || null, notes || null]
    );
    logAction(req.user.id, req.user.email, 'create', 'vendor', rows[0].id, rows[0].name);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/vendors/:id', auth, async (req, res) => {
  const { name, email, phone, address, city, state, postal_code, country, tax_number, notes } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE vendors
         SET name = COALESCE($1, name),
             email = COALESCE($2, email),
             phone = COALESCE($3, phone),
             address = COALESCE($4, address),
             city = COALESCE($5, city),
             state = COALESCE($6, state),
             postal_code = COALESCE($7, postal_code),
             country = COALESCE($8, country),
             tax_number = COALESCE($9, tax_number),
             notes = COALESCE($10, notes),
             updated_at = NOW()
       WHERE id = $11 AND user_id = $12
       RETURNING *`,
      [name, email, phone, address, city, state, postal_code, country, tax_number, notes, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'update', 'vendor', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/vendors/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM vendors WHERE id=$1 AND user_id=$2 RETURNING name',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'vendor', req.params.id, rows[0].name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Expenses ─────────────────────────────────────────────────────

router.get('/expenses', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, v.name AS vendor_name
       FROM expenses e
       LEFT JOIN vendors v ON v.id = e.vendor_id
       WHERE e.user_id=$1
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/expenses', auth, async (req, res) => {
  const { vendor_id, category, description, amount, tax_amount, currency, expense_date, receipt_url, billable, notes } = req.body || {};
  if (!description || !description.trim()) return res.status(400).json({ error: 'Description is required' });
  if (amount == null || isNaN(Number(amount))) return res.status(400).json({ error: 'Valid amount is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO expenses (user_id, vendor_id, category, description, amount, tax_amount, currency, expense_date, receipt_url, billable, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, vendor_id || null, category || null, description.trim(), amount, tax_amount || 0, currency || 'USD', expense_date || new Date().toISOString().slice(0, 10), receipt_url || null, billable || false, notes || null]
    );
    logAction(req.user.id, req.user.email, 'create', 'expense', rows[0].id, rows[0].description);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/expenses/:id', auth, async (req, res) => {
  const { vendor_id, category, description, amount, tax_amount, currency, expense_date, receipt_url, billable, notes } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE expenses
         SET vendor_id = COALESCE($1, vendor_id),
             category = COALESCE($2, category),
             description = COALESCE($3, description),
             amount = COALESCE($4, amount),
             tax_amount = COALESCE($5, tax_amount),
             currency = COALESCE($6, currency),
             expense_date = COALESCE($7, expense_date),
             receipt_url = COALESCE($8, receipt_url),
             billable = COALESCE($9, billable),
             notes = COALESCE($10, notes),
             updated_at = NOW()
       WHERE id = $11 AND user_id = $12
       RETURNING *`,
      [vendor_id, category, description, amount, tax_amount, currency, expense_date, receipt_url, billable !== undefined ? billable : null, notes, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'update', 'expense', rows[0].id, rows[0].description);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/expenses/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM expenses WHERE id=$1 AND user_id=$2 RETURNING description',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'expense', req.params.id, rows[0].description);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Expense Categories ───────────────────────────────────────────

router.get('/expense-categories', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM expense_categories WHERE user_id=$1 ORDER BY name ASC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/expense-categories', auth, async (req, res) => {
  const { name, color } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO expense_categories (user_id, name, color) VALUES ($1,$2,$3) RETURNING *',
      [req.user.id, name.trim(), color || '#6B7280']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/expense-categories/:id', auth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM expense_categories WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Products (Item Library) ─────────────────────────────────────

router.get('/products/all', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM products WHERE user_id=$1 ORDER BY name ASC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/products', auth, async (req, res) => {
  const { name, description, sku, cost, price, tax_rate, unit } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (user_id, name, description, sku, cost, price, tax_rate, unit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, name.trim(), description || null, sku || null, cost || 0, price || 0, tax_rate || 0, unit || 'item']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/products/:id', auth, async (req, res) => {
  const { name, description, sku, cost, price, tax_rate, unit } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE products
         SET name=COALESCE($1,name), description=COALESCE($2,description), sku=COALESCE($3,sku),
             cost=COALESCE($4,cost), price=COALESCE($5,price), tax_rate=COALESCE($6,tax_rate),
             unit=COALESCE($7,unit), updated_at=NOW()
       WHERE id=$8 AND user_id=$9 RETURNING *`,
      [name, description, sku, cost, price, tax_rate, unit, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/products/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM products WHERE id=$1 AND user_id=$2 RETURNING name',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Invoice Payments (Partial Payments) ─────────────────────────

router.get('/:id/payments', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM invoice_payments WHERE invoice_id=$1 ORDER BY payment_date DESC, created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/payments', auth, async (req, res) => {
  const { amount, payment_date, method, transaction_id, notes } = req.body || {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than 0' });
  try {
    // Verify invoice exists and belongs to user
    const invRes = await pool.query(
      'SELECT * FROM invoices WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!invRes.rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const { rows } = await pool.query(
      `INSERT INTO invoice_payments (invoice_id, amount, payment_date, method, transaction_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, amount, payment_date || new Date().toISOString().slice(0,10), method || 'other', transaction_id || null, notes || null]
    );

    // Auto-update invoice status if fully paid
    const lineTotal = (items) => items.reduce((sum, item) => {
      const gross = Number(item.quantity || 0) * Number(item.rate || 0);
      const discounted = gross * (1 - Number(item.discount || 0) / 100);
      return sum + discounted * (1 + Number(item.tax || 0) / 100);
    }, 0);
    const total = lineTotal(invRes.rows[0].line_items || []);
    const payRes = await pool.query(
      'SELECT COALESCE(SUM(amount),0) AS paid FROM invoice_payments WHERE invoice_id=$1',
      [req.params.id]
    );
    const paid = Number(payRes.rows[0].paid);
    if (paid >= total && invRes.rows[0].status !== 'paid') {
      await pool.query(
        `UPDATE invoices SET status='paid', paid_at=NOW() WHERE id=$1`,
        [req.params.id]
      );
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/payments/:paymentId', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM invoice_payments
       WHERE id=$1 AND invoice_id=$2
       AND invoice_id IN (SELECT id FROM invoices WHERE id=$2 AND user_id=$3)
       RETURNING id`,
      [req.params.paymentId, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Payment not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Invoice Templates ────────────────────────────────────────────

router.get('/templates/all', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, is_default, created_at
       FROM invoice_templates
       WHERE user_id=$1 OR user_id IS NULL
       ORDER BY is_default DESC, name ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/templates/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM invoice_templates WHERE id=$1 AND (user_id=$2 OR user_id IS NULL)`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/templates', auth, async (req, res) => {
  const { name, html_template, css, is_default } = req.body || {};
  if (!name || !html_template) return res.status(400).json({ error: 'Name and HTML template are required' });
  try {
    if (is_default) {
      await pool.query(`UPDATE invoice_templates SET is_default=FALSE WHERE user_id=$1`, [req.user.id]);
    }
    const { rows } = await pool.query(
      `INSERT INTO invoice_templates (name, html_template, css, is_default, user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name.trim(), html_template, css || null, is_default || false, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/templates/:id', auth, async (req, res) => {
  const { name, html_template, css, is_default } = req.body || {};
  try {
    if (is_default) {
      await pool.query(`UPDATE invoice_templates SET is_default=FALSE WHERE user_id=$1`, [req.user.id]);
    }
    const { rows } = await pool.query(
      `UPDATE invoice_templates
         SET name=COALESCE($1,name),
             html_template=COALESCE($2,html_template),
             css=COALESCE($3,css),
             is_default=COALESCE($4,is_default)
       WHERE id=$5 AND (user_id=$6 OR user_id IS NULL)
       RETURNING *`,
      [name, html_template, css, is_default, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/templates/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM invoice_templates WHERE id=$1 AND user_id=$2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
