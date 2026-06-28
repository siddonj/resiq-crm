-- Migration 053: Outbound compliance layer (M3)
-- Centralized suppression list, compliance audit events, per-campaign lawful basis (GDPR LIA),
-- and CAN-SPAM workspace settings (physical mailing address, region, unsubscribe footer).

-- 1. Workspace-level compliance settings (extend existing per-user config)
ALTER TABLE outbound_workspace_config
  ADD COLUMN IF NOT EXISTS physical_mailing_address TEXT NOT NULL DEFAULT '';
ALTER TABLE outbound_workspace_config
  ADD COLUMN IF NOT EXISTS compliance_region TEXT NOT NULL DEFAULT 'US';
ALTER TABLE outbound_workspace_config
  ADD COLUMN IF NOT EXISTS unsubscribe_footer_enabled BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_outbound_workspace_config_region'
  ) THEN
    ALTER TABLE outbound_workspace_config
      ADD CONSTRAINT chk_outbound_workspace_config_region
      CHECK (compliance_region IN ('US', 'EU', 'UK', 'CA', 'OTHER'));
  END IF;
END $$;

-- 2. Centralized suppression / do-not-contact list (email or whole-domain scoped, per user)
CREATE TABLE IF NOT EXISTS outbound_suppression_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_domain TEXT NOT NULL DEFAULT '',
  match_type TEXT NOT NULL DEFAULT 'email',
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_outbound_suppression_match_type CHECK (match_type IN ('email', 'domain')),
  CONSTRAINT chk_outbound_suppression_source CHECK (
    source IN ('manual', 'opt_out', 'bounce', 'complaint', 'import', 'system')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_suppression_user_email
  ON outbound_suppression_entries(user_id, email);
CREATE INDEX IF NOT EXISTS idx_outbound_suppression_user_domain
  ON outbound_suppression_entries(user_id, email_domain);

-- 3. Compliance audit events (opt-outs, blocked sends, LIA records)
CREATE TABLE IF NOT EXISTS outbound_compliance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES outbound_leads(id) ON DELETE SET NULL,
  email TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  channel TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_outbound_compliance_event_type CHECK (
    event_type IN ('opt_out_received', 'suppressed', 'send_blocked', 'lia_recorded', 'suppression_removed')
  )
);

CREATE INDEX IF NOT EXISTS idx_outbound_compliance_events_user_created
  ON outbound_compliance_events(user_id, created_at DESC);

-- 4. Per-campaign GDPR legitimate-interest assessment (lawful basis record)
CREATE TABLE IF NOT EXISTS outbound_campaign_compliance (
  campaign_id UUID PRIMARY KEY REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  lawful_basis TEXT NOT NULL DEFAULT 'legitimate_interest',
  lia_text TEXT NOT NULL DEFAULT '',
  assessed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assessed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_outbound_campaign_lawful_basis CHECK (
    lawful_basis IN ('legitimate_interest', 'consent', 'contract', 'not_applicable')
  )
);
