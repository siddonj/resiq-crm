const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../models/db');
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
  const { rows } = await pool.query('SELECT nextval(\'project_task_seq\') AS seq');
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
    const { rows } = await pool.query(
      'SELECT parent_id FROM project_tasks WHERE id = $1 AND project_id = $2',
      [current, projectId]
    );
    if (!rows[0]) break;
    if (rows[0].parent_id === taskId) return true;
    current = rows[0].parent_id;
  }
  return false;
}

async function getProjectTypes(projectId) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM project_task_types WHERE project_id = $1 ORDER BY position ASC, created_at ASC',
      [projectId]
    );
    return rows;
  } catch (err) {
    console.error('getProjectTypes error (table may not exist):', err.message);
    return [];
  }
}

async function getProjectWorkflows(projectId) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM project_workflows WHERE project_id = $1 ORDER BY created_at ASC',
      [projectId]
    );
    return rows;
  } catch (err) {
    console.error('getProjectWorkflows error (table may not exist):', err.message);
    return [];
  }
}

async function getProjectTaskRelations(projectId) {
  try {
    const { rows } = await pool.query(
      `SELECT ptr.*,
              ft.name AS from_task_name, ft.task_id AS from_task_task_id,
              tt.name AS to_task_name, tt.task_id AS to_task_task_id
       FROM project_task_relations ptr
       JOIN project_tasks ft ON ft.id = ptr.from_task_id
       JOIN project_tasks tt ON tt.id = ptr.to_task_id
       WHERE ptr.project_id = $1
       ORDER BY ptr.created_at ASC`,
      [projectId]
    );
    return rows;
  } catch (err) {
    console.error('getProjectTaskRelations error (table may not exist):', err.message);
    return [];
  }
}

