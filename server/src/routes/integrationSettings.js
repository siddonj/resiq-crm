const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  getManagedCredentials,
  updateManagedCredentials,
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

module.exports = router;
