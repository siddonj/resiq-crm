-- Migration 056: Proposal follow-up automation
-- Tracks last activity on a deal and auto-creates follow-up tasks
-- for deals stuck in the proposal stage without activity.

-- Add last_activity_at to deals for tracking inactivity
ALTER TABLE deals ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Table that holds auto-generated follow-up tasks per deal
CREATE TABLE IF NOT EXISTS deal_followup_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  day_offset    INTEGER NOT NULL,          -- 5 or 10 (days since last activity)
  task_body     TEXT NOT NULL,             -- human-readable task description
  email_draft   TEXT NOT NULL,             -- pre-drafted email body (HTML)
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','dismissed')),
  sent_at       TIMESTAMPTZ,
  dismissed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (deal_id, day_offset)
);

CREATE INDEX IF NOT EXISTS idx_deal_followup_tasks_deal_id ON deal_followup_tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_followup_tasks_status  ON deal_followup_tasks(status);
