-- Phase 4: Invoice Templates + Multi-Gateway Payments

CREATE TABLE IF NOT EXISTS invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  html_template TEXT NOT NULL,
  css TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed a default template
INSERT INTO invoice_templates (name, html_template, css, is_default)
VALUES (
  'Standard',
  '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>{{invoice_number}}</title><style>{{css}}</style></head>
<body>
<div class="invoice-box">
  <div class="header">
    <h1>INVOICE</h1>
    <div class="company">{{company_name}}</div>
  </div>
  <div class="meta">
    <div><strong>Invoice #:</strong> {{invoice_number}}</div>
    <div><strong>Date:</strong> {{date}}</div>
    <div><strong>Due:</strong> {{due_date}}</div>
    <div><strong>Status:</strong> {{status}}</div>
  </div>
  <div class="bill-to">
    <strong>Bill To:</strong><br>
    {{client_name}}<br>
    {{client_email}}<br>
    {{client_address}}
  </div>
  <table class="items">
    <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax</th><th>Disc</th><th>Amount</th></tr></thead>
    <tbody>{{line_items}}</tbody>
  </table>
  <div class="totals">
    <div>Subtotal: {{subtotal}}</div>
    <div>Tax: {{tax}}</div>
    <div>Discount: {{discount}}</div>
    <div class="total">Total: {{total}}</div>
    <div class="paid">Paid: {{paid}}</div>
    <div class="balance">Balance Due: {{balance}}</div>
  </div>
  <div class="notes">{{notes}}</div>
</div>
</body>
</html>',
  '.invoice-box{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px;color:#333}
.header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0d3b66;padding-bottom:20px;margin-bottom:30px}
.header h1{color:#0d3b66;margin:0}
.company{font-size:14px;color:#666}
.meta{display:flex;gap:30px;margin-bottom:30px;font-size:13px}
.bill-to{margin-bottom:30px;font-size:13px;line-height:1.6}
.items{width:100%;border-collapse:collapse;margin-bottom:30px;font-size:13px}
.items th{background:#f5f5f5;padding:10px;text-align:left;border-bottom:2px solid #ddd}
.items td{padding:10px;border-bottom:1px solid #eee}
.items td:last-child,.items th:last-child{text-align:right}
.totals{text-align:right;font-size:14px;line-height:1.8}
.totals .total{font-size:18px;font-weight:bold;color:#0d3b66}
.totals .paid{color:#28a745}
.totals .balance{font-weight:bold;color:#dc3545}
.notes{margin-top:30px;padding-top:20px;border-top:1px solid #eee;font-size:12px;color:#666;white-space:pre-line}',
  TRUE
)
ON CONFLICT DO NOTHING;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES invoice_templates(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_gateway TEXT DEFAULT 'stripe';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gateway_data JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_invoice_templates_user ON invoice_templates(user_id);
