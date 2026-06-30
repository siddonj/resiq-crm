const express = require('express');
const { db, sql, orgWhere, orgUserWhere } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

const RESOURCE_TABLES = { contact: 'contacts', deal: 'deals' };

async function verifyOwnership(userId, resourceType, resourceId) {
  const table = RESOURCE_TABLES[resourceType];
  if (!table) return false;
  const result = await db.selectFrom(table)
    .select('id')
    .where('id', '=', resourceId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return !!result;
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
    const result = await db.selectFrom('shared_resources as sr')
      .$call(orgWhere(req.orgId))
      .leftJoin('users as u', 'u.id', 'sr.shared_with_user_id')
      .leftJoin('teams as t', 't.id', 'sr.shared_with_team_id')
      .select([
        'sr.id',
        'sr.permission',
        'sr.created_at',
        'u.id as shared_with_user_id',
        'u.name as shared_with_user_name',
        'u.email as shared_with_user_email',
        't.id as shared_with_team_id',
        't.name as shared_with_team_name',
      ])
      .where('sr.resource_type', '=', resourceType)
      .where('sr.resource_id', '=', resourceId)
      .orderBy('sr.created_at', 'asc')
      .execute();
    res.json(result);
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
    const result = await db.insertInto('shared_resources')
      .values({
        organization_id: req.orgId,
        resource_type,
        resource_id,
        shared_by: req.user.id,
        shared_with_user_id: shared_with_user_id || null,
        shared_with_team_id: shared_with_team_id || null,
        permission,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(result);
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
    const share = await db.selectFrom('shared_resources')
      .$call(orgWhere(req.orgId))
      .selectAll()
      .where('id', '=', req.params.id)
      .executeTakeFirst();
    if (!share) return res.status(404).json({ error: 'Share not found' });

    const isOwner = await verifyOwnership(req.user.id, share.resource_type, share.resource_id);
    if (!isOwner) return res.status(403).json({ error: 'Not authorized' });

    await db.deleteFrom('shared_resources')
      .$call(orgWhere(req.orgId))
      .where('id', '=', req.params.id)
      .execute();
    res.json({ message: 'Share removed' });
  } catch (err) {
    console.error('Error removing share:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
