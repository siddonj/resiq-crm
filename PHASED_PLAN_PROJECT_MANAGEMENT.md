# ResiQ CRM — Project Management Enhancement Plan
## Inspired by OpenProject Architecture

---

## Executive Summary

This plan phases the implementation of 10 major enhancements to ResiQ CRM's project management module, drawing from OpenProject's proven architecture. Each phase builds incrementally on the previous one and is designed to be deployable independently.

---

## Current State

- ✅ Projects with grid/kanban/gantt/calendar views
- ✅ Custom columns (EAV-style)
- ✅ Tasks with parent/child hierarchy
- ✅ Indent/outdent controls
- ✅ Progress rollup
- ✅ Task comments, attachments, assignees, dependencies
- ✅ Members and teams
- ✅ Bulk operations
- ✅ Saved views

---

## Phase 1: Work Package Types & Status Workflows
**Complexity:** Medium | **Timeline:** 1 week

### Backend
- Create `project_task_types` table (id, project_id, name, color, icon, position)
- Create `project_workflows` table (id, project_id, from_status, to_status, role_required, required_fields)
- Add `type_id` to `project_tasks`
- Add `estimated_hours`, `spent_hours` to `project_tasks`
- Validate status transitions against workflow rules
- Enforce required fields on transitions

### Frontend
- Type selector in task creation/editing
- Color-coded type badges in grid
- Workflow-aware status dropdowns (only show allowed transitions)
- Type-specific column defaults

### Migration
```sql
CREATE TABLE project_task_types (...);
CREATE TABLE project_workflows (...);
ALTER TABLE project_tasks ADD COLUMN type_id UUID REFERENCES project_task_types(id);
ALTER TABLE project_tasks ADD COLUMN estimated_hours NUMERIC(8,2);
ALTER TABLE project_tasks ADD COLUMN spent_hours NUMERIC(8,2);
```

---

## Phase 2: Task Relations (Beyond Parent/Child)
**Complexity:** Medium | **Timeline:** 1 week

### Backend
- Create `project_task_relations` table:
  - id, from_task_id, to_task_id, relation_type, delay_days, lag
  - Types: `precedes`, `follows`, `blocks`, `blocked_by`, `duplicates`, `relates_to`, `part_of`
  - UNIQUE(from_task_id, to_task_id, relation_type)
- Update Gantt view data to include relations
- Validation: prevent circular precedes/follows chains
- Cascade: when a predecessor date changes, optionally shift successor dates

### Frontend
- Relation editor in TaskDetail panel
- Visual relation lines in Gantt chart
- Blocked-by warnings ("This task is blocked by X")
- Relation summary in task cards

### Migration
```sql
CREATE TABLE project_task_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  to_task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('precedes','follows','blocks','blocked_by','duplicates','relates_to','part_of')),
  delay_days INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_task_id, to_task_id, relation_type)
);
```

---

## Phase 3: Time Tracking Integration
**Complexity:** Low-Medium | **Timeline:** 3-4 days

### Backend
- Create `project_time_entries` table (id, task_id, user_id, hours, description, logged_at, created_at)
- Link to existing time tracking module (or reuse `time_entries` table with optional task_id)
- Update `spent_hours` on task when time is logged
- Roll up spent hours to parent tasks
- API: `POST /api/projects/:id/tasks/:taskId/time-entries`

### Frontend
- Time log button in TaskDetail
- Time entry list per task
- "Log time" inline in grid (quick entry)
- Spent vs. estimated hours progress bar

### Migration
```sql
CREATE TABLE project_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours NUMERIC(5,2) NOT NULL,
  description TEXT,
  logged_at DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Phase 4: Project Templates
**Complexity:** Low | **Timeline:** 2-3 days

### Backend
- Add `is_template` column to `projects`
- Add `template_id` column to `projects` (track which template a project was created from)
- Clone endpoint: `POST /api/projects/:id/clone`
  - Deep copy: columns, views, task types, workflows, task structure
  - Optionally copy tasks as skeletons (no values)

### Frontend
- "Save as Template" button on project settings
- Template gallery when creating new projects
- Preview template structure before creating

### Migration
```sql
ALTER TABLE projects ADD COLUMN is_template BOOLEAN DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN template_id UUID REFERENCES projects(id);
```

---

## Phase 5: Agile Boards (Scrum/Sprints)
**Complexity:** High | **Timeline:** 2 weeks

### Backend
- Create `sprints` table (id, project_id, name, goal, start_date, end_date, status)
- Create `sprint_tasks` table (id, sprint_id, task_id, story_points, position)
- Backlog: tasks not in any sprint
- Sprint status: planning, active, closed
- Burndown data generation endpoint
- Velocity calculation (avg story points per sprint)

### Frontend
- New "Backlog" view: unassigned tasks + sprint lists
- Sprint board (Kanban within a sprint)
- Story points field on tasks
- Burndown chart component
- Sprint velocity dashboard widget
- Sprint start/close actions

### Migration
```sql
CREATE TABLE sprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'planning' CHECK (status IN ('planning','active','closed'))
);

