# Phase 1.5 — Database Index Additions

**Labels:** `performance`
**Milestone:** Phase 1: Foundation Hardening
**Status:** ✅ Completed

## Description

Created migration `052-outbound-performance-indexes.sql` with four missing indexes:

- `idx_outbound_leads_user_status` on `outbound_leads(user_id, status)`
- `idx_lead_source_events_user_event` on `lead_source_events(user_id, event_type, created_at DESC)`
- `idx_outbound_drafts_user_status` on `outbound_drafts(user_id, status)`
- `idx_outbound_campaigns_user_status` on `outbound_campaigns(user_id, status)`

All use `CREATE INDEX IF NOT EXISTS` for idempotent re-runs.
