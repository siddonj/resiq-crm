const pool = require('../models/db');
const gmailService = require('../services/gmail');

const REMINDER_OFFSETS = [3, 7, 14];

function invoiceTotal(lineItems) {
  if (!lineItems) return 0;
  const items = typeof lineItems === 'string' ? JSON.parse(lineItems) : lineItems;
  return items.reduce((sum, item) => {
    const gross = Number(item.quantity || 1) * Number(item.rate || item.unit_price || 0);
    const discounted = gross * (1 - Number(item.discount || 0) / 100);
    return sum + discounted * (1 + Number(item.tax || 0) / 100);
  }, 0);
}

function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildReminderEmail(invoice, dayOffset) {
  const total = invoiceTotal(invoice.line_items);
  const dueDate = invoice.due_date
    ? new Date(invoice.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'N/A';
  const greeting = invoice.contact_name ? `Hi ${invoice.contact_name},` : 'Hello,';
  const overdueDays = dayOffset === 0 ? '' : `<p style="color:#dc2626;font-size:14px;margin:0 0 16px;">This invoice is now <strong>${dayOffset} day${dayOffset !== 1 ? 's' : ''} overdue</strong>.</p>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#374151;max-width:600px;margin:0 auto;padding:32px 24px;">
  <p style="font-size:16px;margin:0 0 16px;">${greeting}</p>
  <p style="font-size:14px;margin:0 0 16px;">
    This is a friendly reminder that the following invoice remains unpaid:
  </p>
  ${overdueDays}
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:0 0 24px;">
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Invoice</p>
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#111827;">${invoice.invoice_number}</p>
    <p style="margin:0 0 4px;font-size:14px;color:#374151;">${invoice.title}</p>
    <p style="margin:0 0 4px;font-size:14px;color:#6b7280;">Due: ${dueDate}</p>
    <p style="margin:0;font-size:20px;font-weight:700;color:#111827;">Amount: ${formatMoney(total)}</p>
  </div>
  <p style="font-size:14px;color:#6b7280;margin:0 0 8px;">
    If you have already made payment, please disregard this message. Otherwise, please arrange payment at your earliest convenience.
  </p>
  <p style="font-size:14px;color:#6b7280;margin:0;">
    If you have any questions, please don't hesitate to reach out.
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="font-size:12px;color:#9ca3af;margin:0;">This is an automated reminder.</p>
</body>
</html>`;
}

async function processInvoiceReminders() {
  console.log('[InvoiceReminder] Running invoice reminder check...');

  let invoices;
  try {
    const result = await pool.query(`
      SELECT i.*, c.email AS contact_email, c.name AS contact_name, u.id AS owner_user_id
      FROM invoices i
      LEFT JOIN deals d ON d.id = i.deal_id
      LEFT JOIN contacts c ON c.id = COALESCE(i.contact_id, d.contact_id)
      LEFT JOIN users u ON u.id = i.user_id
      WHERE i.reminders_enabled = true
        AND i.status IN ('sent', 'overdue')
        AND i.due_date < NOW()
        AND i.paid_at IS NULL
    `);
    invoices = result.rows;
  } catch (err) {
    console.error('[InvoiceReminder] Failed to query invoices:', err.message);
    return;
  }

  console.log(`[InvoiceReminder] Found ${invoices.length} invoice(s) with reminders enabled`);

  for (const invoice of invoices) {
    if (!invoice.contact_email) {
      console.log(`[InvoiceReminder] Invoice ${invoice.invoice_number} has no contact email, skipping`);
      continue;
    }

    // Calculate how many days past due this invoice is
    const dueDate = new Date(invoice.due_date);
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysPastDue = Math.floor((now - dueDate) / msPerDay);

    for (const offset of REMINDER_OFFSETS) {
      if (daysPastDue < offset) continue;

      // Check if reminder already sent for this offset
      let alreadySent;
      try {
        const check = await pool.query(
          'SELECT 1 FROM invoice_reminders WHERE invoice_id = $1 AND day_offset = $2',
          [invoice.id, offset]
        );
        alreadySent = check.rowCount > 0;
      } catch (err) {
        console.error(`[InvoiceReminder] DB check failed for invoice ${invoice.id} offset ${offset}:`, err.message);
        continue;
      }

      if (alreadySent) continue;

      const subject = `Friendly reminder: Invoice ${invoice.invoice_number} is overdue`;
      const htmlBody = buildReminderEmail(invoice, offset);

      // Send via Gmail
      try {
        await gmailService.sendEmail(invoice.user_id, invoice.contact_email, subject, htmlBody);
        console.log(`[InvoiceReminder] Sent day+${offset} reminder for invoice ${invoice.invoice_number} to ${invoice.contact_email}`);
      } catch (err) {
        console.error(`[InvoiceReminder] Failed to send email for invoice ${invoice.invoice_number}:`, err.message);
        continue;
      }

      // Record the reminder
      try {
        await pool.query(
          `INSERT INTO invoice_reminders (invoice_id, day_offset, email_subject, status)
           VALUES ($1, $2, $3, 'sent')
           ON CONFLICT (invoice_id, day_offset) DO NOTHING`,
          [invoice.id, offset, subject]
        );
      } catch (err) {
        console.error(`[InvoiceReminder] Failed to record reminder for invoice ${invoice.invoice_number}:`, err.message);
      }

      // Log to activities if contact is linked
      try {
        const contactId = invoice.contact_id || null;
        if (contactId) {
          await pool.query(
            `INSERT INTO activities (user_id, contact_id, type, description, occurred_at)
             VALUES ($1, $2, 'email_sent', $3, NOW())`,
            [
              invoice.user_id,
              contactId,
              `Invoice reminder sent: ${invoice.invoice_number} (day +${offset})`,
            ]
          );
        }
      } catch (err) {
        // Non-fatal: activities table may not have this shape
        console.warn(`[InvoiceReminder] Could not log activity for invoice ${invoice.invoice_number}:`, err.message);
      }
    }
  }

  console.log('[InvoiceReminder] Check complete.');
}

let reminderInterval = null;

function startInvoiceReminderWorker() {
  console.log('[InvoiceReminder] Starting invoice reminder worker (hourly)');

  // Run immediately on start, then every hour
  processInvoiceReminders().catch(err =>
    console.error('[InvoiceReminder] Initial run error:', err.message)
  );

  reminderInterval = setInterval(() => {
    processInvoiceReminders().catch(err =>
      console.error('[InvoiceReminder] Interval run error:', err.message)
    );
  }, 60 * 60 * 1000); // 1 hour
}

process.on('SIGTERM', () => {
  if (reminderInterval) clearInterval(reminderInterval);
});

module.exports = {
  startInvoiceReminderWorker,
  processInvoiceReminders,
};
