-- Migration 020: Analytics deal updates
-- Adds updated_at column to deals for tracking last-modified time,
-- and a deal_stage_history table for deal velocity / time-in-stage metrics.

-- Add updated_at column to deals (used by win/loss & velocity calculations)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Back-fill updated_at for existing rows that don't have it set
UPDATE deals SET updated_at = created_at WHERE updated_at IS NULL;

-- Table to record every stage transition for a deal
CREATE TABLE IF NOT EXISTS deal_stage_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal_id  ON deal_stage_history(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_user_id  ON deal_stage_history(user_id);
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_changed  ON deal_stage_history(changed_at DESC);
