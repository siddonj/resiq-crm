-- Migration 031: Phase 21 Slice 8 - Data quality merge operations

CREATE TABLE IF NOT EXISTS data_quality_merge_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issue_id UUID REFERENCES data_quality_issues(id) ON DELETE SET NULL,
  primary_lead_id UUID REFERENCES outbound_leads(id) ON DELETE SET NULL,
  merged_lead_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  merged_lead_count INTEGER NOT NULL DEFAULT 0,
  field_updates JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_data_quality_merge_operations_count CHECK (merged_lead_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_data_quality_merge_operations_user_created
  ON data_quality_merge_operations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_quality_merge_operations_primary_lead
  ON data_quality_merge_operations(user_id, primary_lead_id, created_at DESC);
