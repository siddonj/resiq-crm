-- Migration: Add Sequences for Drip Campaigns (Phase 18)

CREATE TABLE IF NOT EXISTS sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Steps in a sequence (emails, sms, delays)
CREATE TABLE IF NOT EXISTS sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_number INT NOT NULL,  -- Order of operations: 1, 2, 3...
  delay_days INT DEFAULT 0,  -- Days to wait BEFORE executing this step
  type TEXT NOT NULL,        -- 'email', 'sms'
  subject TEXT,              -- Subject line for email type
  body TEXT NOT NULL,        -- Main content of email or SMS
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Active or historical enrollments of contacts into sequences
CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active', -- 'active', 'paused', 'completed', 'error'
  current_step INT DEFAULT 1,
  next_step_due_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sequence_id, contact_id)
);
