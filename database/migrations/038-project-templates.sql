-- Migration 038: Project Templates
-- Adds template support to projects for cloning structure

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Index for fast template lookups
CREATE INDEX IF NOT EXISTS idx_projects_is_template ON projects(is_template) WHERE is_template = TRUE;
