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

async function getTasksInTreeOrder(projectId) {
  const { rows } = await pool.query(
    `SELECT t.*,
            COALESCE(sc.subtask_count, 0) AS subtask_count
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

  const treeTasks = await getTasksInTreeOrder(projectId);

  return {
    project: projectRes.rows[0],
    columns: columnsRes.rows,
    tasks: treeTasks,
    members: membersRes.rows,
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

// POST /api/projects
router.post('/', async (req, res) => {
  const { name, description, team_id } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
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
  const { name, description, values, position, parent_id } = req.body || {};
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
      `INSERT INTO project_tasks (project_id, task_id, name, description, values, position, parent_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.params.id, taskId, name.trim(), description || null, values || {}, taskPosition, parent_id || null, req.user.id]
    );

    logAction(req.user.id, req.user.email, 'create', 'project_task', rows[0].id, rows[0].name);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/tasks/:taskId', async (req, res) => {
  const { name, description, values, position, parent_id } = req.body || {};
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
             updated_at = NOW()
       WHERE id = $6 AND project_id = $7
       RETURNING *`,
      [name, description, values, position, parent_id, req.params.taskId, req.params.id]
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

module.exports = router;
