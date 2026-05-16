-- P3.1: Link tickets to contacts via UI (FK already exists)
-- No schema change needed for tickets ↔ contacts (contact_id column exists)

-- P3.2: Add deal_id to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;

-- No changes needed for Calendar (availability JSONB already in scheduling_settings)
