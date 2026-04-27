-- Migration 032: Phase 21 Slice 10 - Outbound saved views for operator productivity

CREATE TABLE IF NOT EXISTS outbound_saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(40) NOT NULL DEFAULT 'outbound_leads',
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_outbound_saved_views_scope CHECK (scope IN ('outbound_leads'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_saved_views_user_scope_name
  ON outbound_saved_views(user_id, scope, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_outbound_saved_views_user_scope_updated
  ON outbound_saved_views(user_id, scope, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_saved_views_user_scope_default
  ON outbound_saved_views(user_id, scope, is_default);
