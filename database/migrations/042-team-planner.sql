-- Migration 042: Team Planner / Resource Management
-- Adds task assignee scheduling and workload tracking

CREATE TABLE IF NOT EXISTS task_assignee_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  allocation_percent INTEGER NOT NULL DEFAULT 100 CHECK (allocation_percent BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignee_dates_task ON task_assignee_dates(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignee_dates_user ON task_assignee_dates(user_id);
CREATE INDEX IF NOT EXISTS idx_task_assignee_dates_range ON task_assignee_dates(start_date, end_date);

-- View for quick workload aggregation
CREATE OR REPLACE VIEW user_workload_by_day AS
SELECT
  tad.user_id,
  tad.start_date + generate_series(0, tad.end_date - tad.start_date) AS work_date,
  SUM(tad.allocation_percent) AS total_allocation
FROM task_assignee_dates tad
GROUP BY tad.user_id, tad.start_date + generate_series(0, tad.end_date - tad.start_date);
