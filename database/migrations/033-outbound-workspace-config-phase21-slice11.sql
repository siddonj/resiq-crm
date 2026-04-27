-- Migration 033: Phase 21 Slice 11 - Workspace config, SLA escalations, and notifications

CREATE TABLE IF NOT EXISTS outbound_workspace_config (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL DEFAULT '',
  email_signature TEXT NOT NULL DEFAULT '',
  daily_email_limit INTEGER NOT NULL DEFAULT 50 CHECK (daily_email_limit BETWEEN 1 AND 500),
  daily_linkedin_limit INTEGER NOT NULL DEFAULT 20 CHECK (daily_linkedin_limit BETWEEN 1 AND 100),
  sla_draft_stale_hours INTEGER NOT NULL DEFAULT 24,
  sla_linkedin_overdue_hours INTEGER NOT NULL DEFAULT 24,
  sla_paused_stale_days INTEGER NOT NULL DEFAULT 3,
  sla_high_score_not_contacted_days INTEGER NOT NULL DEFAULT 2,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbound_sla_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  escalation_type VARCHAR(60) NOT NULL,
  threshold_override INTEGER,
  action VARCHAR(40) NOT NULL DEFAULT 'notify',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_outbound_sla_escalations_type CHECK (
    escalation_type IN ('draft_stale', 'linkedin_overdue', 'paused_stale', 'high_score_not_contacted')
  ),
  CONSTRAINT chk_outbound_sla_escalations_action CHECK (action IN ('notify', 'log_event'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_sla_escalations_user_type
  ON outbound_sla_escalations(user_id, escalation_type);

CREATE TABLE IF NOT EXISTS outbound_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type VARCHAR(60) NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  related_entity_type VARCHAR(40),
  related_entity_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_notifications_user_unread
  ON outbound_notifications(user_id, is_read, created_at DESC);
