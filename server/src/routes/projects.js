const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db, sql } = require('../db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');

// File upload setup
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'projects');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router = express.Router();

// Utility to slugify a column name into a key
function toKey(name = '') {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    || 'col_' + Math.random().toString(36).slice(2, 8);
}

async function generateTaskId() {
  const { rows } = await sql`SELECT nextval('project_task_seq') AS seq`.execute(db);
  const seq = rows[0].seq;
  return `PRJ-${String(seq).padStart(4, '0')}`;
}

// Detect if setting childId as parent of parentId would create a cycle
async function wouldCreateCycle(projectId, taskId, newParentId) {
  if (!newParentId) return false;
  if (newParentId === taskId) return true;
  let current = newParentId;
  const visited = new Set();
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const row = await db.selectFrom('project_tasks')
      .where('id', '=', current)
      .where('project_id', '=', projectId)
      .select('parent_id')
      .executeTakeFirst();
    if (!row) break;
    if (row.parent_id === taskId) return true;
    current = row.parent_id;
  }
  return false;
}

async function getProjectTypes(projectId) {
  try {
    return await db.selectFrom('project_task_types')
      .where('project_id', '=', projectId)
      .selectAll()
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  } catch (err) {
    console.error('getProjectTypes error (table may not exist):', err.message);
    return [];
  }
}

async function getProjectWorkflows(projectId) {
  try {
    return await db.selectFrom('project_workflows')
      .where('project_id', '=', projectId)
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();
  } catch (err) {
    console.error('getProjectWorkflows error (table may not exist):', err.message);
    return [];
  }
}

async function getProjectTaskRelations(projectId) {
  try {
    const { rows } = await sql`
      SELECT ptr.*,
             ft.name AS from_task_name, ft.task_id AS from_task_task_id,
             tt.name AS to_task_name, tt.task_id AS to_task_task_id
      FROM project_task_relations ptr
      JOIN project_tasks ft ON ft.id = ptr.from_task_id
      JOIN project_tasks tt ON tt.id = ptr.to_task_id
      WHERE ptr.project_id = ${projectId}
      ORDER BY ptr.created_at ASC
    `.execute(db);
    return rows;
  } catch (err) {
    console.error('getProjectTaskRelations error (table may not exist):', err.message);
    return [];
  }
}

async function getProjectPhases(projectId) {
  try {
    const { rows } = await sql`
      SELECT pp.*,
             COALESCE(pg.approved_at IS NOT NULL, FALSE) AS gate_approved,
             pg.approver_id AS gate_approver_id,
             pg.notes AS gate_notes
      FROM project_phases pp
      LEFT JOIN project_phase_gates pg ON pg.phase_id = pp.id
      WHERE pp.project_id = ${projectId}
      ORDER BY pp.position ASC, pp.created_at ASC
    `.execute(db);
    return rows;
  } catch (err) {
    console.error('getProjectPhases error (table may not exist):', err.message);
    return [];
  }
}

async function getProjectMeetings(projectId) {
  try {
    const { rows: meetings } = await sql`
      SELECT pm.*, u.name AS created_by_name
      FROM project_meetings pm
      LEFT JOIN users u ON u.id = pm.created_by
      WHERE pm.project_id = ${projectId}
      ORDER BY pm.start_time ASC
    `.execute(db);
    const meetingIds = meetings.map((m) => m.id);
    let attendees = [];
    let linkedTasks = [];
    if (meetingIds.length > 0) {
      const { rows: attRows } = await sql`
        SELECT pma.*, u.name AS user_name, u.email AS user_email
        FROM project_meeting_attendees pma
        LEFT JOIN users u ON u.id = pma.user_id
        WHERE pma.meeting_id = ANY(${meetingIds})
      `.execute(db);
      attendees = attRows;
      const { rows: taskRows } = await sql`
        SELECT pmt.*, pt.name AS task_name, pt.task_id AS task_task_id
        FROM project_meeting_tasks pmt
        LEFT JOIN project_tasks pt ON pt.id = pmt.task_id
        WHERE pmt.meeting_id = ANY(${meetingIds})
      `.execute(db);
      linkedTasks = taskRows;
    }
    return meetings.map((m) => ({
      ...m,
      attendees: attendees.filter((a) => a.meeting_id === m.id),
      linked_tasks: linkedTasks.filter((t) => t.meeting_id === m.id),
    }));
  } catch (err) {
    console.error('getProjectMeetings error (table may not exist):', err.message);
    return [];
  }
}

async function getTasksInTreeOrder(projectId) {
  let rows;
  try {
    const res = await sql`
      SELECT t.*,
             COALESCE(sc.subtask_count, 0) AS subtask_count,
             ptt.name AS type_name, ptt.color AS type_color, ptt.icon AS type_icon
      FROM project_tasks t
      LEFT JOIN project_task_types ptt ON ptt.id = t.type_id
      LEFT JOIN (
        SELECT parent_id, COUNT(*) AS subtask_count
        FROM project_tasks
        WHERE project_id = ${projectId} AND parent_id IS NOT NULL
        GROUP BY parent_id
      ) sc ON sc.parent_id = t.id
      WHERE t.project_id = ${projectId}
      ORDER BY t.position ASC, t.created_at ASC
    `.execute(db);
    rows = res.rows;
  } catch (err) {
    console.error('getTasksInTreeOrder error (table may not exist):', err.message);
    return [];
  }

  const taskMap = new Map();
  rows.forEach((t) => taskMap.set(t.id, { ...t, children: [] }));
  const roots = [];
  rows.forEach((t) => {
    if (t.parent_id && taskMap.has(t.parent_id)) {
      taskMap.get(t.parent_id).children.push(t.id);
    } else {
      roots.push(t.id);
    }
  });

  function flattenTree(ids, depth = 0) {
    const result = [];
    for (const id of ids) {
      const node = taskMap.get(id);
      if (node) {
        result.push({ ...node, depth });
        result.push(...flattenTree(node.children, depth + 1));
      }
    }
    return result;
  }

  return flattenTree(roots);
}

async function fetchProjectBundle(projectId) {
  let project, columns, members;
  try {
    [project, columns, members] = await Promise.all([
      db.selectFrom('projects').where('id', '=', projectId).selectAll().executeTakeFirst(),
      db.selectFrom('project_columns').where('project_id', '=', projectId).selectAll().orderBy('position', 'asc').orderBy('created_at', 'asc').execute(),
      db.selectFrom('project_members as pm')
        .leftJoin('users as u', 'u.id', 'pm.user_id')
        .leftJoin('teams as t', 't.id', 'pm.team_id')
        .where('pm.project_id', '=', projectId)
        .select(['pm.*', 'u.email', 'u.name as user_name', 't.name as team_name'])
        .orderBy('pm.added_at', 'asc')
        .execute(),
    ]);
  } catch (err) {
    console.error('fetchProjectBundle initial query error:', err.message);
    project = await db.selectFrom('projects').where('id', '=', projectId).selectAll().executeTakeFirst();
    columns = [];
    members = [];
  }

  if (!project) return null;

  const [treeTasks, types, workflows, relations, phases, meetings] = await Promise.all([
    getTasksInTreeOrder(projectId),
    getProjectTypes(projectId),
    getProjectWorkflows(projectId),
    getProjectTaskRelations(projectId),
    getProjectPhases(projectId),
    getProjectMeetings(projectId),
  ]);

  return {
    project,
    columns: columns || [],
    tasks: treeTasks,
    members: members || [],
    types,
    workflows,
    relations,
    phases,
    meetings,
  };
}

