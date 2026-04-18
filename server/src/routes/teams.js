const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

/**
 * GET /api/teams
 * List all teams with member count — admin and manager
 */
router.get('/', auth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.name, t.description, t.created_at,
             u.name AS created_by_name,
             COUNT(tm.user_id) AS member_count
      FROM teams t
      LEFT JOIN users u ON u.id = t.created_by
      LEFT JOIN team_members tm ON tm.team_id = t.id
      GROUP BY t.id, u.name
      ORDER BY t.created_at ASC
    `);
    res.json(result.rows);
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
    const result = await pool.query(
      'INSERT INTO teams (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), description || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
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
    const [teamRes, membersRes] = await Promise.all([
      pool.query(
        `SELECT t.*, u.name AS created_by_name
         FROM teams t LEFT JOIN users u ON u.id = t.created_by
         WHERE t.id = $1`,
        [req.params.id]
      ),
      pool.query(
        `SELECT u.id, u.name, u.email, u.role, tm.role AS team_role, tm.joined_at
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = $1
         ORDER BY tm.joined_at ASC`,
        [req.params.id]
      ),
    ]);
    if (!teamRes.rows[0]) return res.status(404).json({ error: 'Team not found' });
    res.json({ ...teamRes.rows[0], members: membersRes.rows });
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
    const result = await pool.query(
      'UPDATE teams SET name = $1, description = $2 WHERE id = $3 RETURNING *',
      [name.trim(), description ?? null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Team not found' });
    res.json(result.rows[0]);
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
    const result = await pool.query('DELETE FROM teams WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Team not found' });
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
    const result = await pool.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [req.params.id, user_id, role]
    );
    res.status(201).json(result.rows[0]);
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
    const result = await pool.query(
      'UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3 RETURNING *',
      [role, req.params.id, req.params.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Member not found in team' });
    res.json(result.rows[0]);
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
    const result = await pool.query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.params.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Member not found in team' });
    res.json({ message: 'Member removed' });
  } catch (err) {
    console.error('Error removing team member:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
