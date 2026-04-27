-- Migration 022: Outbound campaign runs (Phase 4 readiness)
-- Adds campaign objects and campaign member tracking for scalable outbound execution

CREATE TABLE IF NOT EXISTS outbound_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  channels TEXT[] NOT NULL DEFAULT ARRAY['email']::TEXT[],
  audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  branding_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT chk_outbound_campaigns_status CHECK (
    status IN ('draft', 'active', 'paused', 'completed', 'archived')
  ),
  CONSTRAINT chk_outbound_campaigns_channels CHECK (
    array_length(channels, 1) >= 1
    AND channels <@ ARRAY['email', 'linkedin']::TEXT[]
  )
);

CREATE INDEX IF NOT EXISTS idx_outbound_campaigns_user_id ON outbound_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_outbound_campaigns_status ON outbound_campaigns(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS outbound_campaign_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES outbound_leads(id) ON DELETE CASCADE,
  member_status VARCHAR(20) NOT NULL DEFAULT 'queued',
  last_channel VARCHAR(20),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_outbound_campaign_members_status CHECK (
    member_status IN ('queued', 'contacted', 'replied', 'meeting', 'opportunity', 'suppressed', 'dropped')
  ),
  CONSTRAINT chk_outbound_campaign_members_channel CHECK (
    last_channel IS NULL OR last_channel IN ('email', 'linkedin')
  ),
  CONSTRAINT uq_outbound_campaign_members UNIQUE (campaign_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_outbound_campaign_members_campaign_id
  ON outbound_campaign_members(campaign_id, member_status);

CREATE INDEX IF NOT EXISTS idx_outbound_campaign_members_lead_id
  ON outbound_campaign_members(lead_id);
