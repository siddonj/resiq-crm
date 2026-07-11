/**
 * SMS Model
 * Handles all SMS message operations and queries
 */

const db = require('./db');

class SMS {
  /**
   * Create an outbound SMS message
   * @param {Object} options - { contactId, organizationId, employeeId, content, phoneFrom, phoneTo, templateId }
   * @returns {Object} Created message
   */
  static async send(options) {
    const {
      contactId,
      organizationId,
      employeeId,
      content,
      phoneFrom,
      phoneTo,
      templateId = null
    } = options;

    if (!contactId || !content || !phoneFrom || !phoneTo) {
      throw new Error('Missing required fields: contactId, content, phoneFrom, phoneTo');
    }

    if (!organizationId) {
      throw new Error('SMS.send: organizationId is required');
    }

    const result = await db.query(
      `INSERT INTO sms_messages
       (contact_id, employee_id, direction, content, phone_from, phone_to, status, organization_id)
       VALUES ($1, $2, 'outbound', $3, $4, $5, 'pending', $6)
       RETURNING *`,
      [contactId, employeeId, content, phoneFrom, phoneTo, organizationId]
    );

    return result.rows[0];
  }

  /**
   * Create an inbound SMS message (from webhook)
   * @param {Object} options - { contactId, organizationId, content, phoneFrom, phoneTo, twilioMessageSid }
   * @returns {Object} Created message
   */
  static async receive(options) {
    const {
      contactId,
      organizationId,
      content,
      phoneFrom,
      phoneTo,
      twilioMessageSid
    } = options;

    if (!contactId || !content || !phoneFrom || !phoneTo || !twilioMessageSid) {
      throw new Error(
        'Missing required fields: contactId, content, phoneFrom, phoneTo, twilioMessageSid'
      );
    }

    if (!organizationId) {
      throw new Error('SMS.receive: organizationId is required');
    }

    const result = await db.query(
      `INSERT INTO sms_messages
       (contact_id, direction, content, phone_from, phone_to, status, twilio_message_sid, organization_id)
       VALUES ($1, 'inbound', $2, $3, $4, 'delivered', $5, $6)
       RETURNING *`,
      [contactId, content, phoneFrom, phoneTo, twilioMessageSid, organizationId]
    );

    return result.rows[0];
  }

