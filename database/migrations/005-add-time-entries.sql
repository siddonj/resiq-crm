-- Migration: Add time_entries table
-- Phase 12: Time Tracking

CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  minutes INTEGER NOT NULL DEFAULT 0,
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  billable BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_deal_id ON time_entries(deal_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_contact_id ON time_entries(contact_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);

GRANT SELECT, INSERT, UPDATE, DELETE ON time_entries TO resiq;
