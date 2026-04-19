const jwt = require('jsonwebtoken');
const Client = require('../models/client');

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
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.clientId) {
        const client = await Client.findById(decoded.clientId);
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