// Check if user has at least the required role on a project
async function checkProjectAccess(projectId, userId, requiredRoles = ['owner', 'admin', 'member', 'viewer']) {
  try {
    // Owner always has full access
    const proj = await db.selectFrom('projects')
      .where('id', '=', projectId)
      .select('owner_id')
      .executeTakeFirst();
    if (!proj) return { allowed: false, reason: 'Project not found' };
    if (proj.owner_id === userId) return { allowed: true, role: 'owner' };

    // Check direct member access
    const member = await db.selectFrom('project_members')
      .where('project_id', '=', projectId)
      .where('user_id', '=', userId)
      .select('role')
      .executeTakeFirst();
    if (member && requiredRoles.includes(member.role)) {
      return { allowed: true, role: member.role };
    }

    // Check team-based access
    const teamAccess = await db.selectFrom('project_members as pm')
      .innerJoin('team_members as tm', 'tm.team_id', 'pm.team_id')
      .where('pm.project_id', '=', projectId)
      .where('tm.user_id', '=', userId)
      .select('pm.role')
      .limit(1)
      .executeTakeFirst();
    if (teamAccess && requiredRoles.includes(teamAccess.role)) {
      return { allowed: true, role: teamAccess.role };
    }

    return { allowed: false, reason: 'Access denied' };
  } catch (err) {
    console.error('Access check error:', err);
    return { allowed: false, reason: 'Server error' };
  }
}

// All routes require auth
router.use(auth);

