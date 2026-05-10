const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

// ── Portfolio CRUD ───────────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.name AS owner_name,
              COUNT(DISTINCT pp.project_id) AS project_count
       FROM portfolios p
       LEFT JOIN users u ON u.id = p.owner_id
       LEFT JOIN portfolio_projects pp ON pp.portfolio_id = p.id
       WHERE p.owner_id = $1
       GROUP BY p.id, u.name
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listing portfolios:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  const { name, description, project_ids } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO portfolios (name, description, owner_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [name.trim(), description || null, req.user.id]
    );
    const portfolio = rows[0];

    if (Array.isArray(project_ids) && project_ids.length > 0) {
      const values = project_ids.map((pid, i) => `($1, $${i + 2}, ${i})`).join(', ');
      await client.query(
        `INSERT INTO portfolio_projects (portfolio_id, project_id, position) VALUES ${values}`,
        [portfolio.id, ...project_ids]
      );
    }

    await client.query('COMMIT');
    logAction(req.user.id, req.user.email, 'create', 'portfolio', portfolio.id, portfolio.name);
    res.status(201).json(portfolio);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating portfolio:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const { rows: portfolioRows } = await pool.query(
      `SELECT p.*, u.name AS owner_name
       FROM portfolios p
       LEFT JOIN users u ON u.id = p.owner_id
       WHERE p.id = $1 AND p.owner_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!portfolioRows[0]) return res.status(404).json({ error: 'Portfolio not found' });

    const { rows: projects } = await pool.query(
      `SELECT pr.*, pp.position
       FROM projects pr
       JOIN portfolio_projects pp ON pp.project_id = pr.id
       WHERE pp.portfolio_id = $1
       ORDER BY pp.position ASC, pr.created_at DESC`,
      [req.params.id]
    );

    res.json({ ...portfolioRows[0], projects });
  } catch (err) {
    console.error('Error fetching portfolio:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', auth, async (req, res) => {
  const { name, description } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE portfolios
         SET name = COALESCE($1, name),
             description = COALESCE($2, description)
       WHERE id = $3 AND owner_id = $4
       RETURNING *`,
      [name, description, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Portfolio not found' });
    logAction(req.user.id, req.user.email, 'update', 'portfolio', rows[0].id, rows[0].name);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating portfolio:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM portfolios WHERE id = $1 AND owner_id = $2 RETURNING id, name',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Portfolio not found' });
    logAction(req.user.id, req.user.email, 'delete', 'portfolio', rows[0].id, rows[0].name);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting portfolio:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Portfolio Project Management ─────────────────────────────────

router.post('/:id/projects', auth, async (req, res) => {
  const { project_id } = req.body || {};
  if (!project_id) return res.status(400).json({ error: 'project_id is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO portfolio_projects (portfolio_id, project_id, position)
       VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1 FROM portfolio_projects WHERE portfolio_id = $1))
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [req.params.id, project_id]
    );
    res.json(rows[0] || { portfolio_id: req.params.id, project_id });
  } catch (err) {
    console.error('Error adding project to portfolio:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/projects/:projectId', auth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM portfolio_projects WHERE portfolio_id = $1 AND project_id = $2',
      [req.params.id, req.params.projectId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing project from portfolio:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Portfolio Dashboard / Aggregate APIs ─────────────────────────

router.get('/:id/dashboard', auth, async (req, res) => {
  try {
    // Verify access
    const { rows: portRows } = await pool.query(
      'SELECT * FROM portfolios WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.user.id]
    );
    if (!portRows[0]) return res.status(404).json({ error: 'Portfolio not found' });

    // Get projects in portfolio
    const { rows: projects } = await pool.query(
      `SELECT pr.id, pr.name, pr.status, pr.created_at, pr.owner_id,
              u.name AS owner_name
       FROM projects pr
       JOIN portfolio_projects pp ON pp.project_id = pr.id
       LEFT JOIN users u ON u.id = pr.owner_id
       WHERE pp.portfolio_id = $1`,
      [req.params.id]
    );

    const projectIds = projects.map((p) => p.id);
    if (projectIds.length === 0) {
      return res.json({
        portfolio: portRows[0],
        projects: [],
        kpi: { total_tasks: 0, completed_tasks: 0, completion_pct: 0, total_estimated_hours: 0, total_spent_hours: 0 },
        health: [],
        milestones: [],
      });
    }

    // KPIs
    const { rows: kpiRows } = await pool.query(
      `SELECT
         COUNT(*) AS total_tasks,
         COUNT(*) FILTER (WHERE status = 'Done') AS completed_tasks,
         COALESCE(SUM(estimated_hours), 0) AS total_estimated_hours,
         COALESCE(SUM(spent_hours), 0) AS total_spent_hours
       FROM project_tasks
       WHERE project_id = ANY($1)`,
      [projectIds]
    );
    const kpi = kpiRows[0];
    kpi.completion_pct = kpi.total_tasks > 0 ? Math.round((kpi.completed_tasks / kpi.total_tasks) * 100) : 0;

    // Per-project task counts
    const { rows: taskCounts } = await pool.query(
      `SELECT project_id,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'Done') AS completed
       FROM project_tasks
       WHERE project_id = ANY($1)
       GROUP BY project_id`,
      [projectIds]
    );

    // Health per project
    const health = projects.map((p) => {
      const tc = taskCounts.find((t) => t.project_id === p.id);
      const total = parseInt(tc?.total || 0);
      const completed = parseInt(tc?.completed || 0);
      const pct = total > 0 ? (completed / total) * 100 : 0;
      let status = 'green';
      if (pct < 30) status = 'red';
      else if (pct < 70) status = 'amber';
      return { ...p, total_tasks: total, completed_tasks: completed, completion_pct: Math.round(pct), health_status: status };
    });

    // Milestones across projects (tasks with type = milestone or name containing milestone)
    let milestones = [];
    try {
      const { rows: ms } = await pool.query(
        `SELECT pt.id, pt.project_id, pt.name, pt.status, pt.due_date, pt.progress, pr.name AS project_name
         FROM project_tasks pt
         JOIN projects pr ON pr.id = pt.project_id
         WHERE pt.project_id = ANY($1)
           AND (pt.type_id IN (SELECT id FROM project_task_types WHERE name ILIKE '%milestone%')
                OR pt.name ILIKE '%milestone%')
         ORDER BY pt.due_date ASC NULLS LAST`,
        [projectIds]
      );
      milestones = ms;
    } catch (e) {
      // table may not exist, ignore
    }

    res.json({ portfolio: portRows[0], projects, kpi, health, milestones });
  } catch (err) {
    console.error('Error fetching portfolio dashboard:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Cross-project workload
router.get('/:id/workload', auth, async (req, res) => {
  try {
    const { rows: projects } = await pool.query(
      `SELECT pr.id FROM projects pr
       JOIN portfolio_projects pp ON pp.project_id = pr.id
       WHERE pp.portfolio_id = $1`,
      [req.params.id]
    );
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length === 0) return res.json([]);

    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.name AS user_name, u.email,
              pt.project_id, pr.name AS project_name,
              COALESCE(SUM(pt.estimated_hours), 0) AS estimated_hours,
              COALESCE(SUM(pt.spent_hours), 0) AS spent_hours,
              COUNT(pt.id) AS task_count
       FROM users u
       JOIN project_tasks pt ON pt.assignee_id = u.id
       JOIN projects pr ON pr.id = pt.project_id
       WHERE pt.project_id = ANY($1)
       GROUP BY u.id, u.name, u.email, pt.project_id, pr.name
       ORDER BY u.name, pr.name`,
      [projectIds]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching portfolio workload:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
