const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

/**
 * GET /api/audit-logs
 * Paginated, filterable audit log — admin and manager
 * Query params: resource_type, user_id, from, to, page, limit
 */
router.get('/', auth, requireRole('admin', 'manager'), async (req, res) => {
  const { resource_type, user_id, from, to, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

  const conditions = [];
  const params = [];

  if (resource_type) {
    params.push(resource_type);
    conditions.push(`resource_type = $${params.length}`);
  }
  if (user_id) {
    params.push(user_id);
    conditions.push(`user_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`created_at <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(parseInt(limit), offset);
  const dataQuery = `
    SELECT * FROM audit_logs
    ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  const countParams = params.slice(0, params.length - 2);
  const countQuery = `SELECT COUNT(*) FROM audit_logs ${where}`;

  try {
    const [dataRes, countRes] = await Promise.all([
      pool.query(dataQuery, params),
      pool.query(countQuery, countParams),
    ]);
    res.json({
      logs: dataRes.rows,
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
