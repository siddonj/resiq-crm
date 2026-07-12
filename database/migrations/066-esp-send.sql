-- 066: ESP send path — record which mailbox and ESP message each draft went out on.

ALTER TABLE outbound_message_drafts
  ADD COLUMN IF NOT EXISTS esp_message_id TEXT,
  ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES outbound_mailboxes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_drafts_esp_message_id
  ON outbound_message_drafts(esp_message_id)
  WHERE esp_message_id IS NOT NULL;
