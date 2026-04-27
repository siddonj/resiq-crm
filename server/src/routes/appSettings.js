const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { getManagedSettings, updateManagedSettings } = require('../services/appSettings');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

router.use(auth, requireRole('admin'));

/**
 * GET /api/app-settings
 * Admin: list managed runtime settings.
 */
router.get('/', async (req, res) => {
  try {
    const settings = await getManagedSettings();
    res.json({ settings });
  } catch (err) {
    console.error('Error loading app settings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/app-settings
 * Admin: update managed runtime settings.
 * Body: { settings: { key: value, ... } }
 */
router.put('/', async (req, res) => {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return res.status(400).json({ error: 'settings object is required' });
  }

  try {
    await updateManagedSettings(settings, req.user.id);
    const refreshed = await getManagedSettings();

    logAction(
      req.user.id,
      req.user.email,
      'update',
      'app_settings',
      null,
      'system_settings',
      { updated_keys: Object.keys(settings) }
    );

    res.json({ settings: refreshed });
  } catch (err) {
    if (err.message && err.message.includes('Unsupported setting key')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.includes('must')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error updating app settings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
