const express = require('express');
const router = express.Router();
const GmailService = require('../services/gmail');
const tokenManager = require('../services/oauth');
const auth = require('../middleware/auth');
const crypto = require('crypto');
const { emailSyncQueue } = require('../workers/emailSyncWorker');

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
    const clientUrl = process.env.API_URL?.replace(':5000', ':5176') || 'http://localhost:5176';
    return res.redirect(`${clientUrl}/settings?error=Gmail%20connection%20failed:%20${error}`);
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
    const clientUrl = process.env.API_URL?.replace(':5000', ':5176') || 'http://localhost:5176';
    res.redirect(`${clientUrl}/settings?success=Gmail%20connected:%20${encodeURIComponent(gmailEmail)}`);
  } catch (err) {
    console.error('Error handling Gmail OAuth callback:', err);
    const clientUrl = process.env.API_URL?.replace(':5000', ':5176') || 'http://localhost:5176';
    res.redirect(`${clientUrl}/settings?error=Failed%20to%20connect%20Gmail`);
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

/**
 * GET /api/integrations/gmail/labels
 * Get list of Gmail labels for the authenticated user (filtered for CRM labels)
 */
router.get('/gmail/labels', auth, async (req, res) => {
  try {
    const GmailService = require('../services/gmail');
    const labels = await GmailService.getLabels(req.user.id);

    // Filter to show ONLY CRM-relevant labels (those starting with "ResiQ-")
    const crmLabels = labels.filter(label =>
      label.type === 'user' && label.name.startsWith('ResiQ-')
    );

    res.json({
      labels: crmLabels.map(label => ({
        id: label.id,
        name: label.name,
      })),
      recommendation: crmLabels.length === 0
        ? 'Create labels starting with "ResiQ-" in Gmail (e.g., ResiQ-Leads, ResiQ-Prospects, ResiQ-Opportunities, ResiQ-Customers) to sync specific emails'
        : null,
    });
  } catch (err) {
    console.error('Error fetching labels:', err);
    res.status(500).json({ error: 'Failed to fetch Gmail labels' });
  }
});

/**
 * POST /api/integrations/gmail/label-preference
 * Set preferred label for email sync
 */
router.post('/gmail/label-preference', auth, async (req, res) => {
  const { labelId } = req.body;

  try {
    const pool = require('../models/db');

    // Store label preference in oauth_tokens table (gmailSyncLabelId column)
    await pool.query(
      `UPDATE oauth_tokens
       SET gmailSyncLabelId = $1
       WHERE user_id = $2 AND provider = 'gmail'`,
      [labelId || null, req.user.id]
    );

    res.json({ success: true, labelId });
  } catch (err) {
    console.error('Error saving label preference:', err);
    res.status(500).json({ error: 'Failed to save label preference' });
  }
});

/**
 * GET /api/integrations/gmail/label-preference
 * Get preferred label for email sync
 */
router.get('/gmail/label-preference', auth, async (req, res) => {
  try {
    const pool = require('../models/db');

    const result = await pool.query(
      `SELECT gmailSyncLabelId FROM oauth_tokens
       WHERE user_id = $1 AND provider = 'gmail'`,
      [req.user.id]
    );

    const labelId = result.rows[0]?.gmailSyncLabelId || null;
    res.json({ labelId });
  } catch (err) {
    console.error('Error fetching label preference:', err);
    res.json({ labelId: null });
  }
});

/**
 * GET /api/integrations/gmail/debug
 * Debug endpoint - see what emails are being fetched
 */
router.get('/gmail/debug', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const GmailService = require('../services/gmail');

    // Fetch raw emails
    const { messages } = await GmailService.fetchEmails(userId, {
      maxResults: 5,
      query: 'in:inbox', // Get ANY emails in inbox
    });

    res.json({
      total: messages.length,
      emails: messages.map((msg) => ({
        id: msg.id,
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        date: msg.date,
      })),
    });
  } catch (err) {
    console.error('Debug error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/integrations/gmail/sync
 * Manually trigger email sync (for testing)
 */
router.post('/gmail/sync', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { labelIds } = req.body; // Optional: filter by specific Gmail labels (array)

    // Queue immediate sync job with label preferences
    const job = await emailSyncQueue.add(
      { userId, labelIds }, // Pass labelIds array to the sync job
      {
        priority: 1, // High priority
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      }
    );

    res.json({
      success: true,
      jobId: job.id,
      message: labelIds && labelIds.length > 0
        ? `Email sync queued for ${labelIds.length} label(s). Check back in a few seconds.`
        : 'Email sync queued. Check back in a few seconds.',
    });
  } catch (err) {
    console.error('Error queuing email sync:', err);
    res.status(500).json({ error: 'Failed to queue email sync' });
  }
});

module.exports = router;
