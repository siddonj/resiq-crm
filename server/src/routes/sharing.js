const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');

const router = express.Router();

const RESOURCE_TABLES = { contact: 'contacts', deal: 'deals' };
const RESOURCE_NAME_COLS = { contact: 'name', deal: 'title' };

async function verifyOwnership(userId, resourceType, resourceId) {
  const table = RESOURCE_TABLES[resourceType];
  if (!table) return false;
  const result = await pool.query(
    `SELECT id FROM ${table} WHERE id = $1 AND user_id = $2`,
    [resourceId, userId]
  );
  return result.rows.length > 0;
}

/**
 * GET /api/sharing/:resourceType/:resourceId
 * List all shares for a resource — owner only
 */
router.get('/:resourceType/:resourceId', auth, async (req, res) => {
  const { resourceType, resourceId } = req.params;
  if (!RESOURCE_TABLES[resourceType]) return res.status(400).json({ error: 'Invalid resource type' });

  const isOwner = await verifyOwnership(req.user.id, resourceType, resourceId);
  if (!isOwner) return res.status(403).json({ error: 'Not authorized' });

  try {
    const result = await pool.query(
      `SELECT sr.id, sr.permission, sr.created_at,
              u.id AS shared_with_user_id, u.name AS shared_with_user_name, u.email AS shared_with_user_email,
              t.id AS shared_with_team_id, t.name AS shared_with_team_name
       FROM shared_resources sr
       LEFT JOIN users u ON u.id = sr.shared_with_user_id
       LEFT JOIN teams t ON t.id = sr.shared_with_team_id
       WHERE sr.resource_type = $1 AND sr.resource_id = $2
       ORDER BY sr.created_at ASC`,
      [resourceType, resourceId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching shares:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/sharing
 * Share a resource — owner only
 */
router.post('/', auth, async (req, res) => {
  const { resource_type, resource_id, shared_with_user_id, shared_with_team_id, permission = 'view' } = req.body;

  if (!RESOURCE_TABLES[resource_type]) return res.status(400).json({ error: 'Invalid resource type' });
  if (!resource_id) return res.status(400).json({ error: 'resource_id is required' });
  if (!shared_with_user_id && !shared_with_team_id) return res.status(400).json({ error: 'Provide shared_with_user_id or shared_with_team_id' });
  if (!['view', 'edit'].includes(permission)) return res.status(400).json({ error: 'permission must be view or edit' });

  const isOwner = await verifyOwnership(req.user.id, resource_type, resource_id);
  if (!isOwner) return res.status(403).json({ error: 'Not authorized' });

  // Prevent sharing with yourself
  if (shared_with_user_id === req.user.id) return res.status(400).json({ error: 'Cannot share with yourself' });

  try {
    const result = await pool.query(
      `INSERT INTO shared_resources (resource_type, resource_id, shared_by, shared_with_user_id, shared_with_team_id, permission)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [resource_type, resource_id, req.user.id, shared_with_user_id || null, shared_with_team_id || null, permission]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'User or team not found' });
    console.error('Error creating share:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/sharing/:id
 * Remove a share — owner of the resource only
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const share = await pool.query('SELECT * FROM shared_resources WHERE id = $1', [req.params.id]);
    if (!share.rows[0]) return res.status(404).json({ error: 'Share not found' });

    const isOwner = await verifyOwnership(req.user.id, share.rows[0].resource_type, share.rows[0].resource_id);
    if (!isOwner) return res.status(403).json({ error: 'Not authorized' });

    await pool.query('DELETE FROM shared_resources WHERE id = $1', [req.params.id]);
    res.json({ message: 'Share removed' });
  } catch (err) {
    console.error('Error removing share:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
