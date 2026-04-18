const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

/**
 * GET /api/users/me
 * Get own profile
 */
router.get('/me', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, is_active, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching own profile:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/users
 * List all users — admin and manager only
 */
router.get('/', auth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY created_at ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/users/:id
 * Get a user by ID — admin only
 */
router.get('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, is_active, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/users/:id/role
 * Assign a role to a user — admin only
 */
router.put('/:id/role', auth, requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  const validRoles = ['admin', 'manager', 'user', 'viewer'];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
  }
  // Prevent admin from demoting themselves
  if (req.params.id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot change your own admin role' });
  }
  try {
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role, is_active',
      [role, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    logAction(req.user.id, req.user.email, 'role_change', 'user', req.params.id, result.rows[0].email, { new_role: role });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating role:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/users/:id/deactivate
 * Deactivate a user — admin only
 */
router.put('/:id/deactivate', auth, requireRole('admin'), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }
  try {
    const result = await pool.query(
      'UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING id, name, email, role, is_active',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    logAction(req.user.id, req.user.email, 'deactivate', 'user', req.params.id, result.rows[0].email);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error deactivating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/users/:id/activate
 * Reactivate a user — admin only
 */
router.put('/:id/activate', auth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE users SET is_active = TRUE WHERE id = $1 RETURNING id, name, email, role, is_active',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    logAction(req.user.id, req.user.email, 'activate', 'user', req.params.id, result.rows[0].email);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error activating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
