const express = require('express');
const router = express.Router();
const GmailService = require('../services/gmail');
const tokenManager = require('../services/oauth');
const auth = require('../middleware/auth');
const crypto = require('crypto');

// Store state temporarily to prevent CSRF
const csrfStates = new Map();

/**
 * POST /api/integrations/gmail/connect
 * Start OAuth flow - redirects user to Google consent screen
 */
router.post('/gmail/connect', auth, (req, res) => {
  try {
    // Generate CSRF state token
    const state = crypto.randomBytes(32).toString('hex');
    csrfStates.set(state, req.user.id);

    // Auto-clean expired states after 10 minutes
    setTimeout(() => csrfStates.delete(state), 10 * 60 * 1000);

    const authUrl = GmailService.getAuthUrl(state);
    res.json({ authUrl });
  } catch (err) {
    console.error('Error starting Gmail OAuth:', err);
    res.status(500).json({ error: 'Failed to start Gmail connection' });
  }
});

/**
 * GET /api/integrations/gmail/callback
 * OAuth callback from Google - exchange code for tokens
 */
router.get('/gmail/callback', async (req, res) => {
  const { code, state } = req.query;
  const error = req.query.error;

  if (error) {
    return res.redirect(`/settings?error=Gmail%20connection%20failed:%20${error}`);
  }

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  try {
    // Validate CSRF state
    const userId = csrfStates.get(state);
    if (!userId) {
      return res.status(400).json({ error: 'Invalid or expired state token' });
    }
    csrfStates.delete(state);

    // Exchange code for tokens
    const { accessToken, refreshToken, expiresAt } = await GmailService.exchangeCodeForTokens(code);

    // Save encrypted tokens to database
    await tokenManager.saveTokens(userId, 'gmail', accessToken, refreshToken, expiresAt);

    // Get user's Gmail email for verification
    const gmailEmail = await GmailService.getUserEmail(userId);

    // Redirect to settings page with success message
    res.redirect(`/settings?success=Gmail%20connected:%20${encodeURIComponent(gmailEmail)}`);
  } catch (err) {
    console.error('Error handling Gmail OAuth callback:', err);
    res.redirect(`/settings?error=Failed%20to%20connect%20Gmail`);
  }
});

/**
 * POST /api/integrations/gmail/disconnect
 * Revoke Gmail access and clear tokens
 */
router.post('/gmail/disconnect', auth, async (req, res) => {
  try {
    const user_id = req.user.id;

    // Clear tokens from database
    await tokenManager.clearTokens(user_id);

    // Optionally revoke access at Google (best effort)
    GmailService.revokeAccess().catch((err) => {
      console.log('Note: Could not revoke access at Google (may be already revoked):', err.message);
    });

    res.json({ success: true, message: 'Gmail disconnected' });
  } catch (err) {
    console.error('Error disconnecting Gmail:', err);
    res.status(500).json({ error: 'Failed to disconnect Gmail' });
  }
});

/**
 * GET /api/integrations/gmail/status
 * Check if user has Gmail connected
 */
router.get('/gmail/status', auth, async (req, res) => {
  try {
    const tokens = await tokenManager.getTokens(req.user.id);
    const isConnected = !!tokens?.accessToken && tokens.provider === 'gmail';

    res.json({
      connected: isConnected,
      provider: tokens?.provider || null,
      expiresAt: tokens?.expiresAt || null,
    });
  } catch (err) {
    console.error('Error checking Gmail status:', err);
    res.json({ connected: false });
  }
});

module.exports = router;