CREATE TABLE sprint_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  story_points INTEGER,
  position INTEGER DEFAULT 0,
  UNIQUE(sprint_id, task_id)
);
```

---

## Phase 6: Team Planner / Resource Management
**Complexity:** High | **Timeline:** 2 weeks

### Backend
- Create `task_assignee_dates` table (task_id, user_id, start_date, end_date, allocation_percent)
- Workload query: sum allocation per user per day/week
- Over-allocation detection endpoint

### Frontend
- New "Team Planner" view (calendar/timeline grid)
  - Rows = team members
  - Columns = weeks/days
  - Bars = assigned tasks
- Over-allocation warnings (red highlight > 100%)
- Drag to reassign or resize assignments
- Workload summary sidebar

### Migration
```sql
CREATE TABLE task_assignee_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE,
  end_date DATE,
  allocation_percent INTEGER DEFAULT 100 CHECK (allocation_percent BETWEEN 0 AND 100)
);
```

---

## Phase 7: Baseline Comparison
**Complexity:** Medium | **Timeline:** 1 week

### Backend
- Create `project_baselines` table (id, project_id, name, snapshot JSONB, created_at)
- Snapshot includes: tasks (names, dates, progress, status), columns, structure
- Compare endpoint: diff current state vs. baseline
  - Added/removed tasks
  - Date changes
  - Progress variance
  - Status changes

### Frontend
- "Save Baseline" button in project header
- Baseline selector dropdown
- Comparison view:
  - Tasks with variance indicators (↑↓)
  - Delayed tasks highlighted
  - Progress deviation chart

### Migration
```sql
CREATE TABLE project_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Phase 8: Project Life Cycle Phases
**Complexity:** Medium | **Timeline:** 1 week

### Backend
- Create `project_phases` table (id, project_id, name, position, status, deliverables JSONB)
- Phase statuses: not_started, in_progress, completed, skipped
- Gate approval: `project_phase_gates` (phase_id, approver_id, approved_at, notes)
- Project-level status derived from phases

### Frontend
- Phase timeline/bar in ProjectHeader
- Phase detail panel with deliverables checklist
- Gate approval workflow (request → approve/reject)
- Phase-gated task visibility (tasks hidden until phase starts)

### Migration
```sql
CREATE TABLE project_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  status TEXT DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','skipped')),
  deliverables JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE project_phase_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id UUID NOT NULL REFERENCES project_phases(id) ON DELETE CASCADE,
  approver_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT
);
```

---

## Phase 9: Meeting Module
**Complexity:** Low-Medium | **Timeline:** 3-4 days

### Backend
- Create `project_meetings` table (id, project_id, title, start_time, end_time, location, agenda, minutes, created_by)
- Create `project_meeting_attendees` (meeting_id, user_id, status)
- Link meetings to tasks: `project_meeting_tasks`
- API: CRUD + attendee management

### Frontend
- Meetings tab in project detail
- Meeting scheduler modal
- Agenda/minutes editor
- Attendee RSVP list
- Meeting reminders (integrate with existing reminders system)

### Migration
```sql
CREATE TABLE project_meetings (
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

CREATE TABLE project_meeting_attendees (
  meeting_id UUID NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','tentative')),
  PRIMARY KEY (meeting_id, user_id)
);
```

---

## Phase 10: Portfolios & Multi-Project Views
**Complexity:** High | **Timeline:** 2 weeks

### Backend
- Create `portfolios` table (id, name, description, owner_id)
- Create `portfolio_projects` (portfolio_id, project_id, position)
- Aggregate APIs:
  - Portfolio health (RAG status per project)
  - Cross-project resource allocation
  - Portfolio-level Gantt (projects as top-level bars)
  - Milestone timeline across projects
  - Budget rollup

### Frontend
- New "Portfolios" top-level page
- Portfolio grid/list
- Portfolio detail: multi-project dashboard
- Cross-project Gantt view
- Resource heatmap across projects
- Portfolio KPIs: total tasks, completion %, budget, risk count

### Migration
```sql
CREATE TABLE portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE portfolio_projects (
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  PRIMARY KEY (portfolio_id, project_id)
);
```

---

## Summary Table

| Phase | Feature | Complexity | Est. Time | Depends On |
|-------|---------|-----------|-----------|------------|
| 1 | Work Package Types & Workflows | Medium | 1 week | — |
| 2 | Task Relations | Medium | 1 week | Phase 1 |
| 3 | Time Tracking Integration | Low-Med | 3-4 days | Phase 1 |
| 4 | Project Templates | Low | 2-3 days | Phase 1 |
| 5 | Agile Boards (Scrum/Sprints) | High | 2 weeks | Phase 1, 3 |
| 6 | Team Planner | High | 2 weeks | Phase 1, 3 |
| 7 | Baseline Comparison | Medium | 1 week | Phase 2 |
| 8 | Project Life Cycle Phases | Medium | 1 week | Phase 1 |
| 9 | Meeting Module | Low-Med | 3-4 days | — |
| 10 | Portfolios | High | 2 weeks | Phase 1-8 |

**Total Estimated Time:** ~11-12 weeks (2.5-3 months) for full implementation.

**Recommended Start:** Phase 1 + Phase 4 together (types + templates) gives the biggest immediate value.

---

## Technical Notes

- Each phase gets its own migration file (e.g., `035-task-types.sql`, `036-task-relations.sql`)
- All tables follow existing naming conventions (`project_*`)
- Use existing auth middleware and audit logger for all new endpoints
- Frontend components go in `client/src/components/projects/`
- Reuse existing patterns: axios hooks, modal patterns, toast notifications
- Consider adding `project_settings` JSONB column to `projects` for feature flags per project
