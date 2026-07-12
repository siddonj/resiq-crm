-- 069: HubSpot import — external-id columns for idempotent upserts, plus
-- import bookkeeping tables. Company objects are flattened onto contacts;
-- their raw JSON is preserved in hubspot_import_raw.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS hubspot_id TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_company_id TEXT,
  ADD COLUMN IF NOT EXISTS company_domain TEXT;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS hubspot_id TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS hubspot_id TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS hubspot_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_hubspot_id ON contacts(hubspot_id) WHERE hubspot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_hubspot_id ON deals(hubspot_id) WHERE hubspot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_hubspot_id ON activities(hubspot_id) WHERE hubspot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_hubspot_id ON emails(hubspot_id) WHERE hubspot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hubspot_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'run',
  counts JSONB DEFAULT '{}'::jsonb,
  errors JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS hubspot_import_raw (
  object_type TEXT NOT NULL,
  hubspot_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (object_type, hubspot_id)
);
