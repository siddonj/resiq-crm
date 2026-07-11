const express = require('express');
const auth = require('../middleware/auth');
const pool = require('../models/db');
const compliance = require('../services/outbound/complianceService');
const { logAction } = require('../services/auditLogger');

const router = express.Router();
router.use(auth);

const VALID_REGIONS = ['US', 'EU', 'UK', 'CA', 'OTHER'];

/**
 * GET /api/compliance/config
 * Per-user CAN-SPAM / compliance settings.
 */
router.get('/config', async (req, res) => {
  try {
    const config = await compliance.getComplianceConfig(req.user.id, req.orgId);
    res.json({ config });
  } catch (err) {
    console.error('Error loading compliance config:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/compliance/config
 * Body: { physicalMailingAddress, complianceRegion, unsubscribeFooterEnabled }
 */
router.put('/config', async (req, res) => {
  const address = typeof req.body?.physicalMailingAddress === 'string' ? req.body.physicalMailingAddress.trim() : '';
  const region = req.body?.complianceRegion;
  const footerEnabled = req.body?.unsubscribeFooterEnabled;

  if (region && !VALID_REGIONS.includes(region)) {
    return res.status(400).json({ error: `complianceRegion must be one of ${VALID_REGIONS.join(', ')}` });
  }
  if (footerEnabled !== undefined && typeof footerEnabled !== 'boolean') {
    return res.status(400).json({ error: 'unsubscribeFooterEnabled must be a boolean' });
  }

  try {
    // Convention: organization_id is set on insert only and never reassigned
    // on conflict. Org identity comes from server-side membership (req.orgId)
    // and must not silently move a row to a different org on a later write.
    const res2 = await pool.query(
      `INSERT INTO outbound_workspace_config (user_id, organization_id, physical_mailing_address, compliance_region, unsubscribe_footer_enabled, updated_at)
       VALUES ($1, $2, $3, COALESCE($4, 'US'), COALESCE($5, TRUE), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         physical_mailing_address = EXCLUDED.physical_mailing_address,
         compliance_region = COALESCE($4, outbound_workspace_config.compliance_region),
         unsubscribe_footer_enabled = COALESCE($5, outbound_workspace_config.unsubscribe_footer_enabled),
         updated_at = NOW()
       RETURNING physical_mailing_address, compliance_region, unsubscribe_footer_enabled`,
      [req.user.id, req.orgId, address, region || null, footerEnabled === undefined ? null : footerEnabled]
    );
    logAction(req.user.id, req.user.email, 'update', 'compliance_config', null, 'outbound', {
      region: region || null,
      footerEnabled,
    }, req.orgId);
    res.json({ config: res2.rows[0] });
  } catch (err) {
    console.error('Error updating compliance config:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/compliance/suppression?search=&limit=
 */
router.get('/suppression', async (req, res) => {
  try {
    const entries = await compliance.listSuppression(req.user.id, {
      search: req.query.search || '',
      limit: req.query.limit || 200,
      orgId: req.orgId,
    });
    res.json({ entries });
  } catch (err) {
    console.error('Error listing suppression:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/compliance/suppression
 * Body: { email, reason?, matchType? }
 */
router.post('/suppression', async (req, res) => {
  const { email, reason, matchType } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  try {
    const entry = await compliance.addSuppression(req.user.id, {
      email,
      reason: reason || 'Manually suppressed',
      source: 'manual',
      matchType: matchType === 'domain' ? 'domain' : 'email',
      orgId: req.orgId,
    });
    res.status(201).json({ entry });
  } catch (err) {
    if (/Invalid email/.test(err.message)) return res.status(400).json({ error: err.message });
    console.error('Error adding suppression:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/compliance/suppression/import
 * Body: { emails: [...] }
 */
router.post('/suppression/import', async (req, res) => {
  const emails = req.body?.emails;
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'emails array is required' });
  }
  if (emails.length > 5000) {
    return res.status(400).json({ error: 'Maximum 5000 emails per import' });
  }
  try {
    const result = await compliance.importSuppression(req.user.id, emails, { orgId: req.orgId });
    res.json(result);
  } catch (err) {
    console.error('Error importing suppression:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/compliance/suppression
 * Body: { email }
 */
router.delete('/suppression', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  try {
    const removed = await compliance.removeSuppression(req.user.id, email, req.orgId);
    if (!removed) return res.status(404).json({ error: 'Entry not found' });
    res.json({ removed: true });
  } catch (err) {
    console.error('Error removing suppression:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/compliance/events?limit=
 * Recent compliance audit events for the workspace.
 */
router.get('/events', async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  try {
    const result = await pool.query(
      `SELECT id, lead_id, email, event_type, channel, details, created_at
       FROM outbound_compliance_events
       WHERE user_id = $1 AND organization_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [req.user.id, req.orgId, limit]
    );
    res.json({ events: result.rows });
  } catch (err) {
    console.error('Error loading compliance events:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
