-- Engagement tracking for monitoring opens on proposals, invoices, and emails
CREATE TABLE IF NOT EXISTS engagement_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tracking_id TEXT UNIQUE NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('proposal', 'invoice', 'email')),
  asset_id UUID NOT NULL,
  opened_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_engagement_tracking_user_id ON engagement_tracking(user_id);
CREATE INDEX idx_engagement_tracking_contact_id ON engagement_tracking(contact_id);
CREATE INDEX idx_engagement_tracking_tracking_id ON engagement_tracking(tracking_id);
CREATE INDEX idx_engagement_tracking_opened_at ON engagement_tracking(opened_at DESC);
CREATE INDEX idx_engagement_tracking_asset ON engagement_tracking(asset_type, asset_id);
