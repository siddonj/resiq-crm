-- Migration 029: Phase 21 Slice 6 - Data quality command center and guardrails

CREATE TABLE IF NOT EXISTS data_quality_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES outbound_leads(id) ON DELETE CASCADE,
  issue_type VARCHAR(60) NOT NULL,
  issue_key TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  is_blocking BOOLEAN NOT NULL DEFAULT FALSE,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_data_quality_issue_type CHECK (
    issue_type IN (
      'missing_contact_channel',
      'missing_company',
      'missing_title',
      'low_source_confidence',
      'stale_lead',
      'potential_duplicate'
    )
  ),
  CONSTRAINT chk_data_quality_issue_severity CHECK (severity IN ('low', 'medium', 'high')),
  CONSTRAINT chk_data_quality_issue_status CHECK (status IN ('open', 'resolved', 'dismissed')),
  CONSTRAINT uq_data_quality_issues_user_key UNIQUE (user_id, issue_key)
);

CREATE INDEX IF NOT EXISTS idx_data_quality_issues_user_status
  ON data_quality_issues(user_id, status, severity, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_quality_issues_lead
  ON data_quality_issues(user_id, lead_id, status);
