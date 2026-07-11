const jwt = require('jsonwebtoken');
const Client = require('../models/client');
const pool = require('../models/db');

/**
 * Middleware to authenticate client requests
 * Supports both JWT tokens (after login) and magic link tokens
 */
module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];

    // Try JWT first (for logged-in clients)
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (decoded.clientId) {
        // Client authenticating as themselves via their own JWT (no organization_id
        // claim in the token) — not an operator lookup, so bypassing the org-scoped
        // Client.findById is intentional and safe. Mirrors verifyPassword in client.js.
        const result = await pool.query('SELECT * FROM clients WHERE id = $1', [decoded.clientId]);
        const client = result.rows[0] || null;
        if (!client || !client.is_active) {
          return res.status(403).json({ error: 'Client account inactive or not found' });
        }
        req.client = client;
        return next();
      }
    } catch (err) {
      // Not a valid JWT, continue to check magic link token
    }

    // Try magic link token (for passwordless verification)
    const invitation = await Client.verifyInvitationToken(token);
    if (invitation) {
      // Client is verifying their invitation - add to request for route handler
      req.invitationToken = token;
      req.invitationEmail = invitation.email;
      return next();
    }

    return res.status(401).json({ error: 'Invalid token' });
  } catch (err) {
    console.error('Client auth error:', err);
    return res.status(500).json({ error: 'Authentication error' });
  }
};
