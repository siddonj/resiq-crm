const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, sql, ownershipWhere } = require('../db');
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
    const user = await db.selectFrom('users')
      .select(['id', 'name', 'email', 'role', 'is_active', 'created_at'])
      .where('id', '=', req.user.id)
      .executeTakeFirst();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Error fetching own profile:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/users/me
 * Update own profile name/email
 */
router.put('/me', auth, async (req, res) => {
  const { name, email } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!email?.trim()) return res.status(400).json({ error: 'email is required' });
  try {
    const user = await db.updateTable('users')
      .set({ name: name.trim(), email: email.trim().toLowerCase() })
      .where('id', '=', req.user.id)
      .returning(['id', 'name', 'email', 'role', 'is_active'])
      .executeTakeFirstOrThrow();
    res.json(user);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/users/me/password
 * Change own password
 */
router.put('/me/password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password are required' });
  if (new_password.length < 8) return res.status(400).json({ error: 'new_password must be at least 8 characters' });
  try {
    const user = await db.selectFrom('users')
      .select('password_hash')
      .where('id', '=', req.user.id)
      .executeTakeFirstOrThrow();
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(new_password, 12);
    await db.updateTable('users')
      .set({ password_hash: hash })
      .where('id', '=', req.user.id)
      .execute();
    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/users
 * List users — admin sees all, manager sees their team members
 */
router.get('/', auth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      rows = await db.selectFrom('users')
        .select(['id', 'name', 'email', 'role', 'is_active', 'created_at'])
        .orderBy('created_at', 'asc')
        .execute();
    } else {
      // Managers only see users who share at least one team with them
      rows = await db.selectFrom('users')
        .select(['id', 'name', 'email', 'role', 'is_active', 'created_at'])
        .innerJoin('team_members as tm', 'tm.user_id', 'users.id')
        .where('tm.team_id', 'in', 
          db.selectFrom('team_members').select('team_id').where('user_id', '=', req.user.id)
        )
        .orderBy('users.created_at', 'asc')
        .execute();
    }
    res.json(rows);
  } catch (err) {
    console.error('Error listing users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/users/invite
 * Create a new employee account with a temp password — admin only
 */
router.post('/invite', auth, requireRole('admin'), async (req, res) => {
  const { name, email, role } = req.body;
  const validRoles = ['admin', 'manager', 'rep', 'user', 'viewer'];
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!email?.trim()) return res.status(400).json({ error: 'email is required' });
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
  }
  const tempPassword = crypto.randomBytes(8).toString('hex');
  try {
    const hash = await bcrypt.hash(tempPassword, 12);
    const user = await db.insertInto('users')
      .values({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password_hash: hash,
        role,
      })
      .returning(['id', 'name', 'email', 'role', 'is_active', 'created_at'])
      .executeTakeFirstOrThrow();
    logAction(req.user.id, req.user.email, 'invite', 'user', user.id, user.email, { role });
    res.status(201).json({ user, tempPassword });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error('Error inviting user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/users/clients
 * List all client portal accounts — admin only
 */
router.get('/clients', auth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.selectFrom('clients')
      .select(['id', 'name', 'email', 'slug', 'is_active', 'first_login_at', 'last_login_at', 'created_at'])
      .orderBy('created_at', 'asc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error listing clients:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/users/:id
 * Get a user by ID — admin only
 */
router.get('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const user = await db.selectFrom('users')
      .select(['id', 'name', 'email', 'role', 'is_active', 'created_at'])
      .where('id', '=', req.params.id)
      .executeTakeFirst();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
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
  const validRoles = ['admin', 'manager', 'rep', 'user', 'viewer'];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
  }
  // Prevent admin from demoting themselves
  if (req.params.id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot change your own admin role' });
  }
  try {
    const user = await db.updateTable('users')
      .set({ role })
      .where('id', '=', req.params.id)
      .returning(['id', 'name', 'email', 'role', 'is_active'])
      .executeTakeFirst();
    if (!user) return res.status(404).json({ error: 'User not found' });
    logAction(req.user.id, req.user.email, 'role_change', 'user', req.params.id, user.email, { new_role: role });
    res.json(user);
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
    const user = await db.updateTable('users')
      .set({ is_active: false })
      .where('id', '=', req.params.id)
      .returning(['id', 'name', 'email', 'role', 'is_active'])
      .executeTakeFirst();
    if (!user) return res.status(404).json({ error: 'User not found' });
    logAction(req.user.id, req.user.email, 'deactivate', 'user', req.params.id, user.email);
    res.json(user);
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
    const user = await db.updateTable('users')
      .set({ is_active: true })
      .where('id', '=', req.params.id)
      .returning(['id', 'name', 'email', 'role', 'is_active'])
      .executeTakeFirst();
    if (!user) return res.status(404).json({ error: 'User not found' });
    logAction(req.user.id, req.user.email, 'activate', 'user', req.params.id, user.email);
    res.json(user);
  } catch (err) {
    console.error('Error activating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
