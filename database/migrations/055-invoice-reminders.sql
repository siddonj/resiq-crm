ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS invoice_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  day_offset INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'sent',
  email_subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(invoice_id, day_offset)
);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice_id ON invoice_reminders(invoice_id);
