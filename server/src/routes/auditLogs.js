const express = require('express');
const { db, sql } = require('../db');
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
  const pg = Math.max(1, parseInt(page));
  const lim = parseInt(limit);

  const conditions = [];
  if (resource_type) conditions.push(sql`resource_type = ${resource_type}`);
  if (user_id) conditions.push(sql`user_id = ${user_id}`);
  if (from) conditions.push(sql`created_at >= ${from}`);
  if (to) conditions.push(sql`created_at <= ${to}`);

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, ' AND ')}`
    : sql``;

  try {
    const [rows, countResult] = await Promise.all([
      sql`
        SELECT * FROM audit_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${lim} OFFSET ${(pg - 1) * lim}
      `.execute(db),
      sql`SELECT COUNT(*) AS count FROM audit_logs ${whereClause}`.execute(db),
    ]);

    res.json({
      logs: rows.rows,
      total: parseInt(countResult.rows[0].count),
      page: pg,
      limit: lim,
    });
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
