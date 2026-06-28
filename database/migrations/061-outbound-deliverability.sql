-- Migration 061: Outbound deliverability layer (M2)
-- Mailbox registry (domain/provider/auth status), warmup ramp config,
-- per-mailbox daily engagement stats for engagement-aware throttling, and
-- rotation weighting. Additive to the existing per-user Gmail send path.

-- 1. Sending mailbox registry (one row per sending identity, per user)
CREATE TABLE IF NOT EXISTS outbound_mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'gmail',
  status TEXT NOT NULL DEFAULT 'warming',
  -- Steady-state daily send cap once warmup completes (deliverability-safe 25-50)
  daily_cap_target INTEGER NOT NULL DEFAULT 40,
  -- Warmup ramp: start at initial cap, add increment each day up to target
  warmup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  warmup_started_at TIMESTAMPTZ,
  warmup_initial_cap INTEGER NOT NULL DEFAULT 5,
  warmup_increment INTEGER NOT NULL DEFAULT 5,
  -- Relative rotation weight when selecting a mailbox for a send
  rotation_weight INTEGER NOT NULL DEFAULT 1,
  -- Domain auth posture (refreshed by DNS check)
  spf_status TEXT NOT NULL DEFAULT 'unknown',
  dkim_status TEXT NOT NULL DEFAULT 'unknown',
  dmarc_status TEXT NOT NULL DEFAULT 'unknown',
  dkim_selector TEXT,
  auth_checked_at TIMESTAMPTZ,
  auth_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Rolling 0-100 deliverability health (derived from bounce/complaint rates)
  health_score INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_mailboxes_user_email
  ON outbound_mailboxes(user_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_outbound_mailboxes_user
  ON outbound_mailboxes(user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_outbound_mailboxes_status'
  ) THEN
    ALTER TABLE outbound_mailboxes
      ADD CONSTRAINT chk_outbound_mailboxes_status
      CHECK (status IN ('active', 'warming', 'paused', 'disabled'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_outbound_mailboxes_provider'
  ) THEN
    ALTER TABLE outbound_mailboxes
      ADD CONSTRAINT chk_outbound_mailboxes_provider
      CHECK (provider IN ('gmail', 'smtp', 'sendgrid', 'postmark', 'ses', 'resend', 'other'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_outbound_mailboxes_auth'
  ) THEN
    ALTER TABLE outbound_mailboxes
      ADD CONSTRAINT chk_outbound_mailboxes_auth
      CHECK (
        spf_status   IN ('unknown', 'pass', 'fail', 'missing') AND
        dkim_status  IN ('unknown', 'pass', 'fail', 'missing') AND
        dmarc_status IN ('unknown', 'pass', 'fail', 'missing')
      );
  END IF;
END $$;

-- 2. Per-mailbox daily engagement counters (drive engagement-aware throttling)
CREATE TABLE IF NOT EXISTS outbound_mailbox_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES outbound_mailboxes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stat_date DATE NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  bounced INTEGER NOT NULL DEFAULT 0,
  complained INTEGER NOT NULL DEFAULT 0,
  replied INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_mailbox_daily_stats
  ON outbound_mailbox_daily_stats(mailbox_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_outbound_mailbox_daily_stats_user_date
  ON outbound_mailbox_daily_stats(user_id, stat_date);
