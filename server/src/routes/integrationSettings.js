const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  getManagedCredentials,
  updateManagedCredentials,
  resolveWithOverride,
} = require('../services/integrationSettings');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

router.use(auth, requireRole('admin'));

/**
 * GET /api/integration-settings
 * Admin: list managed integration credentials (secrets masked).
 */
router.get('/', async (req, res) => {
  try {
    const settings = await getManagedCredentials();
    res.json({ settings });
  } catch (err) {
    console.error('Error loading integration settings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/integration-settings
 * Admin: update one or more integration credentials.
 * Body: { settings: { key: value, ... } }
 */
router.put('/', async (req, res) => {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return res.status(400).json({ error: 'settings object is required' });
  }

  try {
    await updateManagedCredentials(settings, req.user.id);
    const refreshed = await getManagedCredentials();

    logAction(
      req.user.id,
      req.user.email,
      'update',
      'integration_credentials',
      null,
      'integration_settings',
      { updated_keys: Object.keys(settings) },
      req.orgId
    );

    res.json({ settings: refreshed });
  } catch (err) {
    if (err.message && (err.message.includes('Unsupported integration credential key') || err.message.includes('cannot be empty'))) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error updating integration settings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

const PROVIDER_TESTERS = {
  twilio: async (overrides) => {
    const [accountSid, authToken] = await Promise.all([
      resolveWithOverride('twilio_account_sid', overrides),
      resolveWithOverride('twilio_auth_token', overrides),
    ]);
    if (!accountSid || !authToken) throw new Error('Account SID and Auth Token are required');
    const twilio = require('twilio');
    const client = twilio(accountSid, authToken);
    await client.api.accounts(accountSid).fetch();
  },
  stripe: async (overrides) => {
    const secretKey = await resolveWithOverride('stripe_secret_key', overrides);
    if (!secretKey) throw new Error('Secret Key is required');
    const Stripe = require('stripe');
    const stripe = Stripe(secretKey);
    await stripe.balance.retrieve();
  },
  smtp: async (overrides) => {
    const [host, port, user, pass, secure] = await Promise.all([
      resolveWithOverride('smtp_host', overrides),
      resolveWithOverride('smtp_port', overrides),
      resolveWithOverride('smtp_user', overrides),
      resolveWithOverride('smtp_pass', overrides),
      resolveWithOverride('smtp_secure', overrides),
    ]);
    if (!host || !user || !pass) throw new Error('Host, Username, and Password are required');
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host,
      port: port || 587,
      secure: !!secure,
      auth: { user, pass },
    });
    await transporter.verify();
  },
  hunter: async (overrides) => {
    const apiKey = await resolveWithOverride('hunter_api_key', overrides);
    if (!apiKey) throw new Error('API Key is required');
    const axios = require('axios');
    const res = await axios.get('https://api.hunter.io/v2/account', {
      params: { api_key: apiKey },
      timeout: 10000,
    });
    if (!res.data?.data) throw new Error('Unexpected response from Hunter.io');
  },
  openai: async (overrides) => {
    const apiKey = await resolveWithOverride('openai_api_key', overrides);
    if (!apiKey) throw new Error('API Key is required');
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey });
    await openai.models.list();
  },
  sendgrid: async (overrides) => {
    const apiKey = await resolveWithOverride('sendgrid_api_key', overrides);
    if (!apiKey) throw new Error('API Key is required');
    const { testConnection } = require('../services/espSendService');
    await testConnection(apiKey);
  },
};

/**
 * POST /api/integration-settings/:provider/test
 * Admin: run a live check against the given provider using the current form
 * values (overrides) or, for any field not overridden, the saved/env value.
 */
router.post('/:provider/test', async (req, res) => {
  const { provider } = req.params;
  const tester = PROVIDER_TESTERS[provider];
  if (!tester) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  const overrides = req.body?.overrides && typeof req.body.overrides === 'object' ? req.body.overrides : {};

  try {
    await tester(overrides);
    res.json({ success: true });
  } catch (err) {
    const message =
      err.response?.data?.errors?.[0]?.details ||
      err.response?.data?.error?.message ||
      err.message ||
      'Connection test failed';
    res.json({ success: false, error: message });
  }
});

module.exports = router;
