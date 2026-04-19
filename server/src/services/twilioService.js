/**
 * Twilio Service Wrapper
 * Handles SMS sending, webhook verification, phone validation, and STOP keyword handling
 */

const twilio = require('twilio');
const libphonenumber = require('libphonenumber-js');
const SMS = require('../models/SMS');
const pool = require('../models/db');

// Twilio client initialization (optional - server continues without it)
let twilioClient = null;

try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
} catch (error) {
  console.warn('⚠️  Twilio not configured - SMS features will be unavailable');
}

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+1-555-RESIQ-1';
const RATE_LIMIT_PER_HOUR = parseInt(process.env.SMS_RATE_LIMIT_PER_HOUR || '10', 10);

class TwilioService {
  /**
   * Check if Twilio is configured
   * @returns {boolean}
   */
  static isConfigured() {
    return twilioClient !== null;
  }

  /**
   * Validate phone number using libphonenumber
   * @param {string} phoneNumber - Phone number to validate
   * @param {string} countryCode - Optional country code (default 'US')
   * @returns {Object} { isValid, formatted, countryCode, type }
   */
  static validatePhoneNumber(phoneNumber, countryCode = 'US') {
    try {
      const parsed = libphonenumber.parsePhoneNumber(phoneNumber, countryCode);

      if (!parsed) {
        return { isValid: false };
      }

      return {
        isValid: parsed.isValid(),
        formatted: parsed.formatInternational(),
        countryCode: parsed.country,
        type: parsed.getType()
      };
    } catch (error) {
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Send SMS via Twilio
   * @param {Object} options - { to, content, messageId }
   * @returns {Object} { success, twilio_message_sid, error }
   */
  static async sendSMS(options) {
    const { to, content, messageId } = options;

    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Twilio not configured'
      };
    }

    if (!to || !content) {
      throw new Error('Missing required fields: to, content');
    }

    if (content.length > 160) {
      console.warn(`⚠️  SMS content exceeds 160 characters (${content.length}). Will be split into multiple messages.`);
    }

    try {
      const message = await twilioClient.messages.create({
        body: content,
        from: TWILIO_PHONE_NUMBER,
        to
      });

      // Update message in database with Twilio SID
      if (messageId) {
        await SMS.updateTwilioSid(messageId, message.sid);
      }

      return {
        success: true,
        twilio_message_sid: message.sid,
        status: message.status
      };
    } catch (error) {
      console.error('❌ Twilio SMS send error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Verify Twilio webhook signature
   * @param {string} twilioSignature - X-Twilio-Signature header
   * @param {string} requestUrl - Full request URL
   * @param {Object} data - POST data
   * @returns {boolean} Signature is valid
   */
  static verifyWebhookSignature(twilioSignature, requestUrl, data) {
    if (!this.isConfigured()) {
      console.warn('⚠️  Cannot verify Twilio webhook - Twilio not configured');
      return false;
    }

    try {
      const validationResult = twilio.webhook.validateRequest(
        process.env.TWILIO_AUTH_TOKEN,
        twilioSignature,
        requestUrl,
        data
      );

      return validationResult;
    } catch (error) {
      console.error('❌ Webhook signature verification error:', error.message);
      return false;
    }
  }

  /**
   * Handle inbound SMS from Twilio webhook
   * @param {Object} data - Webhook data from Twilio
   * @returns {Object} { success, messageId, contactId }
   */
  static async handleInboundSMS(data) {
    const {
      From: phoneFrom,
      To: phoneTo,
      Body: content,
      MessageSid: twilioMessageSid
    } = data;

    if (!phoneFrom || !content || !twilioMessageSid) {
      throw new Error('Missing Twilio webhook fields');
    }

    // Find contact by phone number
    const contactResult = await pool.query(
      'SELECT id FROM clients WHERE phone_number = $1 LIMIT 1',
      [phoneFrom]
    );
    const contact = contactResult.rows[0];

    if (!contact) {
      console.warn(`⚠️  Inbound SMS from unknown number: ${phoneFrom}`);
      return {
        success: false,
        error: 'Contact not found'
      };
    }

    // Check for STOP keyword
    if (this.isSTOPKeyword(content)) {
      await this.handleSTOPKeyword(contact.id, phoneFrom);
      return {
        success: true,
        isSTOP: true,
        contactId: contact.id
      };
    }

    // Create inbound message
    const message = await SMS.receive({
      contactId: contact.id,
      content,
      phoneFrom,
      phoneTo,
      twilioMessageSid
    });

    // Log as activity
    const Activity = require('../models/Activity');
    await Activity.log({
      userId: null,
      contactId: contact.id,
      actionType: 'sms_received',
      metadata: {
        messageId: message.id,
        content: content.substring(0, 100), // First 100 chars
        phoneFrom
      }
    });

    return {
      success: true,
      messageId: message.id,
      contactId: contact.id
    };
  }

  /**
   * Handle delivery status update from Twilio
   * @param {string} messageSid - Twilio message SID
   * @param {string} status - 'delivered', 'failed', 'undelivered'
   * @param {string} errorCode - Optional error code from Twilio
   * @returns {Object} { success, messageId }
   */
  static async handleDeliveryStatus(messageSid, status, errorCode = null) {
    if (!messageSid) {
      throw new Error('Missing messageSid');
    }

    // Map Twilio status to our status
    const statusMap = {
      'sent': 'sent',
      'delivered': 'delivered',
      'failed': 'failed',
      'undelivered': 'failed'
    };

    const mappedStatus = statusMap[status] || 'failed';

    // Find message by Twilio SID
    const message = await SMS.getByTwilioSid(messageSid);

    if (!message) {
      console.warn(`⚠️  Delivery status for unknown message SID: ${messageSid}`);
      return {
        success: false,
        error: 'Message not found'
      };
    }

    // Update status
    const errorMessage = errorCode ? `Twilio error: ${errorCode}` : null;
    const updated = await SMS.updateStatus(message.id, mappedStatus, errorMessage);

    // Log failed messages as activity
    if (mappedStatus === 'failed') {
      const Activity = require('../models/Activity');
      await Activity.log({
        userId: null,
        contactId: message.contact_id,
        actionType: 'sms_failed',
        metadata: {
          messageId: message.id,
          errorCode,
          errorMessage
        }
      });
    }

    return {
      success: true,
      messageId: message.id
    };
  }

  /**
   * Check if message is STOP keyword
   * @param {string} content - Message content
   * @returns {boolean}
   */
  static isSTOPKeyword(content) {
    if (!content) return false;

    const keywords = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'END', 'QUIT'];
    const normalized = content.trim().toUpperCase();

    return keywords.includes(normalized) || normalized.startsWith('STOP');
  }

  /**
   * Handle STOP keyword - opt-out contact
   * @param {string} contactId - UUID of contact
   * @param {string} phoneNumber - Phone number of opt-out
   * @returns {Object} { success, optoutId }
   */
  static async handleSTOPKeyword(contactId, phoneNumber) {
    if (!contactId || !phoneNumber) {
      throw new Error('Missing required fields: contactId, phoneNumber');
    }

    try {
      // Insert or update opt-out record
      const result = await pool.query(
        `INSERT INTO sms_optouts (contact_id, phone_number, reason)
         VALUES ($1, $2, 'stop_keyword')
         ON CONFLICT (contact_id) DO UPDATE SET reason = 'stop_keyword', opted_out_at = NOW()
         RETURNING *`,
        [contactId, phoneNumber]
      );

      // Update contact SMS preferences
      await pool.query(
        'UPDATE clients SET sms_opted_in = false WHERE id = $1',
        [contactId]
      );

      // Log as activity (optional - Activity model may not exist)
      try {
        const Activity = require('../models/Activity');
        if (Activity && Activity.log) {
          await Activity.log({
            userId: null,
            contactId,
            actionType: 'sms_optout',
            metadata: {
              reason: 'stop_keyword',
              phoneNumber
            }
          });
        }
      } catch (activityErr) {
        // Activity logging is optional
        console.warn('Could not log activity:', activityErr.message);
      }

      console.log(`✓ Contact ${contactId} opted out (STOP keyword)`);

      return {
        success: true,
        optoutId: result.rows[0].id
      };
    } catch (error) {
      console.error('❌ Error handling STOP keyword:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check rate limit for contact
   * @param {string} contactId - UUID of contact
   * @param {number} limitPerHour - SMS limit per hour (default from env)
   * @returns {Object} { isAllowed, sentInLastHour, remaining }
   */
  static async checkRateLimit(contactId, limitPerHour = RATE_LIMIT_PER_HOUR) {
    const { db } = require('../models/index');

    // Count SMS sent to this contact in the last hour
    const result = await db.query(
      `SELECT COUNT(*) as count FROM sms_messages 
       WHERE contact_id = $1 
       AND direction = 'outbound'
       AND created_at > NOW() - INTERVAL '1 hour'`,
      [contactId]
    );

    const sentInLastHour = parseInt(result.rows[0].count);
    const remaining = Math.max(0, limitPerHour - sentInLastHour);
    const isAllowed = sentInLastHour < limitPerHour;

    return {
      isAllowed,
      sentInLastHour,
      remaining,
      limit: limitPerHour
    };
  }

  /**
   * Get delivery status for a message
   * @param {string} messageSid - Twilio message SID
   * @returns {Object} Twilio message object
   */
  static async getMessageStatus(messageSid) {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const message = await twilioClient.messages(messageSid).fetch();
      return message;
    } catch (error) {
      console.error('❌ Error fetching message status:', error.message);
      return null;
    }
  }

  /**
   * Check if contact is opted out
   * @param {string} contactId - UUID of contact
   * @returns {boolean}
   */
  static async isOptedOut(contactId) {
    const { db } = require('../models/index');

    const result = await db.query(
      `SELECT id FROM sms_optouts WHERE contact_id = $1`,
      [contactId]
    );

    return result.rows.length > 0;
  }
}

module.exports = TwilioService;
