/**
 * Webhook Routes
 * Handles incoming webhooks from third-party services (Twilio, Stripe, etc.)
 */

const express = require('express');
const router = express.Router();

const WebhookReceiverService = require('../services/webhookReceiver');

/**
 * POST /api/webhooks/twilio
 * Receive Twilio webhook events (inbound SMS, delivery status, etc.)
 * 
 * Twilio sends:
 * - Inbound SMS: From, To, Body, MessageSid
 * - Delivery Status: MessageSid, MessageStatus, ErrorCode (optional)
 * - Opt-out: Type = "MessageStatus", MessageStatus = "undelivered", ErrorCode = specific codes
 */
router.post('/twilio', async (req, res) => {
  try {
    // Validate Twilio signature (security check)
    const isValid = WebhookReceiverService.validateSignature(req);
    
    if (!isValid) {
      console.warn('⚠️  Invalid Twilio webhook signature - rejecting');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Handle the webhook
    const result = await WebhookReceiverService.handleWebhook(req.body);

    // Log for debugging
    WebhookReceiverService.logWebhook(req, 'twilio', result);

    if (!result.success) {
      console.warn(`⚠️  Webhook processing failed: ${result.error}`);
      // Still return 200 to Twilio (don't want retries for bad data)
      return res.status(200).json({ received: true, error: result.error });
    }

    // Format TwiML response
    const twimlResponse = WebhookReceiverService.formatTwiMLResponse(result);

    // Return TwiML response with appropriate status
    return res.status(200)
      .type('text/xml')
      .send(twimlResponse);

  } catch (error) {
    console.error('❌ Twilio webhook error:', error.message);
    // Return 200 anyway to acknowledge receipt to Twilio
    return res.status(200).json({ received: true, error: error.message });
  }
});

/**
 * GET /api/webhooks/health
 * Health check for webhook receiver
 */
router.get('/health', async (req, res) => {
  try {
    const health = await WebhookReceiverService.getHealthStatus();

    return res.json({
      success: true,
      health
    });
  } catch (error) {
    console.error('❌ Health check error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
