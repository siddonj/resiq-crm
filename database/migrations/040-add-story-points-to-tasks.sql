-- Migration 040: Add story_points column to project_tasks
-- Required for Phase 5 Agile Boards

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS story_points INTEGER;
