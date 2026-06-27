-- Migration: Multi-provider OAuth token storage
-- Replaces single-provider oauth_* columns on users table.

CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_type VARCHAR(32) NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, service_type)
);
