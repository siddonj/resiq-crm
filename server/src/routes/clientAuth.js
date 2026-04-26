const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Client = require('../models/client');
const auth = require('../middleware/auth');
const clientAuth = require('../middleware/clientAuth');
const { sendClientInvitationEmail } = require('../services/clientNotifications');

const router = express.Router();

/**
 * POST /api/auth/client/invite
 * Employee endpoint to invite a client
 * Requires: email, name, dealId (optional)
 */
router.post('/client/invite', auth, async (req, res) => {
  const { email, name, dealId } = req.body;

  if (!email?.trim() || !name?.trim()) {
    return res.status(400).json({ error: 'email and name are required' });
  }

  try {
    // Check if client already exists
    const existing = await Client.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Client already exists' });
    }

    // Create invitation
    const invitation = await Client.createInvitation(email.toLowerCase(), req.user.id);

    // Send invitation email
    const emailSent = await sendClientInvitationEmail(email, name, invitation.token);

    res.status(201).json({
      success: true,
      message: 'Invitation sent to ' + email,
      invitation: { id: invitation.id, email },
    });
  } catch (err) {
    console.error('Error creating client invitation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/auth/client/verify
 * Step 1: Verify email and request magic link (alternative to email-based flow)
 * Sends magic link to email (already done in /invite endpoint)
 * This endpoint is for clients to request a fresh magic link
 */
router.post('/client/verify', async (req, res) => {
  const { email } = req.body;

  if (!email?.trim()) {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    const existing = await Client.findByEmail(email);
    if (!existing) {
      // For security, don't reveal whether email exists
      return res.status(200).json({ message: 'If email is registered, a verification link has been sent' });
    }

    // Create a temporary verification token (similar to invitation token)
    const token = require('crypto').randomBytes(32).toString('hex');
    // Store this temporarily (could use Redis for short TTL)
    // For now, we'll just return it to the client (they already have the email)

    res.json({
      message: 'Verification email sent',
      requiresPassword: !!existing.password_hash,
    });
  } catch (err) {
    console.error('Error verifying client email:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/auth/client/verify/:token
 * Step 2: Verify magic link token and either create/update client or return JWT
 * Body: { name?, password? } (name required for first signup, password optional)
 */
router.post('/client/verify/:token', clientAuth, async (req, res) => {
  const { token } = req.params;
  const { name, password } = req.body;

  if (!req.invitationToken) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    // If client already exists with password, they can login directly
    const existing = await Client.findByEmail(req.invitationEmail);
    if (existing && existing.password_hash && !password) {
      // They need to provide password
      return res.status(400).json({
        error: 'password required',
        requiresPassword: true,
      });
    }

    let clientId;

    if (password && name) {
      // New signup with password
      const passwordHash = await bcrypt.hash(password, 12);
      clientId = await Client.createOrUpdateFromInvitation(token, name, passwordHash);
    } else if (password && existing) {
      // Existing client updating password
      clientId = existing.id;
      await Client.setPassword(clientId, password);

      // Mark invitation as used
      const invitation = await Client.verifyInvitationToken(token);
      if (invitation) {
        // Update invitation as used
        const pool = require('../models/db');
        await pool.query(
          'UPDATE client_invitations SET used_at = NOW(), used_by = $1 WHERE id = $2',
          [clientId, invitation.id]
        );
      }
    } else if (!password && name) {
      // Passwordless signup - create without password
      const clientResult = await Client.createOrUpdateFromInvitation(token, name, null);
      clientId = clientResult;
    } else {
      return res.status(400).json({ error: 'name and/or password required' });
    }

    // Update last login
    await Client.updateLastLogin(clientId);

    // Log activity
    await Client.logActivity(clientId, 'signed_up', {}, req.ip);

    // Generate JWT token
    const jwtToken = jwt.sign(
      { clientId, email: req.invitationEmail },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token: jwtToken,
      client: {
        id: clientId,
        email: req.invitationEmail,
      },
    });
  } catch (err) {
    console.error('Error verifying client:', err);
    if (err.message.includes('Invalid or expired')) {
      return res.status(401).json({ error: err.message });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/auth/client/login
 * Client password login (if they set a password)
 */
router.post('/client/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'email and password required' });
  }

  try {
    const client = await Client.findByEmail(email);
    if (!client || !client.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!client.password_hash) {
      return res.status(401).json({
        error: 'Account does not have password login enabled',
        message: 'Use the email verification link instead',
      });
    }

    const passwordMatch = await Client.verifyPassword(client.id, password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await Client.updateLastLogin(client.id);

    // Log activity
    await Client.logActivity(client.id, 'logged_in', {}, req.ip);

    // Generate JWT
    const token = jwt.sign(
      { clientId: client.id, email: client.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
      },
    });
  } catch (err) {
    console.error('Error logging in client:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/auth/client/password
 * Client sets or updates password (after first login)
 */
router.post('/client/password', clientAuth, async (req, res) => {
  const { password, currentPassword } = req.body;

  if (!password?.trim()) {
    return res.status(400).json({ error: 'password is required' });
  }

  try {
    if (!req.client) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // If client already has password, verify old password
    if (req.client.password_hash) {
      if (!currentPassword?.trim()) {
        return res.status(400).json({ error: 'currentPassword required to change password' });
      }

      const match = await Client.verifyPassword(req.client.id, currentPassword);
      if (!match) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    await Client.setPassword(req.client.id, password);

    res.json({
      message: 'Password updated successfully',
    });
  } catch (err) {
    console.error('Error setting client password:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
