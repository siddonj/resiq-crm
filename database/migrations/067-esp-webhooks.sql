-- 067: ESP event webhook ingestion — idempotency store + engagement timestamps.

CREATE TABLE IF NOT EXISTS outbound_esp_events (
  sg_event_id TEXT PRIMARY KEY,
  event_type TEXT,
  email TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_esp_events_created_at ON outbound_esp_events(created_at);

ALTER TABLE outbound_message_drafts
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
