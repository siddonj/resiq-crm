-- Migration: Add next_action fields to contacts for solo CRM workflow
-- Supports Today View (overdue/due-today buckets) and Quick-Add modal.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS next_action_text VARCHAR(500),
  ADD COLUMN IF NOT EXISTS next_action_date DATE;

CREATE INDEX IF NOT EXISTS idx_contacts_next_action_date
  ON contacts(user_id, next_action_date)
  WHERE next_action_date IS NOT NULL;
