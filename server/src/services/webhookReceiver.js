/**
 * Webhook Receiver Service
 * Handles incoming webhooks from Twilio for delivery status, inbound SMS, and opt-outs
 */

const TwilioService = require('./twilioService');
const SMS = require('../models/SMS');

class WebhookReceiverService {
  /**
   * Handle Twilio webhook event
   * @param {Object} data - Webhook data from Twilio
   * @returns {Object} { success, messageType, data }
   */
  static async handleWebhook(data) {
    if (!data) {
      return {
        success: false,
        error: 'Empty webhook data'
      };
    }

    // Determine webhook type
    let messageType = 'unknown';

    // Inbound SMS
    if (data.From && data.To && data.Body && data.MessageSid) {
      messageType = 'inbound-sms';
      return this.handleInboundSMS(data);
    }

    // Message Status (Delivery status)
    if (data.MessageSid && data.MessageStatus) {
      messageType = 'message-status';
      return this.handleMessageStatus(data);
    }

    return {
      success: false,
      error: 'Unknown webhook type'
    };
  }

  /**
   * Handle inbound SMS webhook
   * @param {Object} data - Webhook data
   * @returns {Object} Result
   */
  static async handleInboundSMS(data) {
    try {
      const result = await TwilioService.handleInboundSMS(data);

      if (!result.success) {
        console.warn('⚠️  Inbound SMS handling returned error:', result.error);
        return {
          success: false,
          error: result.error
        };
      }

      // Handle STOP keyword specially
      if (result.isSTOP) {
        return {
          success: true,
          messageType: 'inbound-sms-stop',
          contactId: result.contactId,
          isSTOP: true
        };
      }

      return {
        success: true,
        messageType: 'inbound-sms',
        messageId: result.messageId,
        contactId: result.contactId
      };
    } catch (error) {
      console.error('❌ Error handling inbound SMS:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle message status webhook (delivery status)
   * @param {Object} data - Webhook data
   * @returns {Object} Result
   */
  static async handleMessageStatus(data) {
    const {
      MessageSid,
      MessageStatus,
      ErrorCode = null
    } = data;

    if (!MessageSid || !MessageStatus) {
      return {
        success: false,
        error: 'Missing MessageSid or MessageStatus'
      };
    }

    try {
      const result = await TwilioService.handleDeliveryStatus(
        MessageSid,
        MessageStatus,
        ErrorCode
      );

      return {
        success: true,
        messageType: 'message-status',
        messageId: result.messageId,
        status: MessageStatus
      };
    } catch (error) {
      console.error('❌ Error handling message status:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate webhook signature (security check)
   * @param {Object} req - Express request object
   * @returns {boolean} Signature is valid
   */
  static validateSignature(req) {
    const twilioSignature = req.get('X-Twilio-Signature');
    const requestUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const data = req.body;

    if (!twilioSignature) {
      console.warn('⚠️  Missing Twilio signature header');
      // Allow if Twilio not configured (for development)
      if (!TwilioService.isConfigured()) {
        console.warn('⚠️  Skipping signature verification - Twilio not configured');
        return true;
      }
      return false;
    }

    return TwilioService.verifyWebhookSignature(twilioSignature, requestUrl, data);
  }

  /**
   * Log webhook for debugging
   * @param {Object} req - Express request
   * @param {string} type - Webhook type
   * @param {Object} result - Handler result
   */
  static logWebhook(req, type, result) {
    const timestamp = new Date().toISOString();
    const ip = req.ip || req.connection.remoteAddress;

    console.log(`\n📨 Webhook Received [${timestamp}]`);
    console.log(`  Type: ${type}`);
    console.log(`  IP: ${ip}`);
    console.log(`  Status: ${result.success ? '✓ Success' : '✗ Failed'}`);
    if (result.messageType) console.log(`  Message Type: ${result.messageType}`);
    if (result.messageId) console.log(`  Message ID: ${result.messageId}`);
    if (result.contactId) console.log(`  Contact ID: ${result.contactId}`);
    if (result.error) console.log(`  Error: ${result.error}`);
  }

  /**
   * Format webhook response for Twilio
   * @param {Object} result - Handler result
   * @returns {string} TwiML response
   */
  static formatTwiMLResponse(result) {
    // Twilio expects an HTTP 200 response with optional TwiML
    // For SMS webhooks, we typically just return empty or acknowledgment

    if (result.success && result.messageType === 'inbound-sms-stop') {
      // Could send a confirmation SMS here if desired
      return `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message>You have been unsubscribed from SMS messages. Reply START to re-subscribe.</Message>
        </Response>`;
    }

    // Default: just acknowledge receipt
    return `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
      </Response>`;
  }

  /**
   * Get webhook health status
   * @returns {Object} Health info
   */
  static async getHealthStatus() {
    return {
      twilioConfigured: TwilioService.isConfigured(),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = WebhookReceiverService;
