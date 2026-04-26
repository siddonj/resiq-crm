const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');

const router = express.Router();

// Get engagement timeline for a contact
router.get('/contact/:contactId', auth, async (req, res) => {
  try {
    const { contactId } = req.params;

    // Get engagement tracking records
    const trackingResult = await pool.query(
      `SELECT 
        et.id,
        et.tracking_id,
        et.asset_type,
        et.asset_id,
        et.opened_at,
        et.ip_address,
        et.user_agent,
        et.created_at,
        CASE 
          WHEN et.asset_type = 'proposal' THEN p.title
          WHEN et.asset_type = 'invoice' THEN i.invoice_number
          ELSE et.asset_id::text
        END AS asset_title
       FROM engagement_tracking et
       LEFT JOIN proposals p ON p.id = et.asset_id AND et.asset_type = 'proposal'
       LEFT JOIN invoices i ON i.id = et.asset_id AND et.asset_type = 'invoice'
       WHERE et.contact_id = $1 AND et.user_id = $2
       ORDER BY COALESCE(et.opened_at, et.created_at) DESC`,
      [contactId, req.user.id]
    );

    // Get related activities
    const activitiesResult = await pool.query(
      `SELECT *
       FROM activities
       WHERE contact_id = $1 AND user_id = $2 AND type LIKE '%_opened'
       ORDER BY occurred_at DESC`,
      [contactId, req.user.id]
    );

    const engagements = trackingResult.rows.map(track => ({
      id: track.id,
      type: 'engagement',
      assetType: track.asset_type,
      assetId: track.asset_id,
      assetTitle: track.asset_title,
      opened: !!track.opened_at,
      openedAt: track.opened_at,
      ipAddress: track.ip_address,
      userAgent: track.user_agent,
      createdAt: track.created_at
    }));

    res.json({
      trackingRecords: engagements,
      totalTracked: trackingResult.rows.length,
      opened: trackingResult.rows.filter(r => r.opened_at).length
    });
  } catch (error) {
    console.error('Error fetching engagement:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get engagement stats for an asset
router.get('/asset/:assetType/:assetId', auth, async (req, res) => {
  try {
    const { assetType, assetId } = req.params;

    const result = await pool.query(
      `SELECT 
        id,
        tracking_id,
        contact_id,
        opened_at,
        ip_address,
        user_agent,
        created_at
       FROM engagement_tracking
       WHERE asset_type = $1 AND asset_id = $2 AND user_id = $3
       ORDER BY created_at DESC`,
      [assetType, assetId, req.user.id]
    );

    const opens = result.rows.filter(r => r.opened_at).length;
    const totalCreated = result.rows.length;

    res.json({
      asset: { type: assetType, id: assetId },
      opens,
      totalCreated,
      openRate: totalCreated > 0 ? ((opens / totalCreated) * 100).toFixed(2) : 0,
      engagements: result.rows
    });
  } catch (error) {
    console.error('Error fetching asset engagement:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create tracking record for an asset
router.post('/', auth, async (req, res) => {
  try {
    const { contactId, assetType, assetId } = req.body;

    if (!assetType || !assetId) {
      return res.status(400).json({ error: 'assetType and assetId required' });
    }

    const trackingId = require('crypto').randomUUID();
    const result = await pool.query(
      `INSERT INTO engagement_tracking (user_id, contact_id, tracking_id, asset_type, asset_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, contactId || null, trackingId, assetType, assetId]
    );

    res.status(201).json({
      tracking: result.rows[0],
      pixelUrl: `/api/track/${trackingId}.png`
    });
  } catch (error) {
    console.error('Error creating tracking:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
