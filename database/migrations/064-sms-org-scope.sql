-- database/migrations/064-sms-org-scope.sql
-- Migration 064: org-scope the sms module's tables.
--
-- Migration 062 (multi-tenancy) did not touch sms_messages, sms_optouts, or
-- sms_templates (all created by migration 008, long before multi-tenancy
-- existed) — same class of gap as migration 063's compliance tables.
--
-- sms_messages and sms_optouts are always tied to a specific contact via
-- contact_id (NOT NULL, FK to contacts(id) ON DELETE CASCADE), and contacts
-- already has organization_id NOT NULL (migration 062). So instead of a
-- blind "select Default org" backfill, this migration derives the correct
-- organization_id for every existing row from its linked contact — more
-- precise than 063's pattern, since the true owning org is knowable here.
--
-- sms_templates is different: it holds both platform-wide default templates
-- (is_default = TRUE, seeded by migration 008, meant to be visible to every
-- org) and user-created custom templates (is_default = FALSE, previously
-- writable/readable/deletable by ANY authenticated user regardless of org —
-- a real cross-tenant gap). organization_id is added NULLABLE here:
--   NULL            -> platform-wide default template (is_default = TRUE)
--   <organization>  -> custom template scoped to that org
--
-- NOTE: This migration is NOT applied automatically by CI/tests. It is
-- written to be run manually against a live DB, same as migrations 062/063.
-- Idempotent: safe to re-run (IF NOT EXISTS / re-selects existing rows).

BEGIN;

ALTER TABLE sms_messages  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE sms_optouts   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE sms_templates ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- ── Backfill sms_messages / sms_optouts from their linked contact's org ─────

UPDATE sms_messages sm
   SET organization_id = c.organization_id
  FROM contacts c
 WHERE c.id = sm.contact_id
   AND sm.organization_id IS NULL;

UPDATE sms_optouts so
   SET organization_id = c.organization_id
  FROM contacts c
 WHERE c.id = so.contact_id
   AND so.organization_id IS NULL;

-- ── Defensive fallback + sms_templates backfill ─────────────────────────────

DO $$
DECLARE
  default_org_id UUID;
BEGIN
  SELECT id INTO default_org_id FROM organizations WHERE slug = 'default' LIMIT 1;

  IF default_org_id IS NULL THEN
    INSERT INTO organizations (name, slug) VALUES ('Default', 'default')
    RETURNING id INTO default_org_id;
  END IF;

  -- Should be a no-op given contact_id is NOT NULL + FK-enforced, but mirrors
  -- 063's defensive pattern in case any row's contact link was ever broken.
  UPDATE sms_messages SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE sms_optouts  SET organization_id = default_org_id WHERE organization_id IS NULL;

  -- Pre-existing custom templates (is_default = FALSE) with no org tag get
  -- assigned to the Default org; pre-existing default templates keep
  -- organization_id NULL (platform-wide).
  UPDATE sms_templates
     SET organization_id = default_org_id
   WHERE organization_id IS NULL
     AND is_default = FALSE;
END $$;

-- ── Enforce NOT NULL where every row must have an owning org ────────────────

ALTER TABLE sms_messages ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE sms_optouts  ALTER COLUMN organization_id SET NOT NULL;
-- sms_templates.organization_id stays NULLable: NULL means platform-wide default.

-- ── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sms_messages_org  ON sms_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_sms_optouts_org   ON sms_optouts(organization_id);
CREATE INDEX IF NOT EXISTS idx_sms_templates_org ON sms_templates(organization_id);

COMMIT;
