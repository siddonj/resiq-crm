-- Migration 035: Phase 1 — Work Package Types & Status Workflows

-- Task types per project (e.g., Epic, Story, Bug, Task, Milestone)
CREATE TABLE IF NOT EXISTS project_task_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  icon TEXT DEFAULT 'task',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, name)
);

-- Status workflow transitions per project
CREATE TABLE IF NOT EXISTS project_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  role_required TEXT,
  required_fields TEXT[], -- array of column keys that must be filled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, from_status, to_status)
);

-- Add type_id and time tracking columns to tasks
ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS type_id UUID REFERENCES project_task_types(id) ON DELETE SET NULL;

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(8,2);

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS spent_hours NUMERIC(8,2) DEFAULT 0;

-- Default task types for existing projects
INSERT INTO project_task_types (project_id, name, color, icon, position)
SELECT p.id, 'Task', '#3B82F6', 'task', 0
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM project_task_types t WHERE t.project_id = p.id
);

INSERT INTO project_task_types (project_id, name, color, icon, position)
SELECT p.id, 'Milestone', '#F59E0B', 'milestone', 1
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM project_task_types t WHERE t.project_id = p.id AND t.name = 'Milestone'
);

INSERT INTO project_task_types (project_id, name, color, icon, position)
SELECT p.id, 'Bug', '#EF4444', 'bug', 2
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM project_task_types t WHERE t.project_id = p.id AND t.name = 'Bug'
);

INSERT INTO project_task_types (project_id, name, color, icon, position)
SELECT p.id, 'Epic', '#8B5CF6', 'epic', 3
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM project_task_types t WHERE t.project_id = p.id AND t.name = 'Epic'
);

-- Default workflows for existing projects (open -> closed loop)
INSERT INTO project_workflows (project_id, from_status, to_status, role_required)
SELECT p.id, 'To Do', 'In Progress', NULL
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM project_workflows w WHERE w.project_id = p.id AND w.from_status = 'To Do' AND w.to_status = 'In Progress'
);

INSERT INTO project_workflows (project_id, from_status, to_status, role_required)
SELECT p.id, 'In Progress', 'Done', NULL
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM project_workflows w WHERE w.project_id = p.id AND w.from_status = 'In Progress' AND w.to_status = 'Done'
);

INSERT INTO project_workflows (project_id, from_status, to_status, role_required)
SELECT p.id, 'Done', 'To Do', NULL
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM project_workflows w WHERE w.project_id = p.id AND w.from_status = 'Done' AND w.to_status = 'To Do'
);
