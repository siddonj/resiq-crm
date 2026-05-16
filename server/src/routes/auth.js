const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, sql } = require('../db');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const user = await db.transaction().execute(async (trx) => {
      // Check if email already exists
      const existing = await trx
        .selectFrom('users')
        .where('email', '=', normalizedEmail)
        .select('id')
        .executeTakeFirst();

      if (existing) {
        throw Object.assign(new Error('Email already registered'), { statusCode: 409 });
      }

      // Bootstrap rule: first self-registered user becomes admin
      const countResult = await sql`SELECT COUNT(*)::int AS total FROM users`.execute(trx);
      const isFirstUser = (countResult.rows[0]?.total || 0) === 0;
      const role = isFirstUser ? 'admin' : 'user';

      const password_hash = await bcrypt.hash(password, 12);

      const newUser = await trx
        .insertInto('users')
        .values({
          name: name.trim(),
          email: normalizedEmail,
          password_hash,
          role,
        })
        .returning(['id', 'name', 'email', 'role'])
        .executeTakeFirstOrThrow();

      return newUser;
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = await db
      .selectFrom('users')
      .where('email', '=', email)
      .selectAll()
      .executeTakeFirst();

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    logAction(user.id, user.email, 'user_login', 'user', user.id, user.name, {
      ip: req.ip,
      user_agent: req.headers['user-agent'] || null,
    });

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
