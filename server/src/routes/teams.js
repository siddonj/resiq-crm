const express = require('express');
const { db, sql, orgWhere, orgUserWhere } = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

/**
 * GET /api/teams
 * List all teams with member count — admin and manager
 */
router.get('/', auth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT t.id, t.name, t.description, t.created_at,
             u.name AS created_by_name,
             COUNT(tm.user_id) AS member_count
      FROM teams t
      LEFT JOIN users u ON u.id = t.created_by
      LEFT JOIN team_members tm ON tm.team_id = t.id
      GROUP BY t.id, u.name
      ORDER BY t.created_at ASC
    `.execute(db);
    res.json(rows);
  } catch (err) {
    console.error('Error listing teams:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/teams
 * Create a team — admin only
 */
router.post('/', auth, requireRole('admin'), async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const team = await db.insertInto('teams')
      .values({ organization_id: req.orgId, name: name.trim(), description: description || null, created_by: req.user.id })
      .returningAll()
      .executeTakeFirstOrThrow();
    logAction(req.user.id, req.user.email, 'create', 'team', team.id, team.name);
    res.status(201).json(team);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A team with that name already exists' });
    console.error('Error creating team:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/teams/:id
 * Get team details with members — admin and manager
 */
router.get('/:id', auth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const [teamRow, members] = await Promise.all([
      sql`
        SELECT t.*, u.name AS created_by_name
        FROM teams t LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = ${req.params.id}
      `.execute(db).then(r => r.rows[0]),
      db.selectFrom('team_members')
        .$call(orgWhere(req.orgId))
        .innerJoin('users', 'users.id', 'team_members.user_id')
        .where('team_members.team_id', '=', req.params.id)
        .select([
          'users.id',
          'users.name',
          'users.email',
          'users.role',
          'team_members.role as team_role',
          'team_members.joined_at',
        ])
        .orderBy('team_members.joined_at', 'asc')
        .execute(),
    ]);
    if (!teamRow) return res.status(404).json({ error: 'Team not found' });
    res.json({ ...teamRow, members });
  } catch (err) {
    console.error('Error fetching team:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/teams/:id
 * Update team name/description — admin only
 */
router.put('/:id', auth, requireRole('admin'), async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const team = await db.updateTable('teams')
      .$call(orgWhere(req.orgId))
      .set({ name: name.trim(), description: description ?? null })
      .where('id', '=', req.params.id)
      .returningAll()
      .executeTakeFirst();
    if (!team) return res.status(404).json({ error: 'Team not found' });
    logAction(req.user.id, req.user.email, 'update', 'team', team.id, team.name);
    res.json(team);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A team with that name already exists' });
    console.error('Error updating team:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/teams/:id
 * Delete a team — admin only
 */
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const deleted = await db.deleteFrom('teams')
      .$call(orgWhere(req.orgId))
      .where('id', '=', req.params.id)
      .returning(['id', 'name'])
      .executeTakeFirst();
    if (!deleted) return res.status(404).json({ error: 'Team not found' });
    logAction(req.user.id, req.user.email, 'delete', 'team', deleted.id, deleted.name);
    res.json({ message: 'Team deleted' });
  } catch (err) {
    console.error('Error deleting team:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/teams/:id/members
 * Add a user to a team — admin only
 */
router.post('/:id/members', auth, requireRole('admin'), async (req, res) => {
  const { user_id, role = 'member' } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  if (!['lead', 'member'].includes(role)) return res.status(400).json({ error: 'role must be lead or member' });
  try {
    const { rows } = await sql`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES (${req.params.id}, ${user_id}, ${role})
      ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
      RETURNING *
    `.execute(db);
    logAction(req.user.id, req.user.email, 'add_member', 'team', req.params.id, null, { user_id, role });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Team or user not found' });
    console.error('Error adding team member:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/teams/:id/members/:userId/role
 * Update a member's team role — admin only
 */
router.put('/:id/members/:userId/role', auth, requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  if (!['lead', 'member'].includes(role)) return res.status(400).json({ error: 'role must be lead or member' });
  try {
    const member = await db.updateTable('team_members')
      .set({ role })
      .where('team_id', '=', req.params.id)
      .where('user_id', '=', req.params.userId)
      .returningAll()
      .executeTakeFirst();
    if (!member) return res.status(404).json({ error: 'Member not found in team' });
    res.json(member);
  } catch (err) {
    console.error('Error updating member role:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/teams/:id/members/:userId
 * Remove a user from a team — admin only
 */
router.delete('/:id/members/:userId', auth, requireRole('admin'), async (req, res) => {
  try {
    const member = await db.deleteFrom('team_members')
      .where('team_id', '=', req.params.id)
      .where('user_id', '=', req.params.userId)
      .returningAll()
      .executeTakeFirst();
    if (!member) return res.status(404).json({ error: 'Member not found in team' });
    logAction(req.user.id, req.user.email, 'remove_member', 'team', req.params.id, null, { user_id: req.params.userId });
    res.json({ message: 'Member removed' });
  } catch (err) {
    console.error('Error removing team member:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
