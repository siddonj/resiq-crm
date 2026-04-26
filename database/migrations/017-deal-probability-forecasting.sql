-- Migration: Deal probability and forecasting
-- Adds probability tracking per deal and stage-level default probabilities

-- Add probability column to deals (0-100, null means use stage default)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS probability NUMERIC(5,2);

-- Table for user-defined default probability per stage
CREATE TABLE IF NOT EXISTS stage_probabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  probability NUMERIC(5,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, stage)
);

-- Seed default stage probabilities (0% for new, escalating to 100% for won)
-- Users can override these per their own history
INSERT INTO stage_probabilities (user_id, stage, probability)
SELECT id, 'lead', 10 FROM users
UNION ALL SELECT id, 'qualified', 25 FROM users
UNION ALL SELECT id, 'proposal', 50 FROM users
UNION ALL SELECT id, 'active', 75 FROM users
UNION ALL SELECT id, 'closed_won', 100 FROM users
UNION ALL SELECT id, 'closed_lost', 0 FROM users
ON CONFLICT (user_id, stage) DO NOTHING;
