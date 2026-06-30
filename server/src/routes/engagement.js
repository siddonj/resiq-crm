const express = require('express');
const { db, sql, orgWhere, orgUserWhere } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// Get engagement timeline for a contact
router.get('/contact/:contactId', auth, async (req, res) => {
  try {
    const { contactId } = req.params;

    // Get engagement tracking records
    const trackingResult = await sql`
      SELECT 
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
      WHERE et.contact_id = ${contactId} AND et.user_id = ${req.user.id}
      ORDER BY COALESCE(et.opened_at, et.created_at) DESC
    `.execute(db);

    // Get related activities
    const activitiesResult = await sql`
      SELECT *
      FROM activities
      WHERE contact_id = ${contactId} AND user_id = ${req.user.id} AND type LIKE '%_opened'
      ORDER BY occurred_at DESC
    `.execute(db);

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

    const result = await sql`
      SELECT 
        id,
        tracking_id,
        contact_id,
        opened_at,
        ip_address,
        user_agent,
        created_at
      FROM engagement_tracking
      WHERE asset_type = ${assetType} AND asset_id = ${assetId} AND user_id = ${req.user.id}
      ORDER BY created_at DESC
    `.execute(db);

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
    const result = await db.insertInto('engagement_tracking')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        contact_id: contactId || null,
        tracking_id: trackingId,
        asset_type: assetType,
        asset_id: assetId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    res.status(201).json({
      tracking: result,
      pixelUrl: `/api/track/${trackingId}.png`,
    });
  } catch (error) {
    console.error('Error creating tracking:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
