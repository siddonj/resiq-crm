-- Migration 044: Project Life Cycle Phases
-- Adds phase management with gates for project workflow control

CREATE TABLE IF NOT EXISTS project_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','skipped')),
  deliverables JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_phase_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id UUID NOT NULL REFERENCES project_phases(id) ON DELETE CASCADE,
  approver_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add phase_id to tasks for phase-gated visibility
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES project_phases(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_project_phases_project ON project_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_project_phase_gates_phase ON project_phase_gates(phase_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_phase ON project_tasks(phase_id);