// GET /api/projects
router.get('/', async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT p.*, COALESCE(pm_count.member_count, 0) AS member_count
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) AS member_count
        FROM project_members
        GROUP BY project_id
      ) pm_count ON pm_count.project_id = p.id
      WHERE p.status != 'deleted'
        AND (
          p.owner_id = ${req.user.id}
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = ${req.user.id}
          )
          OR EXISTS (
            SELECT 1 FROM project_members pm2
            JOIN team_members tm ON tm.team_id = pm2.team_id
            WHERE pm2.project_id = p.id AND tm.user_id = ${req.user.id}
          )
        )
      ORDER BY p.created_at DESC
    `.execute(db);
    res.json(rows);
  } catch (err) {
    console.error('Error listing projects (falling back to basic query):', err.message);
    try {
      const { rows } = await sql`
        SELECT p.*, 0 AS member_count
        FROM projects p
        WHERE p.status != 'deleted' AND p.owner_id = ${req.user.id}
        ORDER BY p.created_at DESC
      `.execute(db);
      res.json(rows);
    } catch (fallbackErr) {
      console.error('Fallback list projects error:', fallbackErr);
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Helper: clone a project from template
async function cloneProjectFromTemplate(templateId, user, { name, description, include_tasks }) {
  return await db.transaction().execute(async (trx) => {
    const template = await trx.selectFrom('projects')
      .where('id', '=', templateId)
      .selectAll()
      .executeTakeFirst();
    if (!template) throw new Error('Template not found');

    const newProject = await trx.insertInto('projects')
      .values({
        name: name.trim() || `${template.name} (Copy)`,
        description: description || template.description,
        team_id: template.team_id,
        owner_id: user.id,
        template_id: templateId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Copy columns
    const columns = await trx.selectFrom('project_columns')
      .where('project_id', '=', templateId)
      .selectAll()
      .orderBy('position', 'asc')
      .execute();
    const colIdMap = new Map();
    for (const col of columns) {
      const newCol = await trx.insertInto('project_columns')
        .values({
          project_id: newProject.id,
          name: col.name,
          key: col.key,
          type: col.type,
          config: col.config,
          position: col.position,
          is_required: col.is_required,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      colIdMap.set(col.id, newCol.id);
    }

    // Copy views
    const views = await trx.selectFrom('project_views')
      .where('project_id', '=', templateId)
      .selectAll()
      .execute();
    for (const view of views) {
      await trx.insertInto('project_views')
        .values({
          project_id: newProject.id,
          name: view.name,
          type: view.type,
          config: view.config,
          created_by: user.id,
          is_default: view.is_default,
        })
        .execute();
    }

    // Copy types
    const types = await trx.selectFrom('project_task_types')
      .where('project_id', '=', templateId)
      .orderBy('position', 'asc')
      .selectAll()
      .execute();
    const typeIdMap = new Map();
    for (const t of types) {
      const newType = await trx.insertInto('project_task_types')
        .values({
          project_id: newProject.id,
          name: t.name,
          color: t.color,
          icon: t.icon,
          position: t.position,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      typeIdMap.set(t.id, newType.id);
    }

    // Copy workflows
    const workflows = await trx.selectFrom('project_workflows')
      .where('project_id', '=', templateId)
      .selectAll()
      .execute();
    for (const w of workflows) {
      await trx.insertInto('project_workflows')
        .values({
          project_id: newProject.id,
          from_status: w.from_status,
          to_status: w.to_status,
          role_required: w.role_required,
          required_fields: w.required_fields,
        })
        .execute();
    }

    // Optionally copy tasks as skeletons
    if (include_tasks) {
      const templateTasks = await trx.selectFrom('project_tasks')
        .where('project_id', '=', templateId)
        .selectAll()
        .orderBy('position', 'asc')
        .orderBy('created_at', 'asc')
        .execute();
      const taskIdMap = new Map();
      for (const t of templateTasks) {
        const taskId = await generateTaskId();
        const newTask = await trx.insertInto('project_tasks')
          .values({
            project_id: newProject.id,
            task_id: taskId,
            name: t.name,
            description: t.description,
            values: '{}',
            position: t.position,
            parent_id: null,
            created_by: user.id,
            type_id: t.type_id ? typeIdMap.get(t.type_id) : null,
            estimated_hours: t.estimated_hours,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        taskIdMap.set(t.id, newTask.id);
      }
      // Fix parent_id references
      for (const t of templateTasks) {
        if (t.parent_id && taskIdMap.has(t.parent_id)) {
          await trx.updateTable('project_tasks')
            .set({ parent_id: taskIdMap.get(t.parent_id) })
            .where('id', '=', taskIdMap.get(t.id))
            .execute();
        }
      }
    }

    return newProject;
  }).then((newProject) => {
    logAction(user.id, user.email, 'clone', 'project', newProject.id, newProject.name);
    return newProject;
  });
}

// POST /api/projects
router.post('/', async (req, res) => {
  const { name, description, team_id, template_id, include_tasks, deal_id } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  // If template_id provided, delegate to clone logic
  if (template_id) {
    try {
      const newProject = await cloneProjectFromTemplate(template_id, req.user, { name, description, include_tasks: !!include_tasks });
      return res.status(201).json(newProject);
    } catch (err) {
      if (err.message === 'Template not found') return res.status(404).json({ error: 'Template not found' });
      console.error('Error cloning from template:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  try {
    const project = await db.insertInto('projects')
      .values({
        name: name.trim(),
        description: description || null,
        team_id: team_id || null,
        owner_id: req.user.id,
        deal_id: deal_id || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Create default columns (ignore if tables don't exist yet)
    try {
      const defaultColumns = [
        { name: 'Status', key: 'status', type: 'dropdown', config: { options: ['To Do', 'In Progress', 'Done'] }, position: 0 },
        { name: 'Priority', key: 'priority', type: 'dropdown', config: { options: ['Low', 'Medium', 'High'] }, position: 1 },
        { name: 'Due Date', key: 'due_date', type: 'date', config: {}, position: 2 },
        { name: 'Assignee', key: 'assignee', type: 'person', config: {}, position: 3 },
        { name: 'Progress', key: 'progress', type: 'progress', config: { min: 0, max: 100 }, position: 4 },
      ];
      for (const col of defaultColumns) {
        await db.insertInto('project_columns')
          .values({
            project_id: project.id,
            name: col.name,
            key: col.key,
            type: col.type,
            config: JSON.stringify(col.config),
            position: col.position,
            is_required: false,
          })
          .execute();
      }

      // Create default grid view
      await db.insertInto('project_views')
        .values({
          project_id: project.id,
          name: 'Default Grid',
          type: 'grid',
          config: '{}',
          created_by: req.user.id,
          is_default: true,
        })
        .execute();
    } catch (colErr) {
      console.error('Default columns/views creation skipped (tables may not exist):', colErr.message);
    }

    logAction(req.user.id, req.user.email, 'create', 'project', project.id, project.name);

    res.status(201).json(project);
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/projects/templates (must be BEFORE /:id)
router.get('/templates', async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT p.*, u.name AS owner_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.is_template = TRUE
      ORDER BY p.created_at DESC
    `.execute(db);
    res.json(rows);
  } catch (err) {
    console.error('Error listing templates:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/projects/:id
router.get('/:id', async (req, res) => {
  try {
    const bundle = await fetchProjectBundle(req.params.id);
    if (!bundle) return res.status(404).json({ error: 'Project not found' });
    res.json(bundle);
  } catch (err) {
    console.error('Error loading project:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/projects/:id
router.put('/:id', async (req, res) => {
  const { name, description, status } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE projects
      SET name = COALESCE(${name}, name),
          description = COALESCE(${description}, description),
          status = COALESCE(${status}, status),
          updated_at = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Project not found' });
    logAction(req.user.id, req.user.email, 'update', 'project', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating project:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/projects/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await sql`
      UPDATE projects SET status = 'deleted', updated_at = NOW() WHERE id = ${req.params.id} RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Project not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project', rows[0].id, rows[0].name);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting project:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Columns
router.get('/:id/columns', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_columns')
      .where('project_id', '=', req.params.id)
      .selectAll()
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing columns:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/columns', async (req, res) => {
  const { name, type, config, position, is_required } = req.body || {};
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });

  const key = req.body.key ? toKey(req.body.key) : toKey(name);

  try {
    const { rows } = await sql`
      INSERT INTO project_columns (project_id, name, key, type, config, position, is_required)
      VALUES (${req.params.id}, ${name.trim()}, ${key}, ${type}, ${config || {}}, COALESCE(${position}, 0), COALESCE(${!!is_required}, FALSE))
      RETURNING *
    `.execute(db);

    logAction(req.user.id, req.user.email, 'create', 'project_column', rows[0].id, rows[0].name);

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A column with that key already exists for this project' });
    }
    console.error('Error creating column:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/columns/:colId', async (req, res) => {
  const { name, config, position, is_required } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE project_columns
      SET name = COALESCE(${name}, name),
          config = COALESCE(${config}, config),
          position = COALESCE(${position}, position),
          is_required = COALESCE(${is_required}, is_required)
      WHERE id = ${req.params.colId} AND project_id = ${req.params.id}
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Column not found' });
    logAction(req.user.id, req.user.email, 'update', 'project_column', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating column:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/columns/:colId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_columns')
      .where('id', '=', req.params.colId)
      .where('project_id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Column not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_column', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting column:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Tasks
router.get('/:id/tasks', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_tasks')
      .where('project_id', '=', req.params.id)
      .selectAll()
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing tasks:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks', async (req, res) => {
  const { name, description, values, position, parent_id, type_id, estimated_hours, spent_hours, story_points, phase_id } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  try {
    let taskPosition = position;
    if (taskPosition === undefined || taskPosition === null) {
      const posRow = await db.selectFrom('project_tasks')
        .where('project_id', '=', req.params.id)
        .select(db.fn.coalesce(db.fn.max('position'), db.val(0)).as('max_pos'))
        .executeTakeFirst();
      taskPosition = (Number(posRow?.max_pos) || 0) + 1;
    }

    const taskId = await generateTaskId();
    const { rows } = await sql`
      INSERT INTO project_tasks (project_id, task_id, name, description, values, position, parent_id, type_id, estimated_hours, spent_hours, story_points, phase_id, created_by)
      VALUES (${req.params.id}, ${taskId}, ${name.trim()}, ${description || null}, ${values || {}}, ${taskPosition}, ${parent_id || null}, ${type_id || null}, ${estimated_hours || null}, ${spent_hours || 0}, ${story_points || null}, ${phase_id || null}, ${req.user.id})
      RETURNING *
    `.execute(db);

    logAction(req.user.id, req.user.email, 'create', 'project_task', rows[0].id, rows[0].name);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/tasks/:taskId', async (req, res) => {
  const { name, description, values, position, parent_id, type_id, estimated_hours, spent_hours, story_points, phase_id } = req.body || {};
  try {
    if (parent_id !== undefined) {
      const cyclic = await wouldCreateCycle(req.params.id, req.params.taskId, parent_id);
      if (cyclic) return res.status(400).json({ error: 'Cannot set a descendant as parent (cycle detected)' });
    }
    const { rows } = await sql`
      UPDATE project_tasks
      SET name = COALESCE(${name}, name),
          description = COALESCE(${description}, description),
          values = COALESCE(${values}, values),
          position = COALESCE(${position}, position),
          parent_id = COALESCE(${parent_id}, parent_id),
          type_id = COALESCE(${type_id}, type_id),
          estimated_hours = COALESCE(${estimated_hours}, estimated_hours),
          spent_hours = COALESCE(${spent_hours}, spent_hours),
          story_points = COALESCE(${story_points}, story_points),
          phase_id = COALESCE(${phase_id}, phase_id),
          updated_at = NOW()
      WHERE id = ${req.params.taskId} AND project_id = ${req.params.id}
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    logAction(req.user.id, req.user.email, 'update', 'project_task', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_tasks')
      .where('id', '=', req.params.taskId)
      .where('project_id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Task not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_task', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Comments ──────────────────────────────────────────────

router.get('/:id/tasks/:taskId/comments', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_task_comments as ptc')
      .innerJoin('users as u', 'u.id', 'ptc.user_id')
      .where('ptc.task_id', '=', req.params.taskId)
      .select(['ptc.*', 'u.email', 'u.name as user_name'])
      .orderBy('ptc.created_at', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing comments:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks/:taskId/comments', async (req, res) => {
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

  try {
    const { rows } = await sql`
      INSERT INTO project_task_comments (task_id, user_id, content)
      VALUES (${req.params.taskId}, ${req.user.id}, ${content.trim()})
      RETURNING *
    `.execute(db);
    // Re-fetch with user info
    const result = await db.selectFrom('project_task_comments as ptc')
      .innerJoin('users as u', 'u.id', 'ptc.user_id')
      .where('ptc.id', '=', rows[0].id)
      .select(['ptc.*', 'u.email', 'u.name as user_name'])
      .executeTakeFirst();
    logAction(req.user.id, req.user.email, 'create', 'task_comment', rows[0].id, content.slice(0, 80));
    res.status(201).json(result);
  } catch (err) {
    console.error('Error adding comment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/comments/:commentId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_task_comments')
      .where('id', '=', req.params.commentId)
      .where('task_id', '=', req.params.taskId)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Comment not found' });
    logAction(req.user.id, req.user.email, 'delete', 'task_comment', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting comment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Attachments ───────────────────────────────────────────

router.get('/:id/tasks/:taskId/attachments', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_task_attachments as pta')
      .innerJoin('users as u', 'u.id', 'pta.uploaded_by')
      .where('pta.task_id', '=', req.params.taskId)
      .select(['pta.*', 'u.email'])
      .orderBy('pta.created_at', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing attachments:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks/:taskId/attachments', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File is required' });

  try {
    const fileUrl = `/uploads/projects/${req.file.filename}`;
    const { rows } = await sql`
      INSERT INTO project_task_attachments (task_id, uploaded_by, file_name, file_url, file_size, mime_type)
      VALUES (${req.params.taskId}, ${req.user.id}, ${req.file.originalname}, ${fileUrl}, ${req.file.size}, ${req.file.mimetype || null})
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'create', 'task_attachment', rows[0].id, rows[0].file_name);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error uploading attachment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/attachments/:attId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_task_attachments')
      .where('id', '=', req.params.attId)
      .where('task_id', '=', req.params.taskId)
      .returning(['id', 'file_url'])
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Attachment not found' });

    // Remove file from disk
    const filePath = path.join(__dirname, '..', '..', row.file_url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    logAction(req.user.id, req.user.email, 'delete', 'task_attachment', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting attachment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Assignees ─────────────────────────────────────────────

router.get('/:id/tasks/:taskId/assignees', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_task_assignees as pta')
      .innerJoin('users as u', 'u.id', 'pta.user_id')
      .where('pta.task_id', '=', req.params.taskId)
      .select(['pta.*', 'u.email', 'u.name as user_name'])
      .orderBy('pta.created_at', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing assignees:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks/:taskId/assignees', async (req, res) => {
  const { user_id, role } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  try {
    const { rows } = await sql`
      INSERT INTO project_task_assignees (task_id, user_id, role)
      VALUES (${req.params.taskId}, ${user_id}, ${role || 'responsible'})
      ON CONFLICT (task_id, user_id) DO UPDATE SET role = ${role || 'responsible'}
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'assign', 'task_assignee', rows[0].id, `user ${user_id}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error adding assignee:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/assignees/:assigneeId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_task_assignees')
      .where('id', '=', req.params.assigneeId)
      .where('task_id', '=', req.params.taskId)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Assignee not found' });
    logAction(req.user.id, req.user.email, 'remove', 'task_assignee', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing assignee:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Dependencies ──────────────────────────────────────────

router.get('/:id/tasks/:taskId/dependencies', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_task_dependencies as ptd')
      .innerJoin('project_tasks as t', 't.id', 'ptd.depends_on_task_id')
      .where('ptd.task_id', '=', req.params.taskId)
      .select(['ptd.*', 't.name as depends_on_name', 't.task_id as depends_on_task_id'])
      .orderBy('ptd.created_at', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing dependencies:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks/:taskId/dependencies', async (req, res) => {
  const { depends_on_task_id, type } = req.body || {};
  if (!depends_on_task_id) return res.status(400).json({ error: 'depends_on_task_id is required' });

  try {
    const { rows } = await sql`
      INSERT INTO project_task_dependencies (task_id, depends_on_task_id, type)
      VALUES (${req.params.taskId}, ${depends_on_task_id}, ${type || 'finish_to_start'})
      ON CONFLICT (task_id, depends_on_task_id) DO UPDATE SET type = ${type || 'finish_to_start'}
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'create', 'task_dependency', rows[0].id, `${req.params.taskId}->${depends_on_task_id}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error adding dependency:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/dependencies/:depId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_task_dependencies')
      .where('id', '=', req.params.depId)
      .where('task_id', '=', req.params.taskId)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Dependency not found' });
    logAction(req.user.id, req.user.email, 'delete', 'task_dependency', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing dependency:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Relations (Phase 2) ──────────────────────────────────

// Helper: detect circular precedes/follows chains
async function wouldCreatePrecedesCycle(projectId, fromTaskId, toTaskId) {
  const visited = new Set();
  const queue = [toTaskId];
  while (queue.length) {
    const current = queue.shift();
    if (current === fromTaskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const { rows } = await sql`
      SELECT to_task_id FROM project_task_relations
      WHERE project_id = ${projectId} AND from_task_id = ${current} AND relation_type IN ('precedes', 'follows')
    `.execute(db);
    for (const r of rows) queue.push(r.to_task_id);
  }
  return false;
}

router.get('/:id/tasks/:taskId/relations', async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT ptr.*,
             ft.name AS from_task_name, ft.task_id AS from_task_task_id,
             tt.name AS to_task_name, tt.task_id AS to_task_task_id
      FROM project_task_relations ptr
      JOIN project_tasks ft ON ft.id = ptr.from_task_id
      JOIN project_tasks tt ON tt.id = ptr.to_task_id
      WHERE ptr.project_id = ${req.params.id}
        AND (ptr.from_task_id = ${req.params.taskId} OR ptr.to_task_id = ${req.params.taskId})
      ORDER BY ptr.created_at ASC
    `.execute(db);
    res.json(rows);
  } catch (err) {
    console.error('Error listing relations:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks/:taskId/relations', async (req, res) => {
  const { to_task_id, relation_type, delay_days } = req.body || {};
  if (!to_task_id) return res.status(400).json({ error: 'to_task_id is required' });
  if (!relation_type) return res.status(400).json({ error: 'relation_type is required' });

  const validTypes = ['precedes', 'follows', 'blocks', 'blocked_by', 'duplicates', 'relates_to', 'part_of'];
  if (!validTypes.includes(relation_type)) {
    return res.status(400).json({ error: `Invalid relation_type. Must be one of: ${validTypes.join(', ')}` });
  }

  const projectId = req.params.id;
  const fromTaskId = req.params.taskId;

  if (fromTaskId === to_task_id) {
    return res.status(400).json({ error: 'Cannot relate a task to itself' });
  }

  try {
    // Prevent circular precedes/follows chains
    if (relation_type === 'precedes' || relation_type === 'follows') {
      const cyclic = await wouldCreatePrecedesCycle(projectId, fromTaskId, to_task_id);
      if (cyclic) return res.status(400).json({ error: 'This relation would create a cycle' });
    }

    const { rows } = await sql`
      INSERT INTO project_task_relations (project_id, from_task_id, to_task_id, relation_type, delay_days)
      VALUES (${projectId}, ${fromTaskId}, ${to_task_id}, ${relation_type}, ${delay_days || 0})
      ON CONFLICT (from_task_id, to_task_id, relation_type) DO UPDATE SET delay_days = ${delay_days || 0}
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'create', 'task_relation', rows[0].id, `${relation_type} ${fromTaskId}→${to_task_id}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error adding relation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/relations/:relId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_task_relations')
      .where('id', '=', req.params.relId)
      .where('project_id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Relation not found' });
    logAction(req.user.id, req.user.email, 'delete', 'task_relation', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing relation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Subtasks ───────────────────────────────────────────────────

router.get('/:id/tasks/:taskId/subtasks', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_tasks')
      .where('parent_id', '=', req.params.taskId)
      .selectAll()
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing subtasks:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Indent / Outdent ───────────────────────────────────────────

router.post('/:id/tasks/:taskId/indent', async (req, res) => {
  try {
    const projectId = req.params.id;
    const taskId = req.params.taskId;

    // Get current task
    const task = await db.selectFrom('project_tasks')
      .where('id', '=', taskId)
      .where('project_id', '=', projectId)
      .selectAll()
      .executeTakeFirst();
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (task.parent_id) return res.status(400).json({ error: 'Task is already a subtask' });

    // Find the task immediately above in tree order
    const treeTasks = await getTasksInTreeOrder(projectId);
    const idx = treeTasks.findIndex((t) => t.id === taskId);
    if (idx <= 0) return res.status(400).json({ error: 'No task above to indent under' });
    const newParentId = treeTasks[idx - 1].id;

    const cyclic = await wouldCreateCycle(projectId, taskId, newParentId);
    if (cyclic) return res.status(400).json({ error: 'Cannot indent under a descendant' });

    const { rows } = await sql`
      UPDATE project_tasks SET parent_id = ${newParentId}, updated_at = NOW()
      WHERE id = ${taskId} AND project_id = ${projectId} RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'indent', 'project_task', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error indenting task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks/:taskId/outdent', async (req, res) => {
  try {
    const projectId = req.params.id;
    const taskId = req.params.taskId;

    const task = await db.selectFrom('project_tasks')
      .where('id', '=', taskId)
      .where('project_id', '=', projectId)
      .selectAll()
      .executeTakeFirst();
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (!task.parent_id) return res.status(400).json({ error: 'Task is not a subtask' });

    // Get the parent's parent (grandparent) to potentially promote to that level, or null
    const parentRow = await db.selectFrom('project_tasks')
      .where('id', '=', task.parent_id)
      .where('project_id', '=', projectId)
      .select('parent_id')
      .executeTakeFirst();
    const newParentId = parentRow?.parent_id || null;

    const { rows } = await sql`
      UPDATE project_tasks SET parent_id = ${newParentId}, updated_at = NOW()
      WHERE id = ${taskId} AND project_id = ${projectId} RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'outdent', 'project_task', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error outdenting task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Static file serving for attachments (also served via express.static in index.js)
router.get('/attachments/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).json({ error: 'File not found' });
});

// ── Saved Views ───────────────────────────────────────────────

router.get('/:id/views', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_views')
      .where('project_id', '=', req.params.id)
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing views:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/views', async (req, res) => {
  const { name, type, config, is_default } = req.body || {};
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });

  try {
    if (is_default) {
      await db.updateTable('project_views')
        .set({ is_default: false })
        .where('project_id', '=', req.params.id)
        .where('type', '=', type)
        .execute();
    }
    const { rows } = await sql`
      INSERT INTO project_views (project_id, name, type, config, created_by, is_default)
      VALUES (${req.params.id}, ${name.trim()}, ${type}, ${config || {}}, ${req.user.id}, COALESCE(${is_default}, FALSE))
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'create', 'project_view', rows[0].id, rows[0].name);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error saving view:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/views/:viewId', async (req, res) => {
  const { name, config, is_default } = req.body || {};
  try {
    if (is_default) {
      const view = await db.selectFrom('project_views')
        .where('id', '=', req.params.viewId)
        .select('type')
        .executeTakeFirst();
      if (view) {
        await db.updateTable('project_views')
          .set({ is_default: false })
          .where('project_id', '=', req.params.id)
          .where('type', '=', view.type)
          .execute();
      }
    }
    const { rows } = await sql`
      UPDATE project_views
      SET name = COALESCE(${name}, name),
          config = COALESCE(${config}, config),
          is_default = COALESCE(${is_default}, is_default)
      WHERE id = ${req.params.viewId} AND project_id = ${req.params.id}
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'View not found' });
    logAction(req.user.id, req.user.email, 'update', 'project_view', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating view:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/views/:viewId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_views')
      .where('id', '=', req.params.viewId)
      .where('project_id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'View not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_view', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting view:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Project Members ───────────────────────────────────────────

router.get('/:id/members', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_members as pm')
      .leftJoin('users as u', 'u.id', 'pm.user_id')
      .leftJoin('teams as t', 't.id', 'pm.team_id')
      .where('pm.project_id', '=', req.params.id)
      .select(['pm.*', 'u.email', 'u.name as user_name', 't.name as team_name'])
      .orderBy('pm.added_at', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing members:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/members', async (req, res) => {
  const { user_id, team_id, role } = req.body || {};
  if (!user_id && !team_id) return res.status(400).json({ error: 'user_id or team_id is required' });

  try {
    // Check access
    const access = await checkProjectAccess(req.params.id, req.user.id, ['owner', 'admin']);
    if (!access.allowed) return res.status(403).json({ error: access.reason });

    const { rows } = await sql`
      INSERT INTO project_members (project_id, user_id, team_id, role)
      VALUES (${req.params.id}, ${user_id || null}, ${team_id || null}, ${role || 'member'})
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'add', 'project_member', rows[0].id,
      user_id ? `user ${user_id}` : `team ${team_id}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error adding member:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/members/:memberId', async (req, res) => {
  const { role } = req.body || {};
  if (!role) return res.status(400).json({ error: 'role is required' });

  try {
    const access = await checkProjectAccess(req.params.id, req.user.id, ['owner', 'admin']);
    if (!access.allowed) return res.status(403).json({ error: access.reason });

    const { rows } = await sql`
      UPDATE project_members SET role = ${role} WHERE id = ${req.params.memberId} AND project_id = ${req.params.id} RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Member not found' });
    logAction(req.user.id, req.user.email, 'update', 'project_member', rows[0].id, `role -> ${role}`);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating member:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/members/:memberId', async (req, res) => {
  try {
    const access = await checkProjectAccess(req.params.id, req.user.id, ['owner', 'admin']);
    if (!access.allowed) return res.status(403).json({ error: access.reason });

    const row = await db.deleteFrom('project_members')
      .where('id', '=', req.params.memberId)
      .where('project_id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Member not found' });
    logAction(req.user.id, req.user.email, 'remove', 'project_member', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing member:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Types ────────────────────────────────────────────────

router.get('/:id/types', async (req, res) => {
  try {
    const rows = await getProjectTypes(req.params.id);
    res.json(rows);
  } catch (err) {
    console.error('Error listing types:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/types', async (req, res) => {
  const { name, color, icon, position } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await sql`
      INSERT INTO project_task_types (project_id, name, color, icon, position)
      VALUES (${req.params.id}, ${name.trim()}, ${color || '#3B82F6'}, ${icon || 'task'}, COALESCE(${position}, 0))
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'create', 'project_task_type', rows[0].id, rows[0].name);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A type with that name already exists' });
    console.error('Error creating type:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/types/:typeId', async (req, res) => {
  const { name, color, icon, position } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE project_task_types
      SET name = COALESCE(${name}, name),
          color = COALESCE(${color}, color),
          icon = COALESCE(${icon}, icon),
          position = COALESCE(${position}, position)
      WHERE id = ${req.params.typeId} AND project_id = ${req.params.id}
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Type not found' });
    logAction(req.user.id, req.user.email, 'update', 'project_task_type', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating type:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/types/:typeId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_task_types')
      .where('id', '=', req.params.typeId)
      .where('project_id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Type not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_task_type', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting type:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Workflows ─────────────────────────────────────────────────

router.get('/:id/workflows', async (req, res) => {
  try {
    const rows = await getProjectWorkflows(req.params.id);
    res.json(rows);
  } catch (err) {
    console.error('Error listing workflows:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/workflows', async (req, res) => {
  const { from_status, to_status, role_required, required_fields } = req.body || {};
  if (!from_status || !to_status) return res.status(400).json({ error: 'from_status and to_status are required' });
  try {
    const { rows } = await sql`
      INSERT INTO project_workflows (project_id, from_status, to_status, role_required, required_fields)
      VALUES (${req.params.id}, ${from_status}, ${to_status}, ${role_required || null}, ${required_fields || null})
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'create', 'project_workflow', rows[0].id, `${from_status} → ${to_status}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That transition already exists' });
    console.error('Error creating workflow:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/workflows/:workflowId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_workflows')
      .where('id', '=', req.params.workflowId)
      .where('project_id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Workflow not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_workflow', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting workflow:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Bulk Task Operations ──────────────────────────────────────

router.post('/:id/tasks/bulk-delete', async (req, res) => {
  const { task_ids } = req.body || {};
  if (!Array.isArray(task_ids) || task_ids.length === 0) {
    return res.status(400).json({ error: 'task_ids array is required' });
  }

  try {
    const { rows } = await sql`
      DELETE FROM project_tasks WHERE id = ANY(${task_ids}::uuid[]) AND project_id = ${req.params.id} RETURNING id
    `.execute(db);
    logAction(req.user.id, req.user.email, 'bulk_delete', 'project_task', null, `${rows.length} tasks`);
    res.json({ deleted: rows.length, ids: rows.map((r) => r.id) });
  } catch (err) {
    console.error('Error bulk deleting tasks:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks/bulk-update', async (req, res) => {
  const { task_ids, values, name, description, position } = req.body || {};
  if (!Array.isArray(task_ids) || task_ids.length === 0) {
    return res.status(400).json({ error: 'task_ids array is required' });
  }

  try {
    const setClauses = [];
    const params = [];
    let idx = 0;

    if (values && typeof values === 'object') {
      setClauses.push(sql`values = values || ${JSON.stringify(values)}::jsonb`);
    }
    if (name !== undefined) {
      setClauses.push(sql`name = COALESCE(${name}, name)`);
    }
    if (description !== undefined) {
      setClauses.push(sql`description = COALESCE(${description}, description)`);
    }
    if (position !== undefined) {
      setClauses.push(sql`position = COALESCE(${position}, position)`);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { rows } = await sql`
      UPDATE project_tasks
      SET ${sql.join(setClauses, sql`, `)}, updated_at = NOW()
      WHERE id = ANY(${task_ids}::uuid[]) AND project_id = ${req.params.id}
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'bulk_update', 'project_task', null, `${rows.length} tasks`);
    res.json({ updated: rows.length, tasks: rows });
  } catch (err) {
    console.error('Error bulk updating tasks:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Time Entries ───────────────────────────────────────────────

router.get('/:id/tasks/:taskId/time-entries', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_time_entries as pte')
      .innerJoin('users as u', 'u.id', 'pte.user_id')
      .where('pte.task_id', '=', req.params.taskId)
      .select(['pte.*', 'u.name as user_name', 'u.email'])
      .orderBy('pte.logged_at', 'desc')
      .orderBy('pte.created_at', 'desc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing time entries:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks/:taskId/time-entries', async (req, res) => {
  const { hours, description, billable, hourly_rate, logged_at } = req.body || {};
  if (!hours || isNaN(hours) || Number(hours) <= 0) {
    return res.status(400).json({ error: 'hours must be a positive number' });
  }

  try {
    const { rows } = await sql`
      INSERT INTO project_time_entries (task_id, user_id, hours, description, billable, hourly_rate, logged_at)
      VALUES (${req.params.taskId}, ${req.user.id}, ${Number(hours)}, ${description || null}, ${billable !== false}, ${hourly_rate || 0}, COALESCE(${logged_at || null}, CURRENT_DATE))
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'create', 'time_entry', rows[0].id, `${hours}h`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating time entry:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/time-entries/:entryId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_time_entries')
      .where('id', '=', req.params.entryId)
      .where('task_id', '=', req.params.taskId)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Time entry not found' });
    logAction(req.user.id, req.user.email, 'delete', 'time_entry', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting time entry:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/projects/:id/clone
router.post('/:id/clone', async (req, res) => {
  try {
    const newProject = await cloneProjectFromTemplate(req.params.id, req.user, req.body || {});
    res.status(201).json(newProject);
  } catch (err) {
    if (err.message === 'Template not found') return res.status(404).json({ error: 'Template not found' });
    console.error('Error cloning project:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/projects/:id/save-as-template
router.post('/:id/save-as-template', async (req, res) => {
  try {
    const { rows } = await sql`
      UPDATE projects SET is_template = TRUE, updated_at = NOW() WHERE id = ${req.params.id} RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Project not found' });
    logAction(req.user.id, req.user.email, 'save_as_template', 'project', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error saving as template:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Sprints ────────────────────────────────────────────────────

// GET /api/projects/:id/sprints
router.get('/:id/sprints', async (req, res) => {
  try {
    const rows = await db.selectFrom('sprints')
      .where('project_id', '=', req.params.id)
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing sprints:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/sprints', async (req, res) => {
  const { name, goal, start_date, end_date } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  try {
    const { rows } = await sql`
      INSERT INTO sprints (project_id, name, goal, start_date, end_date)
      VALUES (${req.params.id}, ${name.trim()}, ${goal || null}, ${start_date || null}, ${end_date || null})
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'create', 'sprint', rows[0].id, rows[0].name);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating sprint:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/sprints/:sprintId', async (req, res) => {
  const { name, goal, start_date, end_date, status } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE sprints
      SET name = COALESCE(${name}, name),
          goal = COALESCE(${goal}, goal),
          start_date = COALESCE(${start_date}, start_date),
          end_date = COALESCE(${end_date}, end_date),
          status = COALESCE(${status}, status),
          updated_at = NOW()
      WHERE id = ${req.params.sprintId} AND project_id = ${req.params.id}
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Sprint not found' });
    logAction(req.user.id, req.user.email, 'update', 'sprint', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating sprint:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/sprints/:sprintId', async (req, res) => {
  try {
    const row = await db.deleteFrom('sprints')
      .where('id', '=', req.params.sprintId)
      .where('project_id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Sprint not found' });
    logAction(req.user.id, req.user.email, 'delete', 'sprint', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting sprint:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Sprint task management
router.get('/:id/sprints/:sprintId/tasks', async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT st.*, t.name AS task_name, t.task_id, t.values, t.status
      FROM sprint_tasks st
      JOIN project_tasks t ON t.id = st.task_id
      WHERE st.sprint_id = ${req.params.sprintId}
      ORDER BY st.position ASC, st.created_at ASC
    `.execute(db);
    res.json(rows);
  } catch (err) {
    console.error('Error listing sprint tasks:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/sprints/:sprintId/tasks', async (req, res) => {
  const { task_id, story_points, position } = req.body || {};
  if (!task_id) return res.status(400).json({ error: 'task_id is required' });

  try {
    const { rows } = await sql`
      INSERT INTO sprint_tasks (sprint_id, task_id, story_points, position)
      VALUES (${req.params.sprintId}, ${task_id}, ${story_points}, COALESCE(${position}, 0))
      ON CONFLICT (sprint_id, task_id) DO UPDATE SET story_points = ${story_points}, position = COALESCE(${position}, sprint_tasks.position)
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'add', 'sprint_task', rows[0].id, `task ${task_id} -> sprint ${req.params.sprintId}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error adding sprint task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/sprints/:sprintId/tasks/:taskId', async (req, res) => {
  try {
    const row = await db.deleteFrom('sprint_tasks')
      .where('sprint_id', '=', req.params.sprintId)
      .where('task_id', '=', req.params.taskId)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Task not found in sprint' });
    logAction(req.user.id, req.user.email, 'remove', 'sprint_task', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing sprint task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Backlog: tasks not in any sprint for this project
router.get('/:id/backlog', async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT t.*
      FROM project_tasks t
      WHERE t.project_id = ${req.params.id}
        AND NOT EXISTS (
          SELECT 1 FROM sprint_tasks st
          JOIN sprints s ON s.id = st.sprint_id
          WHERE st.task_id = t.id AND s.project_id = ${req.params.id}
        )
      ORDER BY t.position ASC, t.created_at ASC
    `.execute(db);
    res.json(rows);
  } catch (err) {
    console.error('Error loading backlog:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Burndown data for a sprint
router.get('/:id/sprints/:sprintId/burndown', async (req, res) => {
  try {
    const sprint = await db.selectFrom('sprints')
      .where('id', '=', req.params.sprintId)
      .where('project_id', '=', req.params.id)
      .selectAll()
      .executeTakeFirst();
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

    const totalRow = await db.selectFrom('sprint_tasks')
      .where('sprint_id', '=', req.params.sprintId)
      .select(db.fn.sum('story_points').as('total'))
      .executeTakeFirst();
    const totalPoints = Number(totalRow?.total) || 0;

    // Simple linear ideal burndown
    const start = sprint.start_date ? new Date(sprint.start_date) : new Date(sprint.created_at);
    const end = sprint.end_date ? new Date(sprint.end_date) : new Date(start.getTime() + 14 * 86400000);
    const days = Math.max(1, Math.ceil((end - start) / 86400000));

    const ideal = [];
    for (let i = 0; i <= days; i++) {
      ideal.push({ day: i, remaining: Math.round(totalPoints * (1 - i / days)) });
    }

    // Actual: count done tasks per day (simplified — assumes status column exists in values)
    const actual = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const { rows: doneRows } = await sql`
        SELECT COALESCE(SUM(st.story_points), 0) AS done
        FROM sprint_tasks st
        JOIN project_tasks t ON t.id = st.task_id
        WHERE st.sprint_id = ${req.params.sprintId}
          AND t.values->>'status' = 'Done'
          AND t.updated_at::date <= ${d.toISOString().slice(0, 10)}
      `.execute(db);
      const done = Number(doneRows[0].done) || 0;
      actual.push({ day: i, date: d.toISOString().slice(0, 10), remaining: totalPoints - done });
    }

    res.json({ sprint, total_points: totalPoints, ideal, actual });
  } catch (err) {
    console.error('Error generating burndown:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Velocity: avg story points per completed sprint
router.get('/:id/velocity', async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT s.id, s.name, s.end_date,
             COALESCE(SUM(st.story_points), 0) AS total_points
      FROM sprints s
      LEFT JOIN sprint_tasks st ON st.sprint_id = s.id
      WHERE s.project_id = ${req.params.id} AND s.status = 'closed'
      GROUP BY s.id, s.name, s.end_date
      ORDER BY s.end_date DESC
      LIMIT 10
    `.execute(db);
    const velocities = rows.map((r) => ({ ...r, total_points: Number(r.total_points) }));
    const avg = velocities.length ? Math.round(velocities.reduce((sum, v) => sum + v.total_points, 0) / velocities.length) : 0;
    res.json({ sprints: velocities, average: avg });
  } catch (err) {
    console.error('Error calculating velocity:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Schedule (Team Planner) ───────────────────────────────

router.get('/:id/tasks/:taskId/schedule', async (req, res) => {
  try {
    const rows = await db.selectFrom('task_assignee_dates as tad')
      .innerJoin('users as u', 'u.id', 'tad.user_id')
      .where('tad.task_id', '=', req.params.taskId)
      .select(['tad.*', 'u.email', 'u.name as user_name'])
      .orderBy('tad.start_date', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing schedule:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks/:taskId/schedule', async (req, res) => {
  const { user_id, start_date, end_date, allocation_percent } = req.body || {};
  if (!user_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'user_id, start_date, and end_date are required' });
  }

  try {
    const { rows } = await sql`
      INSERT INTO task_assignee_dates (task_id, user_id, start_date, end_date, allocation_percent)
      VALUES (${req.params.taskId}, ${user_id}, ${start_date}, ${end_date}, COALESCE(${allocation_percent}, 100))
      ON CONFLICT (task_id, user_id) DO UPDATE SET
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        allocation_percent = EXCLUDED.allocation_percent,
        updated_at = NOW()
      RETURNING *
    `.execute(db);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error saving schedule:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/schedule/:scheduleId', async (req, res) => {
  try {
    const row = await db.deleteFrom('task_assignee_dates')
      .where('id', '=', req.params.scheduleId)
      .where('task_id', '=', req.params.taskId)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting schedule:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Workload Summary ───────────────────────────────────────────

router.get('/:id/workload', async (req, res) => {
  try {
    const { from, to } = req.query;

    // Get all project members + their scheduled tasks
    const { rows: assignments } = await (async () => {
      if (from && to) {
        return await sql`
          SELECT tad.*, t.name AS task_name, t.task_id,
                 u.email, u.name AS user_name
          FROM task_assignee_dates tad
          JOIN project_tasks t ON t.id = tad.task_id
          JOIN users u ON u.id = tad.user_id
          WHERE t.project_id = ${req.params.id}
            AND tad.start_date <= ${to} AND tad.end_date >= ${from}
          ORDER BY tad.start_date ASC
        `.execute(db);
      }
      return await sql`
        SELECT tad.*, t.name AS task_name, t.task_id,
               u.email, u.name AS user_name
        FROM task_assignee_dates tad
        JOIN project_tasks t ON t.id = tad.task_id
        JOIN users u ON u.id = tad.user_id
        WHERE t.project_id = ${req.params.id}
        ORDER BY tad.start_date ASC
      `.execute(db);
    })();

    // Aggregate workload per user per day
    const { rows: daily } = await (async () => {
      if (from && to) {
        return await sql`
          SELECT
            tad.user_id,
            u.name AS user_name,
            tad.start_date + generate_series(0, tad.end_date - tad.start_date) AS work_date,
            SUM(tad.allocation_percent) AS total_allocation
          FROM task_assignee_dates tad
          JOIN project_tasks t ON t.id = tad.task_id
          JOIN users u ON u.id = tad.user_id
          WHERE t.project_id = ${req.params.id}
            AND tad.start_date <= ${to} AND tad.end_date >= ${from}
          GROUP BY tad.user_id, u.name, tad.start_date + generate_series(0, tad.end_date - tad.start_date)
          ORDER BY work_date ASC
        `.execute(db);
      }
      return await sql`
        SELECT
          tad.user_id,
          u.name AS user_name,
          tad.start_date + generate_series(0, tad.end_date - tad.start_date) AS work_date,
          SUM(tad.allocation_percent) AS total_allocation
        FROM task_assignee_dates tad
        JOIN project_tasks t ON t.id = tad.task_id
        JOIN users u ON u.id = tad.user_id
        WHERE t.project_id = ${req.params.id}
        GROUP BY tad.user_id, u.name, tad.start_date + generate_series(0, tad.end_date - tad.start_date)
        ORDER BY work_date ASC
      `.execute(db);
    })();

    res.json({ assignments, daily });
  } catch (err) {
    console.error('Error loading workload:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Baselines ────────────────────────────────────────────────

router.get('/:id/baselines', async (req, res) => {
  try {
    const rows = await db.selectFrom('project_baselines')
      .where('project_id', '=', req.params.id)
      .select(['id', 'name', 'created_by', 'created_at'])
      .orderBy('created_at', 'desc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing baselines:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/baselines', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Baseline name is required' });
  }

  try {
    const { rows: captureRows } = await sql`
      SELECT capture_project_baseline(${req.params.id}) AS snapshot
    `.execute(db);
    const snapshot = captureRows[0].snapshot;

    const { rows: baselineRows } = await sql`
      INSERT INTO project_baselines (project_id, name, snapshot, created_by)
      VALUES (${req.params.id}, ${name.trim()}, ${snapshot}, ${req.user.id})
      RETURNING id, name, created_at
    `.execute(db);

    logAction(req.user.id, req.user.email, 'create', 'project_baseline', baselineRows[0].id, baselineRows[0].name);
    res.status(201).json(baselineRows[0]);
  } catch (err) {
    console.error('Error saving baseline:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/baselines/:baselineId', async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT * FROM project_baselines WHERE id = ${req.params.baselineId} AND project_id = ${req.params.id}
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Baseline not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error loading baseline:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/baselines/:baselineId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_baselines')
      .where('id', '=', req.params.baselineId)
      .where('project_id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Baseline not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_baseline', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting baseline:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Compare current project state vs baseline
router.get('/:id/baselines/:baselineId/compare', async (req, res) => {
  try {
    // Load baseline
    const { rows: baselineRows } = await sql`
      SELECT snapshot FROM project_baselines WHERE id = ${req.params.baselineId} AND project_id = ${req.params.id}
    `.execute(db);
    if (!baselineRows[0]) return res.status(404).json({ error: 'Baseline not found' });
    const baseline = baselineRows[0].snapshot;

    // Load current state
    const { rows: currentRows } = await sql`
      SELECT capture_project_baseline(${req.params.id}) AS snapshot
    `.execute(db);
    const current = currentRows[0].snapshot;

    // Diff tasks
    const baselineTasks = baseline.tasks || [];
    const currentTasks = current.tasks || [];
    const baselineTaskMap = new Map(baselineTasks.map((t) => [t.id, t]));
    const currentTaskMap = new Map(currentTasks.map((t) => [t.id, t]));

    const added = [];
    const removed = [];
    const changed = [];

    for (const t of currentTasks) {
      const b = baselineTaskMap.get(t.id);
      if (!b) {
        added.push(t);
      } else {
        const changes = [];
        if (t.name !== b.name) changes.push({ field: 'name', from: b.name, to: t.name });
        if (t.status !== b.status) changes.push({ field: 'status', from: b.status, to: t.status });
        if (t.progress !== b.progress) changes.push({ field: 'progress', from: b.progress, to: t.progress });
        if (t.priority !== b.priority) changes.push({ field: 'priority', from: b.priority, to: t.priority });
        if (t.due_date !== b.due_date) changes.push({ field: 'due_date', from: b.due_date, to: t.due_date });
        if (t.estimated_hours !== b.estimated_hours) changes.push({ field: 'estimated_hours', from: b.estimated_hours, to: t.estimated_hours });
        if (t.spent_hours !== b.spent_hours) changes.push({ field: 'spent_hours', from: b.spent_hours, to: t.spent_hours });
        if (t.parent_id !== b.parent_id) changes.push({ field: 'parent_id', from: b.parent_id, to: t.parent_id });
        if (changes.length > 0) {
          changed.push({ task: t, changes });
        }
      }
    }

    for (const t of baselineTasks) {
      if (!currentTaskMap.has(t.id)) removed.push(t);
    }

    res.json({
      baseline_name: baselineRows[0].name,
      baseline_date: baselineRows[0].created_at,
      added,
      removed,
      changed,
      summary: {
        total_baseline: baselineTasks.length,
        total_current: currentTasks.length,
        added_count: added.length,
        removed_count: removed.length,
        changed_count: changed.length,
      },
    });
  } catch (err) {
    console.error('Error comparing baseline:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Project Phases ─────────────────────────────────────────────

router.get('/:id/phases', async (req, res) => {
  try {
    const phases = await getProjectPhases(req.params.id);
    res.json(phases);
  } catch (err) {
    console.error('Error listing phases:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/phases', async (req, res) => {
  const { name, position, deliverables } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  try {
    const { rows } = await sql`
      INSERT INTO project_phases (project_id, name, position, deliverables)
      VALUES (${req.params.id}, ${name.trim()}, COALESCE(${position}, 0), COALESCE(${JSON.stringify(deliverables || [])}::jsonb, '[]'::jsonb))
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'create', 'project_phase', rows[0].id, rows[0].name);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating phase:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/phases/:phaseId', async (req, res) => {
  const { name, position, status, deliverables, started_at, completed_at } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE project_phases
      SET name = COALESCE(${name}, name),
          position = COALESCE(${position}, position),
          status = COALESCE(${status}, status),
          deliverables = COALESCE(${deliverables ? JSON.stringify(deliverables) : null}::jsonb, deliverables),
          started_at = COALESCE(${started_at}, started_at),
          completed_at = COALESCE(${completed_at}, completed_at),
          updated_at = NOW()
      WHERE id = ${req.params.phaseId} AND project_id = ${req.params.id}
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Phase not found' });
    logAction(req.user.id, req.user.email, 'update', 'project_phase', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating phase:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/phases/:phaseId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_phases')
      .where('id', '=', req.params.phaseId)
      .where('project_id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Phase not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_phase', row.id, row.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting phase:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Phase Gate Approval ────────────────────────────────────────

router.post('/:id/phases/:phaseId/gate', async (req, res) => {
  const { notes } = req.body || {};
  try {
    // Check if already approved
    const existing = await db.selectFrom('project_phase_gates')
      .where('phase_id', '=', req.params.phaseId)
      .select('id')
      .executeTakeFirst();
    let result;
    if (existing) {
      const { rows } = await sql`
        UPDATE project_phase_gates
        SET approver_id = ${req.user.id}, approved_at = NOW(), notes = COALESCE(${notes}, notes)
        WHERE phase_id = ${req.params.phaseId}
        RETURNING *
      `.execute(db);
      result = rows[0];
    } else {
      const { rows } = await sql`
        INSERT INTO project_phase_gates (phase_id, approver_id, approved_at, notes)
        VALUES (${req.params.phaseId}, ${req.user.id}, NOW(), ${notes})
        RETURNING *
      `.execute(db);
      result = rows[0];
    }
    logAction(req.user.id, req.user.email, 'approve', 'phase_gate', result.id, `phase ${req.params.phaseId}`);
    res.json(result);
  } catch (err) {
    console.error('Error approving gate:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/phases/:phaseId/gate', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_phase_gates')
      .where('phase_id', '=', req.params.phaseId)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Gate not found' });
    logAction(req.user.id, req.user.email, 'revoke', 'phase_gate', row.id, `phase ${req.params.phaseId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Error revoking gate:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Meetings ─────────────────────────────────────────────────────

router.get('/:id/meetings', async (req, res) => {
  try {
    const meetings = await getProjectMeetings(req.params.id);
    res.json(meetings);
  } catch (err) {
    console.error('Error listing meetings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/meetings', async (req, res) => {
  const { title, start_time, end_time, location, agenda, minutes, attendee_ids, task_ids } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!start_time) return res.status(400).json({ error: 'Start time is required' });

  try {
    const { rows } = await sql`
      INSERT INTO project_meetings (project_id, title, start_time, end_time, location, agenda, minutes, created_by)
      VALUES (${req.params.id}, ${title.trim()}, ${start_time}, ${end_time || null}, ${location || null}, ${agenda || null}, ${minutes || null}, ${req.user.id})
      RETURNING *
    `.execute(db);
    const meeting = rows[0];

    if (Array.isArray(attendee_ids) && attendee_ids.length > 0) {
      const values = attendee_ids.map((uid, i) => sql`(${meeting.id}, ${uid})`);
      await sql`
        INSERT INTO project_meeting_attendees (meeting_id, user_id) VALUES ${sql.join(values, sql`, `)} ON CONFLICT DO NOTHING
      `.execute(db);
    }

    if (Array.isArray(task_ids) && task_ids.length > 0) {
      const values = task_ids.map((tid, i) => sql`(${meeting.id}, ${tid})`);
      await sql`
        INSERT INTO project_meeting_tasks (meeting_id, task_id) VALUES ${sql.join(values, sql`, `)} ON CONFLICT DO NOTHING
      `.execute(db);
    }

    logAction(req.user.id, req.user.email, 'create', 'project_meeting', meeting.id, meeting.title);
    res.status(201).json(meeting);
  } catch (err) {
    console.error('Error creating meeting:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/meetings/:meetingId', async (req, res) => {
  const { title, start_time, end_time, location, agenda, minutes } = req.body || {};
  try {
    const { rows } = await sql`
      UPDATE project_meetings
      SET title = COALESCE(${title}, title),
          start_time = COALESCE(${start_time}, start_time),
          end_time = COALESCE(${end_time}, end_time),
          location = COALESCE(${location}, location),
          agenda = COALESCE(${agenda}, agenda),
          minutes = COALESCE(${minutes}, minutes)
      WHERE id = ${req.params.meetingId} AND project_id = ${req.params.id}
      RETURNING *
    `.execute(db);
    if (!rows[0]) return res.status(404).json({ error: 'Meeting not found' });
    logAction(req.user.id, req.user.email, 'update', 'project_meeting', rows[0].id, rows[0].title);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating meeting:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/meetings/:meetingId', async (req, res) => {
  try {
    const row = await db.deleteFrom('project_meetings')
      .where('id', '=', req.params.meetingId)
      .where('project_id', '=', req.params.id)
      .returning(['id', 'title'])
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Meeting not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_meeting', row.id, row.title);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting meeting:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Meeting attendees
router.post('/:id/meetings/:meetingId/attendees', async (req, res) => {
  const { user_id, status } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  try {
    const { rows } = await sql`
      INSERT INTO project_meeting_attendees (meeting_id, user_id, status)
      VALUES (${req.params.meetingId}, ${user_id}, COALESCE(${status}, 'pending'))
      ON CONFLICT (meeting_id, user_id) DO UPDATE SET status = COALESCE(${status}, project_meeting_attendees.status)
      RETURNING *
    `.execute(db);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error adding attendee:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/meetings/:meetingId/attendees/:userId', async (req, res) => {
  try {
    await db.deleteFrom('project_meeting_attendees')
      .where('meeting_id', '=', req.params.meetingId)
      .where('user_id', '=', req.params.userId)
      .execute();
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing attendee:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Meeting tasks
router.post('/:id/meetings/:meetingId/tasks', async (req, res) => {
  const { task_id } = req.body || {};
  if (!task_id) return res.status(400).json({ error: 'task_id is required' });
  try {
    const { rows } = await sql`
      INSERT INTO project_meeting_tasks (meeting_id, task_id) VALUES (${req.params.meetingId}, ${task_id})
      ON CONFLICT DO NOTHING RETURNING *
    `.execute(db);
    res.json(rows[0] || { meeting_id: req.params.meetingId, task_id });
  } catch (err) {
    console.error('Error linking task to meeting:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/meetings/:meetingId/tasks/:taskId', async (req, res) => {
  try {
    await db.deleteFrom('project_meeting_tasks')
      .where('meeting_id', '=', req.params.meetingId)
      .where('task_id', '=', req.params.taskId)
      .execute();
    res.json({ success: true });
  } catch (err) {
    console.error('Error unlinking task from meeting:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
