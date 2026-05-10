-- Migration 043: Project Baseline Comparison
-- Save snapshots of project state for variance tracking

CREATE TABLE IF NOT EXISTS project_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_baselines_project ON project_baselines(project_id);

-- Helper function to capture a project snapshot
CREATE OR REPLACE FUNCTION capture_project_baseline(p_project_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'status', values->>'status',
        'progress', values->>'progress',
        'priority', values->>'priority',
        'due_date', values->>'due_date',
        'assignee', values->>'assignee',
        'estimated_hours', estimated_hours,
        'spent_hours', spent_hours,
        'type_id', type_id,
        'parent_id', parent_id,
        'position', position,
        'created_at', created_at
      ) ORDER BY position, created_at)
      FROM project_tasks
      WHERE project_id = p_project_id
    ), '[]'::jsonb),
    'columns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'key', key,
        'type', type,
        'position', position
      ) ORDER BY position)
      FROM project_columns
      WHERE project_id = p_project_id
    ), '[]'::jsonb),
    'types', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'color', color,
        'icon', icon
      ))
      FROM project_task_types
      WHERE project_id = p_project_id
    ), '[]'::jsonb),
    'relations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'from_task_id', from_task_id,
        'to_task_id', to_task_id,
        'relation_type', relation_type,
        'delay_days', delay_days
      ))
      FROM project_task_relations
      WHERE project_id = p_project_id
    ), '[]'::jsonb),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', user_id,
        'team_id', team_id,
        'role', role
      ))
      FROM project_members
      WHERE project_id = p_project_id
    ), '[]'::jsonb),
    'captured_at', NOW()
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;
