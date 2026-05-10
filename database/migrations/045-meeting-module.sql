-- Phase 9: Meeting Module

CREATE TABLE IF NOT EXISTS project_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  location TEXT,
  agenda TEXT,
  minutes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_meeting_attendees (
  meeting_id UUID NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','tentative')),
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_meeting_tasks (
  meeting_id UUID NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_project_meetings_project_id ON project_meetings(project_id);
CREATE INDEX IF NOT EXISTS idx_project_meetings_start_time ON project_meetings(start_time);
CREATE INDEX IF NOT EXISTS idx_project_meeting_attendees_meeting ON project_meeting_attendees(meeting_id);
CREATE INDEX IF NOT EXISTS idx_project_meeting_attendees_user ON project_meeting_attendees(user_id);
CREATE INDEX IF NOT EXISTS idx_project_meeting_tasks_meeting ON project_meeting_tasks(meeting_id);
CREATE INDEX IF NOT EXISTS idx_project_meeting_tasks_task ON project_meeting_tasks(task_id);
