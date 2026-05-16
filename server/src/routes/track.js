const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { db, sql } = require('../db');
const requireAuth = require('../middleware/auth');

// Helper to generate tracking ID
function generateTrackingId() {
  return uuidv4();
}

// Pixel tracking endpoint with improved engagement tracking
router.get('/:trackingId.png', async (req, res) => {
  const { trackingId } = req.params;
  
  try {
    // Get tracking record
    const tracking = await db
      .selectFrom('engagement_tracking')
      .where('tracking_id', '=', trackingId)
      .selectAll()
      .executeTakeFirst();

    if (tracking) {
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('user-agent') || '';

      // Update engagement record with open data
      await db
        .updateTable('engagement_tracking')
        .set({
          opened_at: new Date(),
          ip_address: ipAddress,
          user_agent: userAgent,
        })
        .where('tracking_id', '=', trackingId)
        .execute();

      // Log to activities
      const assetLabel = tracking.asset_type.charAt(0).toUpperCase() + tracking.asset_type.slice(1);
      await db
        .insertInto('activities')
        .values({
          user_id: tracking.user_id,
          contact_id: tracking.contact_id,
          type: `${tracking.asset_type}_opened`,
          description: `${assetLabel} opened (ID: ${tracking.asset_id})`,
        })
        .execute();
    }
  } catch(e) {
    console.error('Pixel tracking error:', e);
  }
  
  // Return 1x1 transparent GIF
  const pixel = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private'
  });
  res.end(pixel);
});

// Legacy pixel.png endpoint for backward compatibility
router.get('/pixel.png', async (req, res) => {
  try {
    if (req.query.d) {
      const data = JSON.parse(Buffer.from(req.query.d, 'base64').toString('utf8'));
      if (data.contactId && data.userId) {
        await db
          .insertInto('activities')
          .values({
            user_id: data.userId,
            contact_id: data.contactId,
            type: 'email_opened',
            description: data.subject ? `Opened email: ${data.subject}` : 'Opened tracked email',
          })
          .execute();
      }
    }
  } catch(e) {
    console.error('Pixel tracking error:', e);
  }
  
  const pixel = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private'
  });
  res.end(pixel);
});

router.get('/link', async (req, res) => {
  let targetUrl = '/';
  try {
    if (req.query.d) {
      const data = JSON.parse(Buffer.from(req.query.d, 'base64').toString('utf8'));
      if (data.url) targetUrl = data.url;
      
      if (data.contactId && data.userId) {
        await db
          .insertInto('activities')
          .values({
            user_id: data.userId,
            contact_id: data.contactId,
            type: 'link_clicked',
            description: data.url ? `Clicked tracked link to ${data.url}` : 'Clicked tracked link',
          })
          .execute();
      }
    }
  } catch(e) {
    console.error('Link tracking error:', e);
  }
  res.redirect(targetUrl);
});

// API: Create tracking record for an asset (proposal, invoice, etc)
router.post('/create', requireAuth, async (req, res) => {
  try {
    const { contactId, assetType, assetId } = req.body;
    const userId = req.user.id;

    if (!assetType || !assetId) {
      return res.status(400).json({ error: 'Missing required fields: assetType, assetId' });
    }

    const trackingId = generateTrackingId();
    
    const tracking = await db
      .insertInto('engagement_tracking')
      .values({
        user_id: userId,
        contact_id: contactId || null,
        tracking_id: trackingId,
        asset_type: assetType,
        asset_id: assetId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    res.json({
      tracking,
      pixelUrl: `/api/track/${trackingId}.png`,
    });
  } catch (error) {
    console.error('Error creating tracking record:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get engagement history for a contact
router.get('/contact/:contactId', requireAuth, async (req, res) => {
  try {
    const { contactId } = req.params;
    
    const rows = await db
      .selectFrom('engagement_tracking')
      .where('contact_id', '=', contactId)
      .where('user_id', '=', req.user.id)
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();

    res.json(rows);
  } catch (error) {
    console.error('Error fetching engagement:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get engagement stats for an asset
router.get('/asset/:assetType/:assetId', requireAuth, async (req, res) => {
  try {
    const { assetType, assetId } = req.params;
    
    const rows = await db
      .selectFrom('engagement_tracking')
      .where('asset_type', '=', assetType)
      .where('asset_id', '=', assetId)
      .where('user_id', '=', req.user.id)
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();

    const opens = rows.filter(r => r.opened_at).length;
    const totalCreated = rows.length;

    res.json({
      asset: { type: assetType, id: assetId },
      opens,
      totalCreated,
      openRate: totalCreated > 0 ? ((opens / totalCreated) * 100).toFixed(2) + '%' : '0%',
      engagements: rows,
    });
  } catch (error) {
    console.error('Error fetching asset engagement:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
