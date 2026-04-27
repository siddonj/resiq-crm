-- Migration 028: Phase 21 Slice 5 - Attribution lineage and source ROI

CREATE TABLE IF NOT EXISTS attribution_touchpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_event_id UUID UNIQUE REFERENCES lead_source_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES outbound_leads(id) ON DELETE CASCADE,
  source_type VARCHAR(30) NOT NULL,
  source_reference TEXT,
  campaign_id UUID REFERENCES outbound_campaigns(id) ON DELETE SET NULL,
  sequence_id UUID REFERENCES sequences(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  attribution_stage VARCHAR(30) NOT NULL,
  channel VARCHAR(20),
  touch_weight NUMERIC(6,4) NOT NULL DEFAULT 1,
  attributed_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_attribution_touchpoints_source_type CHECK (source_type IN ('csv', 'manual', 'api', 'other')),
  CONSTRAINT chk_attribution_touchpoints_stage CHECK (
    attribution_stage IN ('imported', 'contacted', 'replied', 'meeting', 'opportunity', 'sequence')
  ),
  CONSTRAINT chk_attribution_touchpoints_channel CHECK (
    channel IS NULL OR channel IN ('email', 'linkedin')
  ),
  CONSTRAINT chk_attribution_touchpoints_weight CHECK (touch_weight >= 0),
  CONSTRAINT chk_attribution_touchpoints_value CHECK (attributed_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_attribution_touchpoints_user_occurred
  ON attribution_touchpoints(user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_attribution_touchpoints_source
  ON attribution_touchpoints(user_id, source_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_attribution_touchpoints_sequence
  ON attribution_touchpoints(user_id, sequence_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_attribution_touchpoints_campaign
  ON attribution_touchpoints(user_id, campaign_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_attribution_touchpoints_stage
  ON attribution_touchpoints(user_id, attribution_stage, occurred_at DESC);
