-- Migration 041: Consolidated catch-up for Phases 1-5
-- Idempotent: safe to run even if some objects already exist

-- Phase 1: Work Package Types & Status Workflows
CREATE TABLE IF NOT EXISTS project_task_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  icon TEXT DEFAULT '●',
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_task_types_project ON project_task_types(project_id);

CREATE TABLE IF NOT EXISTS project_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, from_status, to_status)
);
CREATE INDEX IF NOT EXISTS idx_project_workflows_project ON project_workflows(project_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_tasks' AND column_name = 'type_id'
  ) THEN
    ALTER TABLE project_tasks ADD COLUMN type_id UUID REFERENCES project_task_types(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_tasks' AND column_name = 'estimated_hours'
  ) THEN
    ALTER TABLE project_tasks ADD COLUMN estimated_hours NUMERIC(8,2);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_tasks' AND column_name = 'spent_hours'
  ) THEN
    ALTER TABLE project_tasks ADD COLUMN spent_hours NUMERIC(8,2) DEFAULT 0;
  END IF;
END $$;

-- Phase 2: Task Relations
CREATE TABLE IF NOT EXISTS project_task_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  to_task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('precedes','follows','blocks','blocked_by','duplicates','relates_to','part_of')),
  delay_days INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, from_task_id, to_task_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_project_task_relations_project ON project_task_relations(project_id);
CREATE INDEX IF NOT EXISTS idx_project_task_relations_from ON project_task_relations(from_task_id);
CREATE INDEX IF NOT EXISTS idx_project_task_relations_to ON project_task_relations(to_task_id);

-- Phase 3: Time Tracking
CREATE TABLE IF NOT EXISTS project_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours NUMERIC(8,2) NOT NULL CHECK (hours > 0),
  description TEXT,
  billable BOOLEAN DEFAULT TRUE,
  hourly_rate NUMERIC(10,2),
  logged_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_time_entries_task ON project_time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_project_time_entries_user ON project_time_entries(user_id);

CREATE OR REPLACE FUNCTION recalc_task_spent_hours()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE project_tasks
  SET spent_hours = COALESCE((
    SELECT SUM(hours) FROM project_time_entries WHERE task_id = COALESCE(NEW.task_id, OLD.task_id)
  ), 0)
  WHERE id = COALESCE(NEW.task_id, OLD.task_id);

  -- Roll up to parent
  WITH RECURSIVE ancestors AS (
    SELECT parent_id FROM project_tasks WHERE id = COALESCE(NEW.task_id, OLD.task_id) AND parent_id IS NOT NULL
    UNION ALL
    SELECT pt.parent_id FROM project_tasks pt JOIN ancestors a ON pt.id = a.parent_id WHERE pt.parent_id IS NOT NULL
  )
  UPDATE project_tasks SET spent_hours = COALESCE((
    SELECT SUM(hours) FROM project_time_entries WHERE task_id IN (SELECT id FROM project_tasks WHERE parent_id = ancestors.parent_id OR id = ancestors.parent_id)
  ), 0) FROM ancestors WHERE project_tasks.id = ancestors.parent_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_time_entries_recalc ON project_time_entries;
CREATE TRIGGER trg_project_time_entries_recalc
AFTER INSERT OR UPDATE OR DELETE ON project_time_entries
FOR EACH ROW EXECUTE FUNCTION recalc_task_spent_hours();

-- Phase 4: Project Templates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'is_template'
  ) THEN
    ALTER TABLE projects ADD COLUMN is_template BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'template_id'
  ) THEN
    ALTER TABLE projects ADD COLUMN template_id UUID REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Phase 5: Agile Boards
CREATE TABLE IF NOT EXISTS sprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'planning' CHECK (status IN ('planning','active','closed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sprints_project ON sprints(project_id);
CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status);

CREATE TABLE IF NOT EXISTS sprint_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  story_points INTEGER,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sprint_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_sprint_tasks_sprint ON sprint_tasks(sprint_id);
CREATE INDEX IF NOT EXISTS idx_sprint_tasks_task ON sprint_tasks(task_id);

-- Phase 5: story_points on tasks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_tasks' AND column_name = 'story_points'
  ) THEN
    ALTER TABLE project_tasks ADD COLUMN story_points INTEGER;
  END IF;
END $$;