async function getTasksInTreeOrder(projectId) {
  let rows;
  try {
    const res = await pool.query(
      `SELECT t.*,
              COALESCE(sc.subtask_count, 0) AS subtask_count,
              ptt.name AS type_name, ptt.color AS type_color, ptt.icon AS type_icon
       FROM project_tasks t
       LEFT JOIN project_task_types ptt ON ptt.id = t.type_id
       LEFT JOIN (
         SELECT parent_id, COUNT(*) AS subtask_count
         FROM project_tasks
         WHERE project_id = $1 AND parent_id IS NOT NULL
         GROUP BY parent_id
       ) sc ON sc.parent_id = t.id
       WHERE t.project_id = $1
       ORDER BY t.position ASC, t.created_at ASC`,
      [projectId]
    );
    rows = res.rows;
  } catch (err) {
    console.error('getTasksInTreeOrder error (falling back to basic query):', err.message);
    const res = await pool.query(
      `SELECT t.*, COALESCE(sc.subtask_count, 0) AS subtask_count
       FROM project_tasks t
       LEFT JOIN (
         SELECT parent_id, COUNT(*) AS subtask_count
         FROM project_tasks
         WHERE project_id = $1 AND parent_id IS NOT NULL
         GROUP BY parent_id
       ) sc ON sc.parent_id = t.id
       WHERE t.project_id = $1
       ORDER BY t.position ASC, t.created_at ASC`,
      [projectId]
    );
    rows = res.rows;
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
  const [projectRes, columnsRes, membersRes] = await Promise.all([
    pool.query('SELECT * FROM projects WHERE id = $1', [projectId]),
    pool.query(
      `SELECT * FROM project_columns WHERE project_id = $1 ORDER BY position ASC, created_at ASC`,
      [projectId]
    ),
    pool.query(
       `SELECT pm.*, u.email, u.name AS user_name,
               t.name AS team_name
        FROM project_members pm
        LEFT JOIN users u ON u.id = pm.user_id
        LEFT JOIN teams t ON t.id = pm.team_id
        WHERE pm.project_id = $1
        ORDER BY pm.added_at ASC`,
      [projectId]
    ),
  ]);

  if (!projectRes.rows[0]) return null;

  const [treeTasks, types, workflows, relations] = await Promise.all([
    getTasksInTreeOrder(projectId),
    getProjectTypes(projectId),
    getProjectWorkflows(projectId),
    getProjectTaskRelations(projectId),
  ]);

  return {
    project: projectRes.rows[0],
    columns: columnsRes.rows,
    tasks: treeTasks,
    members: membersRes.rows,
    types,
    workflows,
    relations,
  };
}

// Check if user has at least the required role on a project
async function checkProjectAccess(projectId, userId, requiredRoles = ['owner', 'admin', 'member', 'viewer']) {
  try {
    // Owner always has full access
    const { rows: proj } = await pool.query(
      'SELECT owner_id FROM projects WHERE id = $1', [projectId]
    );
    if (!proj[0]) return { allowed: false, reason: 'Project not found' };
    if (proj[0].owner_id === userId) return { allowed: true, role: 'owner' };

    // Check direct member access
    const { rows: members } = await pool.query(
      'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );
    if (members[0] && requiredRoles.includes(members[0].role)) {
      return { allowed: true, role: members[0].role };
    }

    // Check team-based access
    const { rows: teamAccess } = await pool.query(
      `SELECT pm.role
       FROM project_members pm
       JOIN team_members tm ON tm.team_id = pm.team_id
       WHERE pm.project_id = $1 AND tm.user_id = $2
       LIMIT 1`,
      [projectId, userId]
    );
    if (teamAccess[0] && requiredRoles.includes(teamAccess[0].role)) {
      return { allowed: true, role: teamAccess[0].role };
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
    const { rows } = await pool.query(
      `SELECT p.*, COALESCE(pm_count.member_count, 0) AS member_count
       FROM projects p
       LEFT JOIN (
         SELECT project_id, COUNT(*) AS member_count
         FROM project_members
         GROUP BY project_id
       ) pm_count ON pm_count.project_id = p.id
       WHERE p.status != 'deleted'
         AND (
           p.owner_id = $1
           OR EXISTS (
             SELECT 1 FROM project_members pm
             WHERE pm.project_id = p.id AND pm.user_id = $1
           )
           OR EXISTS (
             SELECT 1 FROM project_members pm2
             JOIN team_members tm ON tm.team_id = pm2.team_id
             WHERE pm2.project_id = p.id AND tm.user_id = $1
           )
         )
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listing projects:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper: clone a project from template
async function cloneProjectFromTemplate(templateId, user, { name, description, include_tasks }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: templateRows } = await client.query('SELECT * FROM projects WHERE id = $1', [templateId]);
    if (!templateRows[0]) throw new Error('Template not found');
    const template = templateRows[0];

    const { rows: projRows } = await client.query(
      `INSERT INTO projects (name, description, team_id, owner_id, template_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name.trim() || `${template.name} (Copy)`, description || template.description, template.team_id, user.id, templateId]
    );
    const newProject = projRows[0];

    // Copy columns
    const { rows: columns } = await client.query(
      'SELECT * FROM project_columns WHERE project_id = $1 ORDER BY position ASC',
      [templateId]
    );
    const colIdMap = new Map();
    for (const col of columns) {
      const { rows: colRows } = await client.query(
        `INSERT INTO project_columns (project_id, name, key, type, config, position, is_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [newProject.id, col.name, col.key, col.type, col.config, col.position, col.is_required]
      );
      colIdMap.set(col.id, colRows[0].id);
    }

    // Copy views
    const { rows: views } = await client.query(
      'SELECT * FROM project_views WHERE project_id = $1',
      [templateId]
    );
    for (const view of views) {
      await client.query(
        `INSERT INTO project_views (project_id, name, type, config, created_by, is_default)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newProject.id, view.name, view.type, view.config, user.id, view.is_default]
      );
    }

    // Copy types
    const { rows: types } = await client.query(
      'SELECT * FROM project_task_types WHERE project_id = $1 ORDER BY position ASC',
      [templateId]
    );
    const typeIdMap = new Map();
    for (const t of types) {
      const { rows: typeRows } = await client.query(
        `INSERT INTO project_task_types (project_id, name, color, icon, position)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [newProject.id, t.name, t.color, t.icon, t.position]
      );
      typeIdMap.set(t.id, typeRows[0].id);
    }

    // Copy workflows
    const { rows: workflows } = await client.query(
      'SELECT * FROM project_workflows WHERE project_id = $1',
      [templateId]
    );
    for (const w of workflows) {
      await client.query(
        `INSERT INTO project_workflows (project_id, from_status, to_status, role_required, required_fields)
         VALUES ($1, $2, $3, $4, $5)`,
        [newProject.id, w.from_status, w.to_status, w.role_required, w.required_fields]
      );
    }

    // Optionally copy tasks as skeletons
    if (include_tasks) {
      const { rows: templateTasks } = await client.query(
        'SELECT * FROM project_tasks WHERE project_id = $1 ORDER BY position ASC, created_at ASC',
        [templateId]
      );
      const taskIdMap = new Map();
      for (const t of templateTasks) {
        const taskId = await generateTaskId();
        const { rows: taskRows } = await client.query(
          `INSERT INTO project_tasks (project_id, task_id, name, description, values, position, parent_id, created_by, type_id, estimated_hours)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            newProject.id,
            taskId,
            t.name,
            t.description,
            '{}',
            t.position,
            null,
            user.id,
            t.type_id ? typeIdMap.get(t.type_id) : null,
            t.estimated_hours
          ]
        );
        taskIdMap.set(t.id, taskRows[0].id);
      }
      // Fix parent_id references
      for (const t of templateTasks) {
        if (t.parent_id && taskIdMap.has(t.parent_id)) {
          await client.query(
            'UPDATE project_tasks SET parent_id = $1 WHERE id = $2',
            [taskIdMap.get(t.parent_id), taskIdMap.get(t.id)]
          );
        }
      }
    }

    await client.query('COMMIT');
    logAction(user.id, user.email, 'clone', 'project', newProject.id, newProject.name);
    return newProject;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// POST /api/projects
router.post('/', async (req, res) => {
  const { name, description, team_id, template_id, include_tasks } = req.body || {};
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
    const { rows } = await pool.query(
      `INSERT INTO projects (name, description, team_id, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name.trim(), description || null, team_id || null, req.user.id]
    );
    const project = rows[0];

    // Create default columns
    const defaultColumns = [
      { name: 'Status', key: 'status', type: 'dropdown', config: { options: ['To Do', 'In Progress', 'Done'] }, position: 0 },
      { name: 'Priority', key: 'priority', type: 'dropdown', config: { options: ['Low', 'Medium', 'High'] }, position: 1 },
      { name: 'Due Date', key: 'due_date', type: 'date', config: {}, position: 2 },
      { name: 'Assignee', key: 'assignee', type: 'person', config: {}, position: 3 },
      { name: 'Progress', key: 'progress', type: 'progress', config: { min: 0, max: 100 }, position: 4 },
    ];
    for (const col of defaultColumns) {
      await pool.query(
        `INSERT INTO project_columns (project_id, name, key, type, config, position, is_required)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
        [project.id, col.name, col.key, col.type, JSON.stringify(col.config), col.position]
      );
    }

    // Create default grid view
    await pool.query(
      `INSERT INTO project_views (project_id, name, type, config, created_by, is_default)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [project.id, 'Default Grid', 'grid', '{}', req.user.id]
    );

    logAction(req.user.id, req.user.email, 'create', 'project', project.id, project.name);

    res.status(201).json(project);
  } catch (err) {
    console.error('Error creating project:', err);
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
    const { rows } = await pool.query(
      `UPDATE projects
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             status = COALESCE($3, status),
             updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [name, description, status, req.params.id]
    );
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
    const { rows } = await pool.query(
      `UPDATE projects SET status = 'deleted', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
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
    const { rows } = await pool.query(
      'SELECT * FROM project_columns WHERE project_id = $1 ORDER BY position ASC, created_at ASC',
      [req.params.id]
    );
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
    const { rows } = await pool.query(
      `INSERT INTO project_columns (project_id, name, key, type, config, position, is_required)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), COALESCE($7, FALSE))
       RETURNING *`,
      [req.params.id, name.trim(), key, type, config || {}, position, !!is_required]
    );

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
    const { rows } = await pool.query(
      `UPDATE project_columns
         SET name = COALESCE($1, name),
             config = COALESCE($2, config),
             position = COALESCE($3, position),
             is_required = COALESCE($4, is_required)
       WHERE id = $5 AND project_id = $6
       RETURNING *`,
      [name, config, position, is_required, req.params.colId, req.params.id]
    );
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
    const { rows } = await pool.query(
      'DELETE FROM project_columns WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.colId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Column not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_column', rows[0].id, rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting column:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Tasks
router.get('/:id/tasks', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM project_tasks WHERE project_id = $1 ORDER BY position ASC, created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listing tasks:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/tasks', async (req, res) => {
  const { name, description, values, position, parent_id, type_id, estimated_hours, spent_hours, story_points } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  try {
    let taskPosition = position;
    if (taskPosition === undefined || taskPosition === null) {
      const { rows: posRows } = await pool.query(
        'SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM project_tasks WHERE project_id = $1',
        [req.params.id]
      );
      taskPosition = posRows[0].next_pos;
    }

    const taskId = await generateTaskId();
    const { rows } = await pool.query(
      `INSERT INTO project_tasks (project_id, task_id, name, description, values, position, parent_id, type_id, estimated_hours, spent_hours, story_points, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [req.params.id, taskId, name.trim(), description || null, values || {}, taskPosition, parent_id || null, type_id || null, estimated_hours || null, spent_hours || 0, story_points || null, req.user.id]
    );

    logAction(req.user.id, req.user.email, 'create', 'project_task', rows[0].id, rows[0].name);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/tasks/:taskId', async (req, res) => {
  const { name, description, values, position, parent_id, type_id, estimated_hours, spent_hours, story_points } = req.body || {};
  try {
    if (parent_id !== undefined) {
      const cyclic = await wouldCreateCycle(req.params.id, req.params.taskId, parent_id);
      if (cyclic) return res.status(400).json({ error: 'Cannot set a descendant as parent (cycle detected)' });
    }
    const { rows } = await pool.query(
      `UPDATE project_tasks
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             values = COALESCE($3, values),
             position = COALESCE($4, position),
             parent_id = COALESCE($5, parent_id),
             type_id = COALESCE($6, type_id),
             estimated_hours = COALESCE($7, estimated_hours),
             spent_hours = COALESCE($8, spent_hours),
             story_points = COALESCE($9, story_points),
             updated_at = NOW()
       WHERE id = $10 AND project_id = $11
       RETURNING *`,
       [name, description, values, position, parent_id, type_id, estimated_hours, spent_hours, story_points, req.params.taskId, req.params.id]
    );
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
    const { rows } = await pool.query(
      'DELETE FROM project_tasks WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.taskId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_task', rows[0].id, rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Comments ──────────────────────────────────────────────

router.get('/:id/tasks/:taskId/comments', async (req, res) => {
  try {
    const { rows } = await pool.query(
       `SELECT ptc.*, u.email, u.name AS user_name
        FROM project_task_comments ptc
        JOIN users u ON u.id = ptc.user_id
        WHERE ptc.task_id = $1
        ORDER BY ptc.created_at ASC`,
      [req.params.taskId]
    );
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
    const { rows } = await pool.query(
      `INSERT INTO project_task_comments (task_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.params.taskId, req.user.id, content.trim()]
    );
    // Re-fetch with user info
    const [result] = await pool.query(
       `SELECT ptc.*, u.email, u.name AS user_name
        FROM project_task_comments ptc
        JOIN users u ON u.id = ptc.user_id
        WHERE ptc.id = $1`,
      [rows[0].id]
    );
    logAction(req.user.id, req.user.email, 'create', 'task_comment', rows[0].id, content.slice(0, 80));
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding comment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/comments/:commentId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM project_task_comments WHERE id = $1 AND task_id = $2 RETURNING id',
      [req.params.commentId, req.params.taskId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Comment not found' });
    logAction(req.user.id, req.user.email, 'delete', 'task_comment', rows[0].id, rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting comment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Attachments ───────────────────────────────────────────

router.get('/:id/tasks/:taskId/attachments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pta.*, u.email
       FROM project_task_attachments pta
       JOIN users u ON u.id = pta.uploaded_by
       WHERE pta.task_id = $1
       ORDER BY pta.created_at ASC`,
      [req.params.taskId]
    );
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
    const { rows } = await pool.query(
      `INSERT INTO project_task_attachments (task_id, uploaded_by, file_name, file_url, file_size, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.params.taskId, req.user.id, req.file.originalname, fileUrl, req.file.size, req.file.mimetype || null]
    );
    logAction(req.user.id, req.user.email, 'create', 'task_attachment', rows[0].id, rows[0].file_name);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error uploading attachment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/attachments/:attId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM project_task_attachments WHERE id = $1 AND task_id = $2 RETURNING id, file_url',
      [req.params.attId, req.params.taskId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Attachment not found' });

    // Remove file from disk
    const filePath = path.join(__dirname, '..', '..', rows[0].file_url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    logAction(req.user.id, req.user.email, 'delete', 'task_attachment', rows[0].id, rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting attachment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Assignees ─────────────────────────────────────────────

router.get('/:id/tasks/:taskId/assignees', async (req, res) => {
  try {
    const { rows } = await pool.query(
       `SELECT pta.*, u.email, u.name AS user_name
        FROM project_task_assignees pta
        JOIN users u ON u.id = pta.user_id
        WHERE pta.task_id = $1
        ORDER BY pta.created_at ASC`,
      [req.params.taskId]
    );
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
    const { rows } = await pool.query(
      `INSERT INTO project_task_assignees (task_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (task_id, user_id) DO UPDATE SET role = $3
       RETURNING *`,
      [req.params.taskId, user_id, role || 'responsible']
    );
    logAction(req.user.id, req.user.email, 'assign', 'task_assignee', rows[0].id, `user ${user_id}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error adding assignee:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/assignees/:assigneeId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM project_task_assignees WHERE id = $1 AND task_id = $2 RETURNING id',
      [req.params.assigneeId, req.params.taskId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Assignee not found' });
    logAction(req.user.id, req.user.email, 'remove', 'task_assignee', rows[0].id, rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing assignee:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Task Dependencies ──────────────────────────────────────────

router.get('/:id/tasks/:taskId/dependencies', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ptd.*, t.name AS depends_on_name, t.task_id AS depends_on_task_id
       FROM project_task_dependencies ptd
       JOIN project_tasks t ON t.id = ptd.depends_on_task_id
       WHERE ptd.task_id = $1
       ORDER BY ptd.created_at ASC`,
      [req.params.taskId]
    );
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
    const { rows } = await pool.query(
      `INSERT INTO project_task_dependencies (task_id, depends_on_task_id, type)
       VALUES ($1, $2, $3)
       ON CONFLICT (task_id, depends_on_task_id) DO UPDATE SET type = $3
       RETURNING *`,
      [req.params.taskId, depends_on_task_id, type || 'finish_to_start']
    );
    logAction(req.user.id, req.user.email, 'create', 'task_dependency', rows[0].id, `${req.params.taskId}->${depends_on_task_id}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error adding dependency:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/dependencies/:depId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM project_task_dependencies WHERE id = $1 AND task_id = $2 RETURNING id',
      [req.params.depId, req.params.taskId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Dependency not found' });
    logAction(req.user.id, req.user.email, 'delete', 'task_dependency', rows[0].id, rows[0].id);
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
    const { rows } = await pool.query(
      `SELECT to_task_id FROM project_task_relations
       WHERE project_id = $1 AND from_task_id = $2 AND relation_type IN ('precedes', 'follows')`,
      [projectId, current]
    );
    for (const r of rows) queue.push(r.to_task_id);
  }
  return false;
}

router.get('/:id/tasks/:taskId/relations', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ptr.*,
              ft.name AS from_task_name, ft.task_id AS from_task_task_id,
              tt.name AS to_task_name, tt.task_id AS to_task_task_id
       FROM project_task_relations ptr
       JOIN project_tasks ft ON ft.id = ptr.from_task_id
       JOIN project_tasks tt ON tt.id = ptr.to_task_id
       WHERE ptr.project_id = $1
         AND (ptr.from_task_id = $2 OR ptr.to_task_id = $2)
       ORDER BY ptr.created_at ASC`,
      [req.params.id, req.params.taskId]
    );
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

    const { rows } = await pool.query(
      `INSERT INTO project_task_relations (project_id, from_task_id, to_task_id, relation_type, delay_days)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (from_task_id, to_task_id, relation_type) DO UPDATE SET delay_days = $5
       RETURNING *`,
      [projectId, fromTaskId, to_task_id, relation_type, delay_days || 0]
    );
    logAction(req.user.id, req.user.email, 'create', 'task_relation', rows[0].id, `${relation_type} ${fromTaskId}→${to_task_id}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error adding relation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/relations/:relId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM project_task_relations WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.relId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Relation not found' });
    logAction(req.user.id, req.user.email, 'delete', 'task_relation', rows[0].id, rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing relation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Subtasks ───────────────────────────────────────────────────

router.get('/:id/tasks/:taskId/subtasks', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM project_tasks WHERE parent_id = $1 ORDER BY position ASC, created_at ASC',
      [req.params.taskId]
    );
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
    const { rows: taskRows } = await pool.query(
      'SELECT * FROM project_tasks WHERE id = $1 AND project_id = $2',
      [taskId, projectId]
    );
    if (!taskRows[0]) return res.status(404).json({ error: 'Task not found' });
    const task = taskRows[0];

    if (task.parent_id) return res.status(400).json({ error: 'Task is already a subtask' });

    // Find the task immediately above in tree order
    const treeTasks = await getTasksInTreeOrder(projectId);
    const idx = treeTasks.findIndex((t) => t.id === taskId);
    if (idx <= 0) return res.status(400).json({ error: 'No task above to indent under' });
    const newParentId = treeTasks[idx - 1].id;

    const cyclic = await wouldCreateCycle(projectId, taskId, newParentId);
    if (cyclic) return res.status(400).json({ error: 'Cannot indent under a descendant' });

    const { rows } = await pool.query(
      `UPDATE project_tasks SET parent_id = $1, updated_at = NOW()
       WHERE id = $2 AND project_id = $3 RETURNING *`,
      [newParentId, taskId, projectId]
    );
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

    const { rows: taskRows } = await pool.query(
      'SELECT * FROM project_tasks WHERE id = $1 AND project_id = $2',
      [taskId, projectId]
    );
    if (!taskRows[0]) return res.status(404).json({ error: 'Task not found' });
    const task = taskRows[0];

    if (!task.parent_id) return res.status(400).json({ error: 'Task is not a subtask' });

    // Get the parent's parent (grandparent) to potentially promote to that level, or null
    const { rows: parentRows } = await pool.query(
      'SELECT parent_id FROM project_tasks WHERE id = $1 AND project_id = $2',
      [task.parent_id, projectId]
    );
    const newParentId = parentRows[0]?.parent_id || null;

    const { rows } = await pool.query(
      `UPDATE project_tasks SET parent_id = $1, updated_at = NOW()
       WHERE id = $2 AND project_id = $3 RETURNING *`,
      [newParentId, taskId, projectId]
    );
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
    const { rows } = await pool.query(
      'SELECT * FROM project_views WHERE project_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
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
      await pool.query(
        'UPDATE project_views SET is_default = FALSE WHERE project_id = $1 AND type = $2',
        [req.params.id, type]
      );
    }
    const { rows } = await pool.query(
      `INSERT INTO project_views (project_id, name, type, config, created_by, is_default)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, FALSE))
       RETURNING *`,
      [req.params.id, name.trim(), type, config || {}, req.user.id, is_default]
    );
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
      const view = await pool.query('SELECT type FROM project_views WHERE id = $1', [req.params.viewId]);
      if (view.rows[0]) {
        await pool.query(
          'UPDATE project_views SET is_default = FALSE WHERE project_id = $1 AND type = $2',
          [req.params.id, view.rows[0].type]
        );
      }
    }
    const { rows } = await pool.query(
      `UPDATE project_views
         SET name = COALESCE($1, name),
             config = COALESCE($2, config),
             is_default = COALESCE($3, is_default)
       WHERE id = $4 AND project_id = $5
       RETURNING *`,
      [name, config, is_default, req.params.viewId, req.params.id]
    );
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
    const { rows } = await pool.query(
      'DELETE FROM project_views WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.viewId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'View not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_view', rows[0].id, rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting view:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Project Members ───────────────────────────────────────────

router.get('/:id/members', async (req, res) => {
  try {
    const { rows } = await pool.query(
       `SELECT pm.*, u.email, u.name AS user_name,
               t.name AS team_name
        FROM project_members pm
        LEFT JOIN users u ON u.id = pm.user_id
        LEFT JOIN teams t ON t.id = pm.team_id
        WHERE pm.project_id = $1
        ORDER BY pm.added_at ASC`,
      [req.params.id]
    );
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

    const { rows } = await pool.query(
      `INSERT INTO project_members (project_id, user_id, team_id, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, user_id || null, team_id || null, role || 'member']
    );
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

    const { rows } = await pool.query(
      `UPDATE project_members SET role = $1 WHERE id = $2 AND project_id = $3 RETURNING *`,
      [role, req.params.memberId, req.params.id]
    );
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

    const { rows } = await pool.query(
      'DELETE FROM project_members WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.memberId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Member not found' });
    logAction(req.user.id, req.user.email, 'remove', 'project_member', rows[0].id, rows[0].id);
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
    const { rows } = await pool.query(
      `INSERT INTO project_task_types (project_id, name, color, icon, position)
       VALUES ($1, $2, $3, $4, COALESCE($5, 0))
       RETURNING *`,
      [req.params.id, name.trim(), color || '#3B82F6', icon || 'task', position]
    );
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
    const { rows } = await pool.query(
      `UPDATE project_task_types
         SET name = COALESCE($1, name),
             color = COALESCE($2, color),
             icon = COALESCE($3, icon),
             position = COALESCE($4, position)
       WHERE id = $5 AND project_id = $6
       RETURNING *`,
      [name, color, icon, position, req.params.typeId, req.params.id]
    );
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
    const { rows } = await pool.query(
      'DELETE FROM project_task_types WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.typeId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Type not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_task_type', rows[0].id, rows[0].id);
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
    const { rows } = await pool.query(
      `INSERT INTO project_workflows (project_id, from_status, to_status, role_required, required_fields)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, from_status, to_status, role_required || null, required_fields || null]
    );
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
    const { rows } = await pool.query(
      'DELETE FROM project_workflows WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.workflowId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Workflow not found' });
    logAction(req.user.id, req.user.email, 'delete', 'project_workflow', rows[0].id, rows[0].id);
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
    const { rows } = await pool.query(
      'DELETE FROM project_tasks WHERE id = ANY($1::uuid[]) AND project_id = $2 RETURNING id',
      [task_ids, req.params.id]
    );
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
    const params = [task_ids, req.params.id];
    let idx = 3;

    if (values && typeof values === 'object') {
      setClauses.push(`values = values || $${idx++}::jsonb`);
      params.push(JSON.stringify(values));
    }
    if (name !== undefined) {
      setClauses.push(`name = COALESCE($${idx++}, name)`);
      params.push(name);
    }
    if (description !== undefined) {
      setClauses.push(`description = COALESCE($${idx++}, description)`);
      params.push(description);
    }
    if (position !== undefined) {
      setClauses.push(`position = COALESCE($${idx++}, position)`);
      params.push(position);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { rows } = await pool.query(
      `UPDATE project_tasks SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = ANY($1::uuid[]) AND project_id = $2
       RETURNING *`,
      params
    );
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
    const { rows } = await pool.query(
      `SELECT pte.*, u.name AS user_name, u.email
       FROM project_time_entries pte
       JOIN users u ON u.id = pte.user_id
       WHERE pte.task_id = $1
       ORDER BY pte.logged_at DESC, pte.created_at DESC`,
      [req.params.taskId]
    );
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
    const { rows } = await pool.query(
      `INSERT INTO project_time_entries (task_id, user_id, hours, description, billable, hourly_rate, logged_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE))
       RETURNING *`,
      [req.params.taskId, req.user.id, Number(hours), description || null, billable !== false, hourly_rate || 0, logged_at || null]
    );
    logAction(req.user.id, req.user.email, 'create', 'time_entry', rows[0].id, `${hours}h`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating time entry:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tasks/:taskId/time-entries/:entryId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM project_time_entries WHERE id = $1 AND task_id = $2 RETURNING id',
      [req.params.entryId, req.params.taskId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Time entry not found' });
    logAction(req.user.id, req.user.email, 'delete', 'time_entry', rows[0].id, rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting time entry:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Templates ──────────────────────────────────────────────────

// GET /api/projects/templates
router.get('/templates', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.name AS owner_name
       FROM projects p
       LEFT JOIN users u ON u.id = p.owner_id
       WHERE p.is_template = TRUE
       ORDER BY p.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listing templates:', err);
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
    const { rows } = await pool.query(
      `UPDATE projects SET is_template = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
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
    const { rows } = await pool.query(
      'SELECT * FROM sprints WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
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
    const { rows } = await pool.query(
      `INSERT INTO sprints (project_id, name, goal, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, name.trim(), goal || null, start_date || null, end_date || null]
    );
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
    const { rows } = await pool.query(
      `UPDATE sprints
         SET name = COALESCE($1, name),
             goal = COALESCE($2, goal),
             start_date = COALESCE($3, start_date),
             end_date = COALESCE($4, end_date),
             status = COALESCE($5, status),
             updated_at = NOW()
       WHERE id = $6 AND project_id = $7
       RETURNING *`,
      [name, goal, start_date, end_date, status, req.params.sprintId, req.params.id]
    );
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
    const { rows } = await pool.query(
      'DELETE FROM sprints WHERE id = $1 AND project_id = $2 RETURNING id',
      [req.params.sprintId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Sprint not found' });
    logAction(req.user.id, req.user.email, 'delete', 'sprint', rows[0].id, rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting sprint:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Sprint task management
router.get('/:id/sprints/:sprintId/tasks', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT st.*, t.name AS task_name, t.task_id, t.values, t.status
       FROM sprint_tasks st
       JOIN project_tasks t ON t.id = st.task_id
       WHERE st.sprint_id = $1
       ORDER BY st.position ASC, st.created_at ASC`,
      [req.params.sprintId]
    );
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
    const { rows } = await pool.query(
      `INSERT INTO sprint_tasks (sprint_id, task_id, story_points, position)
       VALUES ($1, $2, $3, COALESCE($4, 0))
       ON CONFLICT (sprint_id, task_id) DO UPDATE SET story_points = $3, position = COALESCE($4, sprint_tasks.position)
       RETURNING *`,
      [req.params.sprintId, task_id, story_points, position]
    );
    logAction(req.user.id, req.user.email, 'add', 'sprint_task', rows[0].id, `task ${task_id} -> sprint ${req.params.sprintId}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error adding sprint task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/sprints/:sprintId/tasks/:taskId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM sprint_tasks WHERE sprint_id = $1 AND task_id = $2 RETURNING id',
      [req.params.sprintId, req.params.taskId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found in sprint' });
    logAction(req.user.id, req.user.email, 'remove', 'sprint_task', rows[0].id, rows[0].id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing sprint task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Backlog: tasks not in any sprint for this project
router.get('/:id/backlog', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*
       FROM project_tasks t
       WHERE t.project_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM sprint_tasks st
           JOIN sprints s ON s.id = st.sprint_id
           WHERE st.task_id = t.id AND s.project_id = $1
         )
       ORDER BY t.position ASC, t.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error loading backlog:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Burndown data for a sprint
router.get('/:id/sprints/:sprintId/burndown', async (req, res) => {
  try {
    const { rows: sprintRows } = await pool.query(
      'SELECT * FROM sprints WHERE id = $1 AND project_id = $2',
      [req.params.sprintId, req.params.id]
    );
    if (!sprintRows[0]) return res.status(404).json({ error: 'Sprint not found' });
    const sprint = sprintRows[0];

    const { rows: totalRows } = await pool.query(
      'SELECT COALESCE(SUM(story_points), 0) AS total FROM sprint_tasks WHERE sprint_id = $1',
      [req.params.sprintId]
    );
    const totalPoints = Number(totalRows[0].total) || 0;

    // Simple linear ideal burndown
    const start = sprint.start_date ? new Date(sprint.start_date) : new Date(sprint.created_at);
    const end = sprint.end_date ? new Date(sprint.end_date) : new Date(start.getTime() + 14 * 86400000);
    const days = Math.max(1, Math.ceil((end - start) / 86400000));

    const ideal = [];
    for (let i = 0; i <= days; i++) {
      ideal.push({ day: i, remaining: Math.round(totalPoints * (1 - i / days)) });
    }

    // Actual: count done tasks per day (simplified — assumes status column exists in values)
    // For now, return placeholder actual data
    const actual = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const { rows: doneRows } = await pool.query(
        `SELECT COALESCE(SUM(st.story_points), 0) AS done
         FROM sprint_tasks st
         JOIN project_tasks t ON t.id = st.task_id
         WHERE st.sprint_id = $1
           AND t.values->>'status' = 'Done'
           AND t.updated_at::date <= $2`,
        [req.params.sprintId, d.toISOString().slice(0, 10)]
      );
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
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.end_date,
              COALESCE(SUM(st.story_points), 0) AS total_points
       FROM sprints s
       LEFT JOIN sprint_tasks st ON st.sprint_id = s.id
       WHERE s.project_id = $1 AND s.status = 'closed'
       GROUP BY s.id, s.name, s.end_date
       ORDER BY s.end_date DESC
       LIMIT 10`,
      [req.params.id]
    );
    const velocities = rows.map((r) => ({ ...r, total_points: Number(r.total_points) }));
    const avg = velocities.length ? Math.round(velocities.reduce((sum, v) => sum + v.total_points, 0) / velocities.length) : 0;
    res.json({ sprints: velocities, average: avg });
  } catch (err) {
    console.error('Error calculating velocity:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