  /**
   * Update message status
   * @param {string} messageId - UUID of message
   * @param {string} status - 'sent', 'delivered', 'failed', 'read'
   * @param {string} errorMessage - Optional error description
   * @returns {Object} Updated message
   */
  static async updateStatus(messageId, status, errorMessage = null) {
    if (!['sent', 'delivered', 'failed', 'read'].includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const deliveryTime = ['sent', 'delivered', 'read'].includes(status) ? 'NOW()' : null;

    const result = await db.query(
      `UPDATE sms_messages 
       SET status = $1, error_message = $2, delivery_time = COALESCE(delivery_time, ${deliveryTime})
       WHERE id = $3
       RETURNING *`,
      [status, errorMessage, messageId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Message not found: ${messageId}`);
    }

    return result.rows[0];
  }

  /**
   * Update Twilio SID for a pending message
   * @param {string} messageId - UUID of message
   * @param {string} twilioMessageSid - Twilio SID
   * @returns {Object} Updated message
   */
  static async updateTwilioSid(messageId, twilioMessageSid) {
    const result = await db.query(
      `UPDATE sms_messages 
       SET twilio_message_sid = $1, status = 'sent'
       WHERE id = $2
       RETURNING *`,
      [twilioMessageSid, messageId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Message not found: ${messageId}`);
    }

    return result.rows[0];
  }

  /**
   * Get SMS history for a contact (paginated)
   * @param {string} contactId - UUID of contact
   * @param {string} organizationId - UUID of the caller's organization
   * @param {number} limit - Records per page (default 50)
   * @param {number} offset - Pagination offset (default 0)
   * @returns {Array} SMS messages
   */
  static async queryByContact(contactId, organizationId, limit = 50, offset = 0) {
    if (!organizationId) {
      throw new Error('SMS.queryByContact: organizationId is required');
    }

    const result = await db.query(
      `SELECT * FROM sms_messages
       WHERE contact_id = $1 AND organization_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [contactId, organizationId, limit, offset]
    );

    return result.rows;
  }

  /**
   * Get SMS history for a contact with count
   * @param {string} contactId - UUID of contact
   * @param {string} organizationId - UUID of the caller's organization
   * @param {number} limit - Records per page (default 50)
   * @param {number} offset - Pagination offset (default 0)
   * @returns {Object} { messages, total }
   */
  static async queryByContactWithCount(contactId, organizationId, limit = 50, offset = 0) {
    const messages = await this.queryByContact(contactId, organizationId, limit, offset);

    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM sms_messages WHERE contact_id = $1 AND organization_id = $2`,
      [contactId, organizationId]
    );

    return {
      messages,
      total: parseInt(countResult.rows[0].total)
    };
  }

  /**
   * Get all SMS by employee
   * @param {string} employeeId - UUID of employee
   * @param {number} limit - Records per page (default 50)
   * @param {number} offset - Pagination offset (default 0)
   * @returns {Array} SMS messages
   */
  static async queryByEmployee(employeeId, limit = 50, offset = 0) {
    const result = await db.query(
      `SELECT * FROM sms_messages 
       WHERE employee_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [employeeId, limit, offset]
    );

    return result.rows;
  }

  /**
   * Get SMS by status
   * @param {string} status - 'pending', 'sent', 'delivered', 'failed', 'read'
   * @param {number} limit - Records per page (default 100)
   * @returns {Array} SMS messages
   */
  static async queryByStatus(status, limit = 100) {
    if (!['pending', 'sent', 'delivered', 'failed', 'read'].includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const result = await db.query(
      `SELECT * FROM sms_messages 
       WHERE status = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [status, limit]
    );

    return result.rows;
  }

  /**
   * Get a single message by ID
   * @param {string} messageId - UUID of message
   * @param {string} organizationId - UUID of the caller's organization
   * @returns {Object} Message
   */
  static async getById(messageId, organizationId) {
    if (!organizationId) {
      throw new Error('SMS.getById: organizationId is required');
    }

    const result = await db.query(
      `SELECT * FROM sms_messages WHERE id = $1 AND organization_id = $2`,
      [messageId, organizationId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Message not found: ${messageId}`);
    }

    return result.rows[0];
  }

  /**
   * Get message by Twilio SID
   * @param {string} twilioMessageSid - Twilio message SID
   * @returns {Object} Message or null
   */
  static async getByTwilioSid(twilioMessageSid) {
    const result = await db.query(
      `SELECT * FROM sms_messages WHERE twilio_message_sid = $1`,
      [twilioMessageSid]
    );

    return result.rows[0] || null;
  }

  /**
   * Delete a message
   * @param {string} messageId - UUID of message
   * @param {string} organizationId - UUID of the caller's organization
   * @returns {boolean} Success
   */
  static async delete(messageId, organizationId) {
    if (!organizationId) {
      throw new Error('SMS.delete: organizationId is required');
    }

    const result = await db.query(
      `DELETE FROM sms_messages WHERE id = $1 AND organization_id = $2`,
      [messageId, organizationId]
    );

    return result.rowCount > 0;
  }

  /**
   * Get count of SMS by status for a contact
   * @param {string} contactId - UUID of contact
   * @returns {Object} { pending, sent, delivered, failed, read }
   */
  static async getStatusCountByContact(contactId) {
    const result = await db.query(
      `SELECT status, COUNT(*) as count
       FROM sms_messages
       WHERE contact_id = $1
       GROUP BY status`,
      [contactId]
    );

    const counts = {
      pending: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      read: 0
    };

    result.rows.forEach(row => {
      counts[row.status] = parseInt(row.count);
    });

    return counts;
  }

  /**
   * Get recent SMS activity (last N messages across all contacts)
   * @param {number} limit - Number of messages (default 100)
   * @returns {Array} SMS messages with contact info
   */
  static async getRecentActivity(limit = 100) {
    const result = await db.query(
      `SELECT m.*, c.name as contact_name, c.email as contact_email
       FROM sms_messages m
       JOIN contacts c ON m.contact_id = c.id
       ORDER BY m.created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  }
}

module.exports = SMS;
