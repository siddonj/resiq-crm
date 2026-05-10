-- Migration 037: Time Tracking Integration for Project Tasks
-- Adds detailed time entry logging with automatic spent_hours rollup

CREATE TABLE IF NOT EXISTS project_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours NUMERIC(5,2) NOT NULL CHECK (hours > 0),
  description TEXT,
  billable BOOLEAN DEFAULT TRUE,
  hourly_rate NUMERIC(10,2) DEFAULT 0,
  logged_at DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_time_entries_task ON project_time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_project_time_entries_user ON project_time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_project_time_entries_logged_at ON project_time_entries(logged_at);

-- Function: recalculate spent_hours for a task and its ancestors
CREATE OR REPLACE FUNCTION recalc_task_spent_hours(p_task_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total NUMERIC(10,2);
  v_parent_id UUID;
BEGIN
  -- Sum all time entries for this task
  SELECT COALESCE(SUM(hours), 0) INTO v_total
  FROM project_time_entries
  WHERE task_id = p_task_id;

  -- Update the task's spent_hours
  UPDATE project_tasks
  SET spent_hours = v_total,
      updated_at = NOW()
  WHERE id = p_task_id
  RETURNING parent_id INTO v_parent_id;

  -- Recursively update parent tasks
  WHILE v_parent_id IS NOT NULL LOOP
    SELECT COALESCE(SUM(pt.spent_hours), 0) INTO v_total
    FROM project_tasks pt
    WHERE pt.parent_id = v_parent_id;

    UPDATE project_tasks
    SET spent_hours = v_total,
        updated_at = NOW()
    WHERE id = v_parent_id
    RETURNING parent_id INTO v_parent_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger: auto-update spent_hours when time entry changes
CREATE OR REPLACE FUNCTION trigger_recalc_spent_hours()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_task_spent_hours(OLD.task_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.task_id IS DISTINCT FROM NEW.task_id THEN
    PERFORM recalc_task_spent_hours(OLD.task_id);
    PERFORM recalc_task_spent_hours(NEW.task_id);
    RETURN NEW;
  ELSE
    PERFORM recalc_task_spent_hours(NEW.task_id);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_time_entries_recalc ON project_time_entries;
CREATE TRIGGER trg_project_time_entries_recalc
AFTER INSERT OR UPDATE OR DELETE ON project_time_entries
FOR EACH ROW
EXECUTE FUNCTION trigger_recalc_spent_hours();
