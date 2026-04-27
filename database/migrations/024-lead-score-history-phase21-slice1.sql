-- Migration 024: Lead score history for Phase 21 slice 1 (scoring explainability)

CREATE TABLE IF NOT EXISTS lead_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES outbound_leads(id) ON DELETE CASCADE,
  fit_score INTEGER NOT NULL DEFAULT 0,
  intent_score INTEGER NOT NULL DEFAULT 0,
  engagement_score INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL,
  next_recommended_action TEXT,
  reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  source VARCHAR(40) NOT NULL DEFAULT 'manual_rescore',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_lead_score_history_fit CHECK (fit_score BETWEEN 0 AND 100),
  CONSTRAINT chk_lead_score_history_intent CHECK (intent_score BETWEEN 0 AND 100),
  CONSTRAINT chk_lead_score_history_engagement CHECK (engagement_score BETWEEN 0 AND 100),
  CONSTRAINT chk_lead_score_history_total CHECK (total_score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_lead_score_history_user_lead_created
  ON lead_score_history(user_id, lead_id, created_at DESC);
