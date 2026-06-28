const express = require('express');
const auth = require('../middleware/auth');
const deliverability = require('../services/outbound/deliverabilityService');

const router = express.Router();
router.use(auth);

const VALID_PROVIDERS = ['gmail', 'smtp', 'sendgrid', 'postmark', 'ses', 'resend', 'other'];
const VALID_STATUSES = ['active', 'warming', 'paused', 'disabled'];

/**
 * GET /api/deliverability/mailboxes
 * Mailboxes annotated with effective daily cap, sends today, remaining
 * capacity, health score, and warmup/auth posture.
 */
router.get('/mailboxes', async (req, res) => {
  try {
    const mailboxes = await deliverability.mailboxStatus(req.user.id);
    res.json({ mailboxes });
  } catch (err) {
    console.error('Error loading mailboxes:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/deliverability/mailboxes
 * Body: { email, provider?, dailyCapTarget?, warmupEnabled?, rotationWeight?, dkimSelector? }
 */
router.post('/mailboxes', async (req, res) => {
  const { email, provider, dailyCapTarget, warmupEnabled, rotationWeight, dkimSelector } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }
  if (provider && !VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
  }
  try {
    const mailbox = await deliverability.createMailbox(req.user.id, {
      email,
      provider,
      dailyCapTarget,
      warmupEnabled: warmupEnabled !== false,
      rotationWeight,
      dkimSelector: dkimSelector || null,
    });
    res.status(201).json({ mailbox });
  } catch (err) {
    console.error('Error creating mailbox:', err);
    res.status(400).json({ error: err.message || 'Failed to create mailbox' });
  }
});

/**
 * PUT /api/deliverability/mailboxes/:id
 * Body: any of { daily_cap_target, warmup_enabled, rotation_weight, status, provider, dkim_selector }
 */
router.put('/mailboxes/:id', async (req, res) => {
  const fields = req.body || {};
  if ('status' in fields && !VALID_STATUSES.includes(fields.status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  if ('provider' in fields && !VALID_PROVIDERS.includes(fields.provider)) {
    return res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
  }
  try {
    const mailbox = await deliverability.updateMailbox(req.user.id, req.params.id, fields);
    if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
    res.json({ mailbox });
  } catch (err) {
    console.error('Error updating mailbox:', err);
    res.status(400).json({ error: err.message || 'Failed to update mailbox' });
  }
});

/**
 * DELETE /api/deliverability/mailboxes/:id
 */
router.delete('/mailboxes/:id', async (req, res) => {
  try {
    const removed = await deliverability.deleteMailbox(req.user.id, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Mailbox not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting mailbox:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/deliverability/mailboxes/:id/check-auth
 * Run a live DNS SPF/DKIM/DMARC check and persist the result.
 */
router.post('/mailboxes/:id/check-auth', async (req, res) => {
  try {
    const mailbox = await deliverability.refreshMailboxAuth(req.user.id, req.params.id);
    if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
    res.json({ mailbox });
  } catch (err) {
    console.error('Error checking mailbox auth:', err);
    res.status(500).json({ error: 'Failed to check domain auth' });
  }
});

module.exports = router;
