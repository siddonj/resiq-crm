const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const pool = require('../models/db');
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
    const result = await pool.query(
      'SELECT * FROM engagement_tracking WHERE tracking_id = $1',
      [trackingId]
    );

    if (result.rows.length > 0) {
      const tracking = result.rows[0];
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('user-agent') || '';

      // Update engagement record with open data
      await pool.query(
        `UPDATE engagement_tracking 
         SET opened_at = NOW(), ip_address = $1, user_agent = $2 
         WHERE tracking_id = $3`,
        [ipAddress, userAgent, trackingId]
      );

      // Log to activities
      const assetLabel = tracking.asset_type.charAt(0).toUpperCase() + tracking.asset_type.slice(1);
      await pool.query(
        `INSERT INTO activities (user_id, contact_id, type, description) 
         VALUES ($1, $2, $3, $4)`,
        [
          tracking.user_id,
          tracking.contact_id,
          `${tracking.asset_type}_opened`,
          `${assetLabel} opened (ID: ${tracking.asset_id})`
        ]
      );
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
        await pool.query(
          'INSERT INTO activities (user_id, contact_id, type, description) VALUES ($1, $2, $3, $4)',
          [data.userId, data.contactId, 'email_opened', data.subject ? `Opened email: ${data.subject}` : 'Opened tracked email']
        );
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
        await pool.query(
          'INSERT INTO activities (user_id, contact_id, type, description) VALUES ($1, $2, $3, $4)',
          [data.userId, data.contactId, 'link_clicked', data.url ? `Clicked tracked link to ${data.url}` : 'Clicked tracked link']
        );
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
    
    const result = await pool.query(
      `INSERT INTO engagement_tracking (user_id, contact_id, tracking_id, asset_type, asset_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, contactId, trackingId, assetType, assetId]
    );

    res.json({
      tracking: result.rows[0],
      pixelUrl: `/api/track/${trackingId}.png`
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
    
    const result = await pool.query(
      `SELECT * FROM engagement_tracking 
       WHERE contact_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [contactId, req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching engagement:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get engagement stats for an asset
router.get('/asset/:assetType/:assetId', requireAuth, async (req, res) => {
  try {
    const { assetType, assetId } = req.params;
    
    const result = await pool.query(
      `SELECT * FROM engagement_tracking 
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
      openRate: totalCreated > 0 ? ((opens / totalCreated) * 100).toFixed(2) + '%' : '0%',
      engagements: result.rows
    });
  } catch (error) {
    console.error('Error fetching asset engagement:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
