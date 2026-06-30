-- database/migrations/062-multi-tenancy.sql
-- Migration 062: Row-level multi-tenancy
-- Creates organizations, members, invites tables; adds organization_id
-- to all tenant-scoped tables; backfills a Default org for existing data.
--
-- NOTE: The following tables from the original spec do NOT exist in this schema
-- and are intentionally skipped:
--   - leads              (actual table: unified_leads — not tenant-scoped yet)
--   - outbound_drafts    (actual table: outbound_message_drafts)
--   - outbound_sequence_steps (does not exist; sequence_steps is the equivalent)
--   - engagement_events  (actual table: engagement_tracking)

BEGIN;

-- ── New tables ──────────────────────────────────────────────────────────────

CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'member'
                   CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

CREATE TABLE organization_invites (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'member'
                   CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  token            TEXT NOT NULL UNIQUE,
  expires_at       TIMESTAMPTZ NOT NULL,
  accepted_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Super-admin flag ─────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── organization_id columns on all tenant-scoped tables ──────────────────────
-- Only ALTER tables that actually exist in the schema.
-- Note: the plan used incorrect names for 4 tables; corrected names used below:
--   leads → unified_leads
--   outbound_drafts → outbound_message_drafts
--   outbound_sequence_steps → sequence_steps
--   engagement_events → engagement_tracking

ALTER TABLE contacts                ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE deals                   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE activities              ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE proposals               ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE invoices                ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE time_entries            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE projects                ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE project_tasks           ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE portfolios              ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE reminders               ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE forms                   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE tickets                 ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE sequences               ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE workflows               ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE clients                 ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE calendar_events         ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE teams                   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_leads          ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_campaigns      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE shared_resources        ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE audit_logs              ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE reddit_leads            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
-- Corrected table names (plan had wrong names):
ALTER TABLE outbound_message_drafts ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE sequence_steps          ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE engagement_tracking     ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE unified_leads           ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- ── Default org + backfill ───────────────────────────────────────────────────

DO $$
DECLARE
  default_org_id UUID;
BEGIN
  INSERT INTO organizations (name, slug) VALUES ('Default', 'default')
  RETURNING id INTO default_org_id;

  -- Backfill all tenant-scoped tables
  UPDATE contacts                SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE deals                   SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE activities              SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE proposals               SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE invoices                SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE time_entries            SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE projects                SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE project_tasks           SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE portfolios              SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE reminders               SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE forms                   SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE tickets                 SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE sequences               SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE workflows               SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE clients                 SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE calendar_events         SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE teams                   SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE outbound_leads          SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE outbound_campaigns      SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE shared_resources        SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE audit_logs              SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE reddit_leads            SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE outbound_message_drafts SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE sequence_steps          SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE engagement_tracking     SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE unified_leads           SET organization_id = default_org_id WHERE organization_id IS NULL;

  -- Mark super-admins
  UPDATE users SET is_super_admin = TRUE WHERE email = 'siddonj@gmail.com';

  -- Add super-admins as owners of the default org
  INSERT INTO organization_members (organization_id, user_id, role)
  SELECT default_org_id, id, 'owner'
  FROM users WHERE is_super_admin = TRUE
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  -- Add all other existing users as members of default org
  INSERT INTO organization_members (organization_id, user_id, role)
  SELECT default_org_id, id, 'member'
  FROM users WHERE is_super_admin = FALSE
  ON CONFLICT (organization_id, user_id) DO NOTHING;
END $$;

-- ── Performance indexes ──────────────────────────────────────────────────────

CREATE INDEX idx_org_members_org_user ON organization_members(organization_id, user_id);
CREATE INDEX idx_contacts_org         ON contacts(organization_id);
CREATE INDEX idx_deals_org            ON deals(organization_id);
CREATE INDEX idx_projects_org         ON projects(organization_id);
CREATE INDEX idx_invoices_org         ON invoices(organization_id);
CREATE INDEX idx_outbound_leads_org   ON outbound_leads(organization_id);
CREATE INDEX idx_activities_org       ON activities(organization_id);

COMMIT;
