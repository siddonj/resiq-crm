-- Migration 030: Phase 21 Slice 7 - Multifamily custom objects and associations

CREATE TABLE IF NOT EXISTS multifamily_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_type VARCHAR(30) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_multifamily_objects_type CHECK (
    object_type IN ('portfolio', 'property', 'tech_stack', 'initiative')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_multifamily_objects_user_type_name
  ON multifamily_objects(user_id, object_type, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_multifamily_objects_user_type
  ON multifamily_objects(user_id, object_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS multifamily_object_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_id UUID NOT NULL REFERENCES multifamily_objects(id) ON DELETE CASCADE,
  object_type VARCHAR(30) NOT NULL,
  entity_type VARCHAR(30) NOT NULL,
  entity_id UUID,
  company_name TEXT,
  target_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_multifamily_association_object_type CHECK (
    object_type IN ('portfolio', 'property', 'tech_stack', 'initiative')
  ),
  CONSTRAINT chk_multifamily_association_entity_type CHECK (
    entity_type IN ('outbound_lead', 'contact', 'deal', 'company')
  ),
  CONSTRAINT chk_multifamily_association_target CHECK (
    (entity_type = 'company' AND company_name IS NOT NULL AND entity_id IS NULL)
    OR
    (entity_type IN ('outbound_lead', 'contact', 'deal') AND entity_id IS NOT NULL AND company_name IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_multifamily_object_associations_target
  ON multifamily_object_associations(user_id, object_id, entity_type, target_key);

CREATE INDEX IF NOT EXISTS idx_multifamily_object_associations_object
  ON multifamily_object_associations(user_id, object_id, entity_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_multifamily_object_associations_entity
  ON multifamily_object_associations(user_id, entity_type, entity_id, updated_at DESC);
