const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { db, sql, orgWhere, orgUserWhere } = require('../db');
const requireAuth = require('../middleware/auth');
const { resolveOrg } = require('../middleware/resolveOrg');
const { resolveOrgIdForUser } = require('../services/auditLogger');
const { verify } = require('../lib/trackingSignature');

// Helper to generate tracking ID
function generateTrackingId() {
  return uuidv4();
}

// Parses and verifies the `d` query param produced by trackingService's
// getPixelUrl/getTrackedLink: `${base64(JSON)}.${hmacHex}`. Returns the
// decoded payload only if the signature is valid — an unsigned, forged, or
// tampered payload (e.g. a userId/contactId swapped in from a different
// org's pixel) returns null and must NOT be used to resolve an org or write
// an activity. Base64 and hex never contain '.', so splitting on the last
// '.' unambiguously separates data from signature.
function parseSignedTrackingPayload(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const sepIndex = raw.lastIndexOf('.');
  if (sepIndex === -1) return null;

  const dataString = raw.slice(0, sepIndex);
  const signature = raw.slice(sepIndex + 1);

  if (!verify(dataString, signature)) return null;

  try {
    return JSON.parse(Buffer.from(dataString, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// Legacy pixel.png endpoint for backward compatibility.
// PRE-EXISTING ROUTING BUG (fixed here, unrelated to org isolation but required for the
// org-attribution fix below to be reachable at all): this route must be registered
// BEFORE '/:trackingId.png' — Express/path-to-regexp treats ':trackingId.png' as "any
// segment ending in .png", so a literal GET /pixel.png request matched that catch-all
// first (with trackingId='pixel') and this handler was permanently unreachable. No
// security impact (the catch-all just no-ops on an unmatched tracking_id), but the
// entire query-string-based email-open-tracking feature has never fired since inception.
router.get('/pixel.png', async (req, res) => {
  try {
    if (req.query.d) {
      // Signature is verified BEFORE data.userId/data.contactId are trusted for
      // anything (including org resolution). An invalid/forged/tampered `d`
      // no-ops identically to today's "can't resolve org" case — same response,
      // no DB write, failure only logged server-side.
      const data = parseSignedTrackingPayload(req.query.d);
      if (!data) {
        console.error('Pixel tracking: signature verification failed');
      } else if (data.contactId && data.userId) {
        // organization_id comes from resolving the embedded sender (userId)'s org
        // server-side — never from any request-derived value. Anonymous recipient
        // supplies only the base64 payload the CRM itself generated at send time.
        const orgId = await resolveOrgIdForUser(data.userId);
        if (orgId) {
          await db
            .insertInto('activities')
            .values({
              organization_id: orgId,
              user_id: data.userId,
              contact_id: data.contactId,
              type: 'email_opened',
              description: data.subject ? `Opened email: ${data.subject}` : 'Opened tracked email',
            })
            .execute();
        }
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
      // Signature verified before any field of `data` — including the redirect
      // target and userId/contactId — is trusted. A tampered `d` falls back to
      // the default '/' redirect and writes nothing, same as an unparseable one.
      const data = parseSignedTrackingPayload(req.query.d);
      if (!data) {
        console.error('Link tracking: signature verification failed');
      } else {
        if (data.url) targetUrl = data.url;

        if (data.contactId && data.userId) {
          // Same resolution as /pixel.png — organization_id comes from the embedded
          // sender (userId), resolved server-side, never from the request.
          const orgId = await resolveOrgIdForUser(data.userId);
          if (orgId) {
            await db
              .insertInto('activities')
              .values({
                organization_id: orgId,
                user_id: data.userId,
                contact_id: data.contactId,
                type: 'link_clicked',
                description: data.url ? `Clicked tracked link to ${data.url}` : 'Clicked tracked link',
              })
              .execute();
          }
        }
      }
    }
  } catch(e) {
    console.error('Link tracking error:', e);
  }
  res.redirect(targetUrl);
});

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

      // Log to activities. organization_id comes from the tracking record itself
      // (stamped server-side when it was created in POST /create) — the anonymous
      // pixel-loading recipient supplies nothing but the trackingId.
      const assetLabel = tracking.asset_type.charAt(0).toUpperCase() + tracking.asset_type.slice(1);
      await db
        .insertInto('activities')
        .values({
          organization_id: tracking.organization_id,
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

// API: Create tracking record for an asset (proposal, invoice, etc)
// resolveOrg is required here (not at mount level — see index.js comment on the
// /api/track flat mount): it mixes public pixel/link routes with these authed ones.
// On the /api/org/:orgSlug mount, requireOrg has already set req.orgId; resolveOrg
// no-ops harmlessly there (defers to req.params.orgSlug).
router.post('/create', requireAuth, resolveOrg, async (req, res) => {
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
        organization_id: req.orgId,
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
router.get('/contact/:contactId', requireAuth, resolveOrg, async (req, res) => {
  try {
    const { contactId } = req.params;

    const rows = await db
      .selectFrom('engagement_tracking')
      .$call(orgWhere(req.orgId))
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
router.get('/asset/:assetType/:assetId', requireAuth, resolveOrg, async (req, res) => {
  try {
    const { assetType, assetId } = req.params;

    const rows = await db
      .selectFrom('engagement_tracking')
      .$call(orgWhere(req.orgId))
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
