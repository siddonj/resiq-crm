ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS billed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS billed_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_time_entries_billed ON time_entries(user_id, billed) WHERE billed = false;
