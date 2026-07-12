-- Migration: Add missing performance indexes for outbound automation
-- Identified during Phase 25 code quality audit
-- These indexes were flagged by EXPLAIN ANALYZE on common query patterns:
--   - Filtering outbound leads by user and status
--   - Aggregating lead source events by user and event type
--   - Retrieving drafts for a user by status

CREATE INDEX IF NOT EXISTS idx_outbound_leads_user_status
  ON outbound_leads(user_id, status);

CREATE INDEX IF NOT EXISTS idx_lead_source_events_user_event
  ON lead_source_events(user_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_message_drafts_user_status
  ON outbound_message_drafts(user_id, status);

-- Also index the frequently-queried outbound_campaigns table
CREATE INDEX IF NOT EXISTS idx_outbound_campaigns_user_status
  ON outbound_campaigns(user_id, status);
