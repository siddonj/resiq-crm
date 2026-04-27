-- Migration 021: Outbound automation foundation (Phase 0/1)
-- Adds real lead ingestion + scoring + outreach task infrastructure

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Track whether multi-source entries were synthetic/demo generated
ALTER TABLE unified_leads
  ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN DEFAULT FALSE;

ALTER TABLE unified_leads
  ADD COLUMN IF NOT EXISTS lead_source_confidence INTEGER DEFAULT 50;

ALTER TABLE unified_leads
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50);

ALTER TABLE unified_leads
  ADD COLUMN IF NOT EXISTS source_reference TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_unified_leads_source_confidence'
  ) THEN
    ALTER TABLE unified_leads
      ADD CONSTRAINT chk_unified_leads_source_confidence
      CHECK (lead_source_confidence BETWEEN 0 AND 100);
  END IF;
END $$;

-- Import job tracking for CSV/manual ingestion
CREATE TABLE IF NOT EXISTS lead_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'processing',
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  error_sample JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lead_import_jobs_user_id ON lead_import_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_import_jobs_created_at ON lead_import_jobs(created_at DESC);

-- Canonical outbound lead table for real (non-synthetic) lead ops
CREATE TABLE IF NOT EXISTS outbound_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type VARCHAR(30) NOT NULL DEFAULT 'csv',
  source_reference TEXT,
  source_confidence INTEGER NOT NULL DEFAULT 80,
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,

  name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  title TEXT,
  linkedin_url TEXT,
  website TEXT,
  location TEXT,
  notes TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,

  dedupe_key TEXT NOT NULL,
  fit_score INTEGER NOT NULL DEFAULT 0,
  intent_score INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'new',
  suppression_reason TEXT,
  last_outreach_channel VARCHAR(20),
  next_recommended_action TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT chk_outbound_leads_source_confidence CHECK (source_confidence BETWEEN 0 AND 100),
  CONSTRAINT chk_outbound_leads_fit_score CHECK (fit_score BETWEEN 0 AND 100),
  CONSTRAINT chk_outbound_leads_intent_score CHECK (intent_score BETWEEN 0 AND 100),
  CONSTRAINT chk_outbound_leads_total_score CHECK (total_score BETWEEN 0 AND 100),
  CONSTRAINT chk_outbound_leads_status CHECK (
    status IN (
      'new',
      'qualified',
      'queued',
      'contacted',
      'replied',
      'meeting',
      'opportunity',
      'disqualified',
      'suppressed'
    )
  ),
  CONSTRAINT chk_outbound_leads_source_type CHECK (source_type IN ('csv', 'manual', 'api', 'other'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_leads_user_dedupe
  ON outbound_leads(user_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_outbound_leads_user_status
  ON outbound_leads(user_id, status);

CREATE INDEX IF NOT EXISTS idx_outbound_leads_user_total_score
  ON outbound_leads(user_id, total_score DESC, created_at DESC);

-- Event log for outbound actions
CREATE TABLE IF NOT EXISTS lead_source_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES outbound_leads(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  channel VARCHAR(20),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_source_events_user_id ON lead_source_events(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_source_events_lead_id ON lead_source_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_source_events_created_at ON lead_source_events(created_at DESC);

-- Outbound draft state machine support
CREATE TABLE IF NOT EXISTS outbound_message_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES outbound_leads(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'drafted',
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_outbound_message_drafts_channel CHECK (channel IN ('email', 'linkedin')),
  CONSTRAINT chk_outbound_message_drafts_status CHECK (status IN ('drafted', 'approved', 'sent', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_outbound_message_drafts_user_id ON outbound_message_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_outbound_message_drafts_lead_id ON outbound_message_drafts(lead_id);
CREATE INDEX IF NOT EXISTS idx_outbound_message_drafts_status ON outbound_message_drafts(status);

-- Manual-confirmed LinkedIn workflow tasks
CREATE TABLE IF NOT EXISTS linkedin_outreach_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES outbound_leads(id) ON DELETE CASCADE,
  draft_id UUID REFERENCES outbound_message_drafts(id) ON DELETE SET NULL,
  task_type VARCHAR(40) NOT NULL DEFAULT 'manual_message',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_linkedin_tasks_task_type CHECK (
    task_type IN ('manual_connection', 'manual_message', 'manual_followup', 'manual_profile_review')
  ),
  CONSTRAINT chk_linkedin_tasks_status CHECK (
    status IN ('pending', 'drafted', 'approved', 'completed', 'skipped', 'blocked')
  )
);

CREATE INDEX IF NOT EXISTS idx_linkedin_tasks_user_id ON linkedin_outreach_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_tasks_lead_id ON linkedin_outreach_tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_tasks_status_due ON linkedin_outreach_tasks(status, due_at);

-- Daily rollup table for quick dashboard queries
CREATE TABLE IF NOT EXISTS outbound_performance_daily (
  day DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  imported_count INTEGER NOT NULL DEFAULT 0,
  qualified_count INTEGER NOT NULL DEFAULT 0,
  contacted_count INTEGER NOT NULL DEFAULT 0,
  replied_count INTEGER NOT NULL DEFAULT 0,
  meeting_count INTEGER NOT NULL DEFAULT 0,
  opportunity_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id)
);

