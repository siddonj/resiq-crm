const express = require('express');
const router = express.Router();
const GmailService = require('../services/gmail');
const GoogleCalendarService = require('../services/googleCalendar');
const tokenManager = require('../services/oauth');
const auth = require('../middleware/auth');
const { resolveOrg } = require('../middleware/resolveOrg');
const crypto = require('crypto');
const { db, sql, pool } = require('../db');
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
    console.log('[Gmail OAuth] authUrl:', authUrl);
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
    await tokenManager.clearTokens(user_id, 'gmail');

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
    const tokens = await tokenManager.getTokens(req.user.id, 'gmail');
    const isConnected = !!tokens?.accessToken;

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
    res.json({ labelId: null });
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

// ── Google Calendar OAuth ────────────────────────────────────────────────────
router.post('/gcal/connect', auth, (req, res) => {
  try {
    const state = crypto.randomBytes(32).toString('hex');
    csrfStates.set(state, req.user.id);
    setTimeout(() => csrfStates.delete(state), 10 * 60 * 1000);
    const authUrl = GoogleCalendarService.getAuthUrl(state);
    res.json({ authUrl });
  } catch (err) {
    console.error('Error starting Google Calendar OAuth:', err);
    res.status(500).json({ error: 'Failed to start Google Calendar connection' });
  }
});

router.get('/gcal/callback', async (req, res) => {
  const { code, state } = req.query;
  const clientUrl = process.env.API_URL?.replace(':5000', ':5173') || 'http://localhost:5173';
  if (req.query.error) return res.redirect(`${clientUrl}/settings?error=Google+Calendar+connection+failed`);
  if (!code || !state) return res.status(400).json({ error: 'Missing code or state' });

  try {
    const userId = csrfStates.get(state);
    if (!userId) return res.status(400).json({ error: 'Invalid or expired state' });
    csrfStates.delete(state);

    const { accessToken, refreshToken, expiresAt } = await GoogleCalendarService.exchangeCodeForTokens(code);
    await tokenManager.saveTokens(userId, 'gcal', accessToken, refreshToken, expiresAt);
    res.redirect(`${clientUrl}/settings?success=Google+Calendar+connected`);
  } catch (err) {
    console.error('Error handling Google Calendar callback:', err);
    const clientUrl = process.env.API_URL?.replace(':5000', ':5173') || 'http://localhost:5173';
    res.redirect(`${clientUrl}/settings?error=Failed+to+connect+Google+Calendar`);
  }
});

router.post('/gcal/disconnect', auth, async (req, res) => {
  try {
    await tokenManager.clearTokens(req.user.id, 'gcal');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/gcal/status', auth, async (req, res) => {
  try {
    const tokens = await tokenManager.getTokens(req.user.id, 'gcal');
    res.json({ connected: !!tokens });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Sync Google Calendar events into calendar_events table
// resolveOrg is required here (not at mount level — see index.js comment on the
// /api/integrations mount) because this is the only route in this file that writes
// to an ORG_TABLES table (calendar_events, organization_id NOT NULL since migration 062).
// On the /api/org/:orgSlug mount, requireOrg has already set req.orgId; resolveOrg
// no-ops in that case (it defers to req.params.orgSlug).
router.post('/gcal/sync', auth, resolveOrg, async (req, res) => {
  try {
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days
    const items = await GoogleCalendarService.listEvents(req.user.id, now.toISOString(), end.toISOString());
    console.log(`[GCal sync] fetched ${items.length} events for user ${req.user.id}`);
    if (items.length > 0) console.log('[GCal sync] first event:', JSON.stringify(items[0].start));

    let synced = 0;
    for (const item of items) {
      const startAt = item.start?.dateTime || (item.start?.date ? item.start.date + 'T00:00:00Z' : null);
      const endAt = item.end?.dateTime || (item.end?.date ? item.end.date + 'T00:00:00Z' : null) || startAt;
      if (!startAt) continue;
      try {
        await db.insertInto('calendar_events')
          .values({
            user_id: req.user.id,
            organization_id: req.orgId,
            title: item.summary || '(no title)',
            description: item.description || null,
            start_at: startAt,
            end_at: endAt,
            google_event_id: item.id,
            source: 'google',
          })
          // organization_id is never reassigned on conflict (see
          // docs/superpowers/plans/org-inventory.md convention).
          .onConflict(c => c
            .constraint('uq_calendar_events_google_event_id')
            .doUpdateSet({
              title: item.summary || '(no title)',
              description: item.description || null,
              start_at: startAt,
              end_at: endAt,
            })
          )
          .execute();
        synced++;
      } catch (insertErr) {
        console.error('[GCal sync] insert error:', insertErr.message, item.id);
      }
    }
    res.json({ synced });
  } catch (err) {
    if (err.message === 'Google Calendar not connected') return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

module.exports = router;
