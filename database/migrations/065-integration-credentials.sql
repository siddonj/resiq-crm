-- Migration 065: Integration credentials (admin-managed, encrypted runtime
-- credentials for Twilio, Stripe, SMTP, Hunter.io, and OpenAI)

CREATE TABLE IF NOT EXISTS integration_credentials (
  credential_key   TEXT PRIMARY KEY,
  credential_value TEXT NOT NULL,
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_updated_at ON integration_credentials(updated_at DESC);
