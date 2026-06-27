const express = require('express');
const { db, sql, pool } = require('../db');
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
  const conditions = [sql`i.user_id = ${req.user.id}`];

  if (status) conditions.push(sql`i.status = ${status}`);
  if (deal_id) conditions.push(sql`i.deal_id = ${deal_id}`);
  if (proposal_id) conditions.push(sql`i.proposal_id = ${proposal_id}`);

  try {
    const result = await sql`
      SELECT i.*,
        d.title AS deal_title,
        c.name AS contact_name,
        p.title AS proposal_title
      FROM invoices i
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN proposals p ON p.id = i.proposal_id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY i.created_at DESC
    `.execute(db);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single invoice
router.get('/:id', auth, async (req, res) => {
  try {
    const [invoice] = await sql`
      SELECT i.*, d.title AS deal_title, c.name AS contact_name, p.title AS proposal_title
      FROM invoices i
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN proposals p ON p.id = i.proposal_id
      WHERE i.id = ${req.params.id} AND i.user_id = ${req.user.id}
    `.execute(db).then(r => r.rows);
    if (!invoice) return res.status(404).json({ error: 'Not found' });

    // Load payments
    let payments = [];
    try {
      const { rows } = await sql`
        SELECT * FROM invoice_payments WHERE invoice_id = ${req.params.id} ORDER BY payment_date DESC, created_at DESC
      `.execute(db);
      payments = rows;
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
  const { title, deal_id, proposal_id, line_items, notes, due_date, template_id, payment_gateway, invoice_type, recurring_cadence } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  try {
    // Generate invoice number
    const seqResult = await sql`SELECT nextval('invoice_number_seq') AS num`.execute(db);
    const invoice_number = `INV-${seqResult.rows[0].num}`;

    const invoice = await db.insertInto('invoices')
      .values({
        user_id: req.user.id,
        deal_id: deal_id || null,
        proposal_id: proposal_id || null,
        invoice_number,
        title,
        line_items: JSON.stringify(line_items || []),
        notes: notes || null,
        due_date: due_date || null,
        template_id: template_id || null,
        payment_gateway: payment_gateway || 'stripe',
        invoice_type: invoice_type || 'one_time',
        recurring_cadence: recurring_cadence || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

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
    const result = await db.updateTable('invoices')
      .set({
        title,
        deal_id: deal_id || null,
        proposal_id: proposal_id || null,
        line_items: JSON.stringify(line_items || []),
        notes: notes || null,
        due_date: due_date || null,
        template_id: template_id || null,
        payment_gateway: payment_gateway || 'stripe',
        updated_at: sql`NOW()`,
      })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .where('status', '=', 'draft')
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found or not editable' });
    logAction(req.user.id, req.user.email, 'update', 'invoice', req.params.id, result.title);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Change status
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['draft', 'sent', 'paid', 'overdue'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const updateData = { status, updated_at: sql`NOW()` };
  if (status === 'sent') updateData.sent_at = sql`NOW()`;
  if (status === 'paid') updateData.paid_at = sql`NOW()`;

  try {
    const result = await db.updateTable('invoices')
      .set(updateData)
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'status_change', 'invoice', req.params.id, result.title, { status });

    // Auto-create overdue reminder when sent
    if (status === 'sent' && result.due_date) {
      try {
        await db.insertInto('reminders')
          .values({
            user_id: req.user.id,
            title: `Invoice overdue: ${result.title}`,
            due_date: result.due_date,
            related_type: 'invoice',
            related_id: result.id,
          })
          .execute();
      } catch (_) { /* non-fatal */ }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Set Stripe payment URL
router.patch('/:id/payment-url', auth, async (req, res) => {
  const { stripe_payment_url } = req.body;
  try {
    const result = await db.updateTable('invoices')
      .set({
        stripe_payment_url: stripe_payment_url || null,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete invoice
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await db.deleteFrom('invoices')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('title')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'invoice', req.params.id, result.title);
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
    const { rows } = await sql`
      SELECT ri.*, c.name AS contact_name, d.title AS deal_title
      FROM recurring_invoices ri
      LEFT JOIN contacts c ON c.id = ri.contact_id
      LEFT JOIN deals d ON d.id = ri.deal_id
      WHERE ri.user_id = ${req.user.id}
      ORDER BY ri.next_send_date ASC
    `.execute(db);
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
    const result = await db.insertInto('recurring_invoices')
      .values({
        user_id: req.user.id,
        deal_id: deal_id || null,
        contact_id: contact_id || null,
        title: title.trim(),
        frequency,
        start_date,
        end_date: end_date || null,
        next_send_date: start_date,
        line_items: JSON.stringify(line_items || []),
        notes: notes || null,
        due_days: due_days || 14,
        auto_send: auto_send || false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    logAction(req.user.id, req.user.email, 'create', 'recurring_invoice', result.id, result.title);
    res.status(201).json(result);
  } catch (err) {
    console.error('Error creating recurring invoice:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/recurring/:id', auth, async (req, res) => {
  const { title, deal_id, contact_id, frequency, end_date, line_items, notes, due_days, auto_send, status, next_send_date } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE recurring_invoices
         SET title = COALESCE(${title}, title),
             deal_id = COALESCE(${deal_id}, deal_id),
             contact_id = COALESCE(${contact_id}, contact_id),
             frequency = COALESCE(${frequency}, frequency),
             end_date = COALESCE(${end_date}, end_date),
             line_items = COALESCE(${line_items !== undefined ? JSON.stringify(line_items) : null}, line_items),
             notes = COALESCE(${notes}, notes),
             due_days = COALESCE(${due_days}, due_days),
             auto_send = COALESCE(${auto_send}, auto_send),
             status = COALESCE(${status}, status),
             next_send_date = COALESCE(${next_send_date}, next_send_date),
             updated_at = NOW()
      WHERE id = ${req.params.id} AND user_id = ${req.user.id}
      RETURNING *
    `.execute(db);
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
    const result = await db.deleteFrom('recurring_invoices')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('title')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'recurring_invoice', req.params.id, result.title);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting recurring invoice:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Generate invoice from recurring invoice
router.post('/recurring/:id/generate', auth, async (req, res) => {
  try {
    const riRows = await sql`
      SELECT * FROM recurring_invoices WHERE id = ${req.params.id} AND user_id = ${req.user.id}
    `.execute(db).then(r => r.rows);
    if (!riRows[0]) return res.status(404).json({ error: 'Recurring invoice not found' });
    const ri = riRows[0];

    // Generate invoice number
    const seqResult = await sql`SELECT nextval('invoice_number_seq') AS num`.execute(db);
    const invoice_number = `INV-${seqResult.rows[0].num}`;

    // Calculate due date
    const dueDate = ri.due_days ? addDays(ri.next_send_date, ri.due_days) : null;

    const invoice = await db.insertInto('invoices')
      .values({
        user_id: req.user.id,
        deal_id: ri.deal_id,
        invoice_number,
        title: ri.title,
        line_items: JSON.stringify(ri.line_items),
        notes: ri.notes,
        due_date: dueDate,
        status: 'draft',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Log generation
    await db.insertInto('recurring_invoice_logs')
      .values({
        recurring_invoice_id: ri.id,
        invoice_id: invoice.id,
        status: 'generated',
      })
      .execute();

    // Advance next_send_date
    const newNext = nextDate(ri.next_send_date, ri.frequency);
    let newStatus = ri.status;
    if (ri.end_date && newNext > ri.end_date) newStatus = 'completed';
    await db.updateTable('recurring_invoices')
      .set({
        next_send_date: newNext,
        status: newStatus,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', ri.id)
      .execute();

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
    const { rows } = await sql`
      SELECT s.*, c.name AS contact_name
      FROM subscriptions s
      LEFT JOIN contacts c ON c.id = s.contact_id
      WHERE s.user_id = ${req.user.id}
      ORDER BY s.next_billing_date ASC
    `.execute(db);
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
    const result = await db.insertInto('subscriptions')
      .values({
        user_id: req.user.id,
        contact_id,
        plan_name: plan_name.trim(),
        description: description || null,
        amount,
        frequency,
        start_date,
        end_date: end_date || null,
        next_billing_date: start_date,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    logAction(req.user.id, req.user.email, 'create', 'subscription', result.id, result.plan_name);
    res.status(201).json(result);
  } catch (err) {
    console.error('Error creating subscription:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/subscriptions/:id', auth, async (req, res) => {
  const { plan_name, description, amount, frequency, end_date, status, next_billing_date } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE subscriptions
         SET plan_name = COALESCE(${plan_name}, plan_name),
             description = COALESCE(${description}, description),
             amount = COALESCE(${amount}, amount),
             frequency = COALESCE(${frequency}, frequency),
             end_date = COALESCE(${end_date}, end_date),
             status = COALESCE(${status}, status),
             next_billing_date = COALESCE(${next_billing_date}, next_billing_date),
             updated_at = NOW()
      WHERE id = ${req.params.id} AND user_id = ${req.user.id}
      RETURNING *
    `.execute(db);
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
    const result = await db.deleteFrom('subscriptions')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('plan_name')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'subscription', req.params.id, result.plan_name);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting subscription:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Vendors ──────────────────────────────────────────────────────

router.get('/vendors', auth, async (req, res) => {
  try {
    const rows = await db.selectFrom('vendors')
      .selectAll()
      .where('user_id', '=', req.user.id)
      .orderBy('name', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/vendors', auth, async (req, res) => {
  const { name, email, phone, address, city, state, postal_code, country, tax_number, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await db.insertInto('vendors')
      .values({
        user_id: req.user.id,
        name: name.trim(),
        email: email || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        postal_code: postal_code || null,
        country: country || null,
        tax_number: tax_number || null,
        notes: notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    logAction(req.user.id, req.user.email, 'create', 'vendor', result.id, result.name);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/vendors/:id', auth, async (req, res) => {
  const { name, email, phone, address, city, state, postal_code, country, tax_number, notes } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE vendors
         SET name = COALESCE(${name}, name),
             email = COALESCE(${email}, email),
             phone = COALESCE(${phone}, phone),
             address = COALESCE(${address}, address),
             city = COALESCE(${city}, city),
             state = COALESCE(${state}, state),
             postal_code = COALESCE(${postal_code}, postal_code),
             country = COALESCE(${country}, country),
             tax_number = COALESCE(${tax_number}, tax_number),
             notes = COALESCE(${notes}, notes),
             updated_at = NOW()
      WHERE id = ${req.params.id} AND user_id = ${req.user.id}
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'update', 'vendor', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/vendors/:id', auth, async (req, res) => {
  try {
    const result = await db.deleteFrom('vendors')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('name')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'vendor', req.params.id, result.name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Expenses ─────────────────────────────────────────────────────

router.get('/expenses', auth, async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT e.*, v.name AS vendor_name
      FROM expenses e
      LEFT JOIN vendors v ON v.id = e.vendor_id
      WHERE e.user_id=${req.user.id}
      ORDER BY e.expense_date DESC, e.created_at DESC
    `.execute(db);
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
    const result = await db.insertInto('expenses')
      .values({
        user_id: req.user.id,
        vendor_id: vendor_id || null,
        category: category || null,
        description: description.trim(),
        amount,
        tax_amount: tax_amount || 0,
        currency: currency || 'USD',
        expense_date: expense_date || new Date().toISOString().slice(0, 10),
        receipt_url: receipt_url || null,
        billable: billable || false,
        notes: notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    logAction(req.user.id, req.user.email, 'create', 'expense', result.id, result.description);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/expenses/:id', auth, async (req, res) => {
  const { vendor_id, category, description, amount, tax_amount, currency, expense_date, receipt_url, billable, notes } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE expenses
         SET vendor_id = COALESCE(${vendor_id}, vendor_id),
             category = COALESCE(${category}, category),
             description = COALESCE(${description}, description),
             amount = COALESCE(${amount}, amount),
             tax_amount = COALESCE(${tax_amount}, tax_amount),
             currency = COALESCE(${currency}, currency),
             expense_date = COALESCE(${expense_date}, expense_date),
             receipt_url = COALESCE(${receipt_url}, receipt_url),
             billable = COALESCE(${billable}, billable),
             notes = COALESCE(${notes}, notes),
             updated_at = NOW()
      WHERE id = ${req.params.id} AND user_id = ${req.user.id}
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'update', 'expense', rows[0].id, rows[0].description);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/expenses/:id', auth, async (req, res) => {
  try {
    const result = await db.deleteFrom('expenses')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('description')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'expense', req.params.id, result.description);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Expense Categories ───────────────────────────────────────────

router.get('/expense-categories', auth, async (req, res) => {
  try {
    const rows = await db.selectFrom('expense_categories')
      .selectAll()
      .where('user_id', '=', req.user.id)
      .orderBy('name', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/expense-categories', auth, async (req, res) => {
  const { name, color } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await db.insertInto('expense_categories')
      .values({
        user_id: req.user.id,
        name: name.trim(),
        color: color || '#6B7280',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/expense-categories/:id', auth, async (req, res) => {
  try {
    await db.deleteFrom('expense_categories')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .execute();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Products (Item Library) ─────────────────────────────────────

router.get('/products/all', auth, async (req, res) => {
  try {
    const rows = await db.selectFrom('products')
      .selectAll()
      .where('user_id', '=', req.user.id)
      .orderBy('name', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/products', auth, async (req, res) => {
  const { name, description, sku, cost, price, tax_rate, unit } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await db.insertInto('products')
      .values({
        user_id: req.user.id,
        name: name.trim(),
        description: description || null,
        sku: sku || null,
        cost: cost || 0,
        price: price || 0,
        tax_rate: tax_rate || 0,
        unit: unit || 'item',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/products/:id', auth, async (req, res) => {
  const { name, description, sku, cost, price, tax_rate, unit } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE products
         SET name=COALESCE(${name},name), description=COALESCE(${description},description), sku=COALESCE(${sku},sku),
             cost=COALESCE(${cost},cost), price=COALESCE(${price},price), tax_rate=COALESCE(${tax_rate},tax_rate),
             unit=COALESCE(${unit},unit), updated_at=NOW()
      WHERE id=${req.params.id} AND user_id=${req.user.id} RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/products/:id', auth, async (req, res) => {
  try {
    const result = await db.deleteFrom('products')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('name')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Product not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Invoice Payments (Partial Payments) ─────────────────────────

router.get('/:id/payments', auth, async (req, res) => {
  try {
    const rows = await db.selectFrom('invoice_payments')
      .selectAll()
      .where('invoice_id', '=', req.params.id)
      .orderBy('payment_date', 'desc')
      .orderBy('created_at', 'desc')
      .execute();
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
    const invRes = await db.selectFrom('invoices')
      .selectAll()
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!invRes) return res.status(404).json({ error: 'Invoice not found' });

    const payment = await db.insertInto('invoice_payments')
      .values({
        invoice_id: req.params.id,
        amount,
        payment_date: payment_date || new Date().toISOString().slice(0,10),
        method: method || 'other',
        transaction_id: transaction_id || null,
        notes: notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Auto-update invoice status if fully paid
    const lineTotal = (items) => items.reduce((sum, item) => {
      const gross = Number(item.quantity || 0) * Number(item.rate || 0);
      const discounted = gross * (1 - Number(item.discount || 0) / 100);
      return sum + discounted * (1 + Number(item.tax || 0) / 100);
    }, 0);
    const total = lineTotal(invRes.line_items || []);
    const payRes = await sql`
      SELECT COALESCE(SUM(amount),0) AS paid FROM invoice_payments WHERE invoice_id = ${req.params.id}
    `.execute(db);
    const paid = Number(payRes.rows[0].paid);
    if (paid >= total && invRes.status !== 'paid') {
      await db.updateTable('invoices')
        .set({ status: 'paid', paid_at: sql`NOW()` })
        .where('id', '=', req.params.id)
        .execute();
    }

    res.status(201).json(payment);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/payments/:paymentId', auth, async (req, res) => {
  try {
    const result = await sql`
      DELETE FROM invoice_payments
      WHERE id = ${req.params.paymentId} AND invoice_id = ${req.params.id}
      AND invoice_id IN (SELECT id FROM invoices WHERE id = ${req.params.id} AND user_id = ${req.user.id})
      RETURNING id
    `.execute(db).then(r => r.rows[0]);
    if (!result) return res.status(404).json({ error: 'Payment not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Invoice Templates ────────────────────────────────────────────

router.get('/templates/all', auth, async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT id, name, is_default, created_at
      FROM invoice_templates
      WHERE user_id = ${req.user.id} OR user_id IS NULL
      ORDER BY is_default DESC, name ASC
    `.execute(db);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/templates/:id', auth, async (req, res) => {
  try {
    const result = await sql`
      SELECT * FROM invoice_templates WHERE id = ${req.params.id} AND (user_id = ${req.user.id} OR user_id IS NULL)
    `.execute(db).then(r => r.rows[0]);
    if (!result) return res.status(404).json({ error: 'Template not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/templates', auth, async (req, res) => {
  const { name, html_template, css, is_default } = req.body || {};
  if (!name || !html_template) return res.status(400).json({ error: 'Name and HTML template are required' });
  try {
    if (is_default) {
      await db.updateTable('invoice_templates')
        .set({ is_default: false })
        .where('user_id', '=', req.user.id)
        .execute();
    }
    const result = await db.insertInto('invoice_templates')
      .values({
        name: name.trim(),
        html_template,
        css: css || null,
        is_default: is_default || false,
        user_id: req.user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/templates/:id', auth, async (req, res) => {
  const { name, html_template, css, is_default } = req.body || {};
  try {
    if (is_default) {
      await db.updateTable('invoice_templates')
        .set({ is_default: false })
        .where('user_id', '=', req.user.id)
        .execute();
    }
    const { rows } = await sql`
      UPDATE invoice_templates
         SET name=COALESCE(${name},name),
             html_template=COALESCE(${html_template},html_template),
             css=COALESCE(${css},css),
             is_default=COALESCE(${is_default},is_default)
      WHERE id=${req.params.id} AND (user_id=${req.user.id} OR user_id IS NULL)
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/templates/:id', auth, async (req, res) => {
  try {
    const result = await db.deleteFrom('invoice_templates')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('id')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Toggle reminders_enabled on an invoice
router.patch('/:id/reminders', auth, async (req, res) => {
  const { enabled } = req.body;
  try {
    const result = await db.updateTable('invoices')
      .set({ reminders_enabled: !!enabled, updated_at: sql`NOW()` })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get reminder history for an invoice
router.get('/:id/reminders', auth, async (req, res) => {
  try {
    const invoice = await db.selectFrom('invoices').select(['id'])
      .where('id', '=', req.params.id).where('user_id', '=', req.user.id)
      .executeTakeFirst();
    if (!invoice) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(
      'SELECT * FROM invoice_reminders WHERE invoice_id = $1 ORDER BY day_offset ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Manual one-click send reminder
router.post('/:id/reminders/send', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, c.email AS contact_email, c.name AS contact_name
       FROM invoices i
       LEFT JOIN deals d ON d.id = i.deal_id
       LEFT JOIN contacts c ON c.id = COALESCE(i.contact_id, d.contact_id)
       WHERE i.id = $1 AND i.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const invoice = result.rows[0];
    if (!invoice.contact_email) return res.status(400).json({ error: 'No contact email on file' });

    const gmailService = require('../services/gmail');
    const subject = `Friendly reminder: Invoice ${invoice.invoice_number} is outstanding`;
    const htmlBody = `<p>Hello${invoice.contact_name ? ` ${invoice.contact_name}` : ''},</p><p>This is a friendly reminder that invoice <strong>${invoice.invoice_number}</strong> — <em>${invoice.title}</em> — remains outstanding.</p><p>Please don't hesitate to reach out if you have any questions.</p>`;
    await gmailService.sendEmail(req.user.id, invoice.contact_email, subject, htmlBody);

    const minOffset = -(Date.now() % 1000000);
    await pool.query(
      `INSERT INTO invoice_reminders (invoice_id, day_offset, email_subject, status) VALUES ($1, $2, $3, 'sent') ON CONFLICT DO NOTHING`,
      [req.params.id, minOffset, subject]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Get unbilled time entries available to pull into an invoice
router.get('/:id/available-time-entries', auth, async (req, res) => {
  try {
    // Get invoice + resolve contact_id
    const [invoice] = await sql`
      SELECT i.*, COALESCE(i.contact_id, d.contact_id) AS resolved_contact_id
      FROM invoices i
      LEFT JOIN deals d ON d.id = i.deal_id
      WHERE i.id = ${req.params.id} AND i.user_id = ${req.user.id}
    `.execute(db).then(r => r.rows);

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const contactId = invoice.resolved_contact_id;
    const dealId = invoice.deal_id;

    // Default date range: last 90 days
    const defaultEnd = new Date();
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 90);

    const start = req.query.start || defaultStart.toISOString().slice(0, 10);
    const end = req.query.end || defaultEnd.toISOString().slice(0, 10);

    const { rows } = await sql`
      SELECT te.*, c.name AS contact_name,
             ROUND((te.minutes::numeric / 60), 2) AS hours
      FROM time_entries te
      LEFT JOIN contacts c ON c.id = te.contact_id
      WHERE te.user_id = ${req.user.id}
        AND te.billable = true
        AND te.billed = false
        AND (
          (${contactId}::uuid IS NOT NULL AND te.contact_id = ${contactId}::uuid)
          OR (${dealId}::uuid IS NOT NULL AND te.deal_id = ${dealId}::uuid)
        )
        AND te.date BETWEEN ${start}::date AND ${end}::date
      ORDER BY te.date DESC
    `.execute(db);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Pull selected time entries into an invoice as line items (atomic transaction)
router.post('/:id/pull-time-entries', auth, async (req, res) => {
  const { entry_ids } = req.body;
  if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
    return res.status(400).json({ error: 'entry_ids must be a non-empty array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get invoice (ownership check)
    const invResult = await client.query(
      'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (invResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const invoice = invResult.rows[0];

    // Fetch the matching unbilled time entries
    const placeholders = entry_ids.map((_, i) => `$${i + 2}`).join(', ');
    const teResult = await client.query(
      `SELECT * FROM time_entries WHERE id IN (${placeholders}) AND user_id = $1 AND billed = false`,
      [req.user.id, ...entry_ids]
    );
    const entries = teResult.rows;

    if (entries.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No eligible unbilled time entries found' });
    }

    // Map each time entry to an invoice line item
    const newLineItems = entries.map(te => ({
      id: Math.random().toString(36).slice(2),
      description: `${te.description || 'Time entry'} (${te.date ? new Date(te.date).toISOString().slice(0, 10) : ''})`,
      quantity: parseFloat((te.minutes / 60).toFixed(2)),
      rate: Number(te.hourly_rate) || 0,
      discount: 0,
      tax: 0,
    }));

    // Merge with existing line items
    const existingLineItems = Array.isArray(invoice.line_items) ? invoice.line_items : [];
    const mergedLineItems = [...existingLineItems, ...newLineItems];

    // Update invoice line_items
    await client.query(
      'UPDATE invoices SET line_items = $1::jsonb WHERE id = $2',
      [JSON.stringify(mergedLineItems), req.params.id]
    );

    // Mark time entries as billed
    const updatePlaceholders = entries.map((_, i) => `$${i + 3}`).join(', ');
    await client.query(
      `UPDATE time_entries SET billed = true, billed_invoice_id = $1 WHERE id IN (${updatePlaceholders}) AND user_id = $2`,
      [req.params.id, req.user.id, ...entries.map(e => e.id)]
    );

    await client.query('COMMIT');

    // Fetch updated invoice to return
    const [updated] = await sql`
      SELECT i.*, d.title AS deal_title, c.name AS contact_name
      FROM invoices i
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN contacts c ON c.id = COALESCE(i.contact_id, d.contact_id)
      WHERE i.id = ${req.params.id}
    `.execute(db).then(r => r.rows);

    logAction(req.user.id, req.user.email, 'pull_time_entries', 'invoice', req.params.id, invoice.title, { count: entries.length });
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
