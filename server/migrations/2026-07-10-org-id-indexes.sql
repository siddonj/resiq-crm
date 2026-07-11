-- server/migrations/2026-07-10-org-id-indexes.sql
-- Adds a btree index on organization_id for every ORG_TABLES table that
-- still lacked one after migration 062 (Task 1 inventory:
-- docs/superpowers/plans/org-inventory.md, MISSING_INDEX_TABLES).
--
-- Migrations 063 (compliance) and 064 (sms) added organization_id to new
-- tables since Task 1's inventory was taken (outbound_workspace_config,
-- outbound_suppression_entries, outbound_compliance_events, sms_messages,
-- sms_optouts, sms_templates) but each of those migrations already created
-- its own index inline — verified by reading both files. No duplicate
-- entries for those tables are needed here.
--
-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- block. Run each statement below individually (not as one batched script,
-- and not wrapped in BEGIN/COMMIT).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_organization_id ON audit_logs (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_events_organization_id ON calendar_events (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_organization_id ON clients (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_engagement_tracking_organization_id ON engagement_tracking (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_forms_organization_id ON forms (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbound_campaigns_organization_id ON outbound_campaigns (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbound_message_drafts_organization_id ON outbound_message_drafts (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portfolios_organization_id ON portfolios (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_tasks_organization_id ON project_tasks (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_organization_id ON proposals (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reddit_leads_organization_id ON reddit_leads (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reminders_organization_id ON reminders (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sequence_steps_organization_id ON sequence_steps (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sequences_organization_id ON sequences (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shared_resources_organization_id ON shared_resources (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stage_automation_rules_organization_id ON stage_automation_rules (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tags_organization_id ON tags (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_organization_id ON teams (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_organization_id ON tickets (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_time_entries_organization_id ON time_entries (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_leads_organization_id ON unified_leads (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflows_organization_id ON workflows (organization_id);
