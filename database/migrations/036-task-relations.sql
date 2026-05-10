-- Migration 036: Task Relations (Phase 2)
-- Beyond parent/child: precedes, follows, blocks, duplicates, relates_to, part_of

CREATE TABLE IF NOT EXISTS project_task_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  to_task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'precedes', 'follows', 'blocks', 'blocked_by',
    'duplicates', 'relates_to', 'part_of'
  )),
  delay_days INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_task_id, to_task_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_task_relations_from ON project_task_relations(from_task_id);
CREATE INDEX IF NOT EXISTS idx_task_relations_to ON project_task_relations(to_task_id);
CREATE INDEX IF NOT EXISTS idx_task_relations_project ON project_task_relations(project_id);
