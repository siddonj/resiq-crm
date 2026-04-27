const jwt = require('jsonwebtoken');
const pool = require('../models/db');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Always hydrate role/email/is_active from DB to avoid stale token-role state.
    const result = await pool.query(
      'SELECT id, name, email, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (user.is_active === false) {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
