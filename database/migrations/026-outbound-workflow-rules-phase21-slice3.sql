-- Migration 026: Phase 21 Slice 3 - Outbound workflow rules engine scaffold

CREATE TABLE IF NOT EXISTS workflow_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_event TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  true_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  false_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_workflow_rules_priority CHECK (priority >= 0 AND priority <= 1000),
  CONSTRAINT uq_workflow_rules_user_name UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_rules_user_enabled_trigger
  ON workflow_rules(user_id, enabled, trigger_event, priority);

CREATE TABLE IF NOT EXISTS workflow_rule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES workflow_rules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_source TEXT NOT NULL DEFAULT 'manual_test',
  input_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  matched BOOLEAN,
  status TEXT NOT NULL DEFAULT 'success',
  actions_executed JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_workflow_rule_runs_status CHECK (status IN ('success', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_rule_runs_rule_created
  ON workflow_rule_runs(rule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_rule_runs_user_created
  ON workflow_rule_runs(user_id, created_at DESC);
