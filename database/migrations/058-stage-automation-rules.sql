-- Migration 058: Deal stage automation rules
-- User-configurable rules: per pipeline stage, define inactivity threshold + email template.
-- When a deal sits in a stage with no activity for N days, auto-create a follow-up task.

CREATE TABLE IF NOT EXISTS stage_automation_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage            TEXT NOT NULL,
  inactivity_days  INTEGER NOT NULL DEFAULT 7,
  rule_name        TEXT NOT NULL,
  email_template   TEXT NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stage_automation_rules_user ON stage_automation_rules(user_id);

-- Add rule_id to deal_followup_tasks to track which automation rule created each task
ALTER TABLE deal_followup_tasks ADD COLUMN IF NOT EXISTS rule_id UUID REFERENCES stage_automation_rules(id) ON DELETE CASCADE;

-- Partial unique index: one pending task per (deal, rule) — avoids duplicate pending tasks
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_followup_rule
  ON deal_followup_tasks(deal_id, rule_id)
  WHERE rule_id IS NOT NULL AND status = 'pending';

-- Exclude individual deals from automation
ALTER TABLE deals ADD COLUMN IF NOT EXISTS exclude_from_automation BOOLEAN NOT NULL DEFAULT false;
