-- database/migrations/063-compliance-org-scope.sql
-- Migration 063: org-scope the compliance module's tables.
--
-- Migration 062 (multi-tenancy) did not add organization_id to the three
-- tables backing server/src/routes/compliance.js and
-- server/src/services/outbound/complianceService.js — they were queried
-- by user_id only. This migration brings them into the same
-- organization_id pattern as the ~28 tables 062 covered:
--   outbound_workspace_config, outbound_suppression_entries, outbound_compliance_events
--
-- Effect: suppression / do-not-contact entries become per-org going forward
-- (not global across all orgs a user might belong to).
--
-- NOTE: This migration is NOT applied automatically by CI/tests. It is
-- written to be run manually against a live DB, same as migration 062.
-- Idempotent: safe to re-run (IF NOT EXISTS / re-selects existing Default org).

BEGIN;

ALTER TABLE outbound_workspace_config    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_suppression_entries ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_compliance_events   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- ── Backfill to the Default org (created by migration 062) ──────────────────

DO $$
DECLARE
  default_org_id UUID;
BEGIN
  SELECT id INTO default_org_id FROM organizations WHERE slug = 'default' LIMIT 1;

  -- Defensive: create Default org if 062 hasn't run yet / was skipped.
  IF default_org_id IS NULL THEN
    INSERT INTO organizations (name, slug) VALUES ('Default', 'default')
    RETURNING id INTO default_org_id;
  END IF;

  UPDATE outbound_workspace_config
     SET organization_id = default_org_id
   WHERE organization_id IS NULL;

  UPDATE outbound_suppression_entries
     SET organization_id = default_org_id
   WHERE organization_id IS NULL;

  UPDATE outbound_compliance_events
     SET organization_id = default_org_id
   WHERE organization_id IS NULL;
END $$;

-- ── Enforce NOT NULL after backfill ──────────────────────────────────────────

ALTER TABLE outbound_workspace_config    ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE outbound_suppression_entries ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE outbound_compliance_events   ALTER COLUMN organization_id SET NOT NULL;

-- ── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_outbound_workspace_config_org    ON outbound_workspace_config(organization_id);
CREATE INDEX IF NOT EXISTS idx_outbound_suppression_entries_org ON outbound_suppression_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_outbound_compliance_events_org   ON outbound_compliance_events(organization_id);

COMMIT;
