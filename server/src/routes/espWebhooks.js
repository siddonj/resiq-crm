const express = require('express');
const crypto = require('crypto');
const pool = require('../models/db');
const integrationSettings = require('../services/integrationSettings');
const compliance = require('../services/outbound/complianceService');
const deliverability = require('../services/outbound/deliverabilityService');

/**
 * SendGrid Event Webhook ingestion — the bounce/complaint/open/click feedback
 * loop the deliverability engine reads from (outbound_mailbox_daily_stats).
 *
 * Mounted BEFORE the global express.json() so the raw body is available for
 * Ed25519 signature verification (SendGrid signs the exact payload bytes).
 * Public route: authenticity comes from the signature, not a session.
 */

const router = express.Router();

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

function verifySignature(publicKeyBase64, payload, signature, timestamp) {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp), payload]),
      publicKey,
      Buffer.from(signature, 'base64')
    );
  } catch (err) {
    console.error('SendGrid webhook signature verification error:', err.message);
    return false;
  }
}

/**
 * Record the event id; returns false when we've already processed it
 * (SendGrid retries and can deliver duplicates).
 */
async function markEventProcessed(event) {
  const eventId = event.sg_event_id;
  if (!eventId) return true; // no id — process rather than drop
  const res = await pool.query(
    `INSERT INTO outbound_esp_events (sg_event_id, event_type, email, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (sg_event_id) DO NOTHING
     RETURNING sg_event_id`,
    [eventId, event.event || null, compliance.normalizeEmail(event.email), JSON.stringify(event)]
  );
  return res.rows.length > 0;
}

async function updateDraftEngagement(draftId, userId, column) {
  await pool.query(
    `UPDATE outbound_message_drafts SET ${column} = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND ${column} IS NULL`,
    [draftId, userId]
  );
}

async function logLeadEvent({ userId, leadId, eventType, metadata }) {
  if (!leadId) return;
  try {
    await pool.query(
      `INSERT INTO lead_source_events (user_id, lead_id, event_type, channel, metadata)
       VALUES ($1, $2, $3, 'email', $4)`,
      [userId, leadId, eventType, JSON.stringify(metadata || {})]
    );
  } catch (err) {
    console.error('Failed to log lead event from ESP webhook:', err.message);
  }
}

async function handleEvent(event) {
  const type = event.event;
  const userId = event.userId || null;
  const mailboxId = event.mailboxId || null;
  const draftId = event.draftId || null;
  const leadId = event.leadId || null;
  const email = compliance.normalizeEmail(event.email);
  if (!userId) return; // not one of ours (no custom_args) — ignore

  const fresh = await markEventProcessed(event);
  if (!fresh) return;

  switch (type) {
    case 'bounce':
    case 'dropped': {
      if (mailboxId) await deliverability.recordMailboxEvent(userId, mailboxId, 'bounced');
      // Hard bounces / drops are permanent — suppress so nothing retries them.
      // SendGrid marks temporary blocks with type='blocked'; don't suppress those.
      const isHard = event.type !== 'blocked';
      if (email && isHard) {
        await compliance.addSuppression(userId, {
          email,
          reason: `Email ${type}: ${event.reason || 'permanent failure'}`.slice(0, 500),
          source: 'esp_bounce',
        });
      }
      await logLeadEvent({ userId, leadId, eventType: 'email_bounced', metadata: { draftId, reason: event.reason } });
      break;
    }
    case 'spamreport': {
      if (mailboxId) await deliverability.recordMailboxEvent(userId, mailboxId, 'complained');
      if (email) await compliance.recordOptOut({ userId, email, leadId, source: 'spam_report' });
      await logLeadEvent({ userId, leadId, eventType: 'email_complaint', metadata: { draftId } });
      break;
    }
    case 'open': {
      if (mailboxId) await deliverability.recordMailboxEvent(userId, mailboxId, 'opened');
      if (draftId) await updateDraftEngagement(draftId, userId, 'opened_at');
      await logLeadEvent({ userId, leadId, eventType: 'email_opened', metadata: { draftId } });
      break;
    }
    case 'click': {
      if (draftId) await updateDraftEngagement(draftId, userId, 'clicked_at');
      await logLeadEvent({ userId, leadId, eventType: 'email_clicked', metadata: { draftId, url: event.url } });
      break;
    }
    case 'delivered': {
      if (draftId) await updateDraftEngagement(draftId, userId, 'delivered_at');
      break;
    }
    default:
      break;
  }
}

router.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const verificationKey = await integrationSettings.getSetting('sendgrid_webhook_verification_key');
    if (!verificationKey) {
      return res.status(503).json({ error: 'Webhook verification key not configured' });
    }

    const signature = req.headers[SIGNATURE_HEADER];
    const timestamp = req.headers[TIMESTAMP_HEADER];
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || []));
    if (!signature || !timestamp || !verifySignature(verificationKey, rawBody, signature, timestamp)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    let events;
    try {
      events = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    if (!Array.isArray(events)) events = [events];

    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (err) {
        // Never fail the whole batch — SendGrid would retry everything.
        console.error('Failed to process SendGrid event:', err.message);
      }
    }

    res.status(200).json({ received: events.length });
  } catch (err) {
    console.error('SendGrid webhook error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
