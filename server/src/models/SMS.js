/**
 * SMS Model
 * Handles all SMS message operations and queries
 */

const { db } = require('./index');

class SMS {
  /**
   * Create an outbound SMS message
   * @param {Object} options - { contactId, employeeId, content, phoneFrom, phoneTo, templateId }
   * @returns {Object} Created message
   */
  static async send(options) {
    const {
      contactId,
      employeeId,
      content,
      phoneFrom,
      phoneTo,
      templateId = null
    } = options;

    if (!contactId || !content || !phoneFrom || !phoneTo) {
      throw new Error('Missing required fields: contactId, content, phoneFrom, phoneTo');
    }

    const result = await db.query(
      `INSERT INTO sms_messages 
       (contact_id, employee_id, direction, content, phone_from, phone_to, status)
       VALUES ($1, $2, 'outbound', $3, $4, $5, 'pending')
       RETURNING *`,
      [contactId, employeeId, content, phoneFrom, phoneTo]
    );

    return result.rows[0];
  }

  /**
   * Create an inbound SMS message (from webhook)
   * @param {Object} options - { contactId, content, phoneFrom, phoneTo, twilioMessageSid }
   * @returns {Object} Created message
   */
  static async receive(options) {
    const {
      contactId,
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

    const result = await db.query(
      `INSERT INTO sms_messages 
       (contact_id, direction, content, phone_from, phone_to, status, twilio_message_sid)
       VALUES ($1, 'inbound', $2, $3, $4, 'delivered', $5)
       RETURNING *`,
      [contactId, content, phoneFrom, phoneTo, twilioMessageSid]
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
   * @param {number} limit - Records per page (default 50)
   * @param {number} offset - Pagination offset (default 0)
   * @returns {Array} SMS messages
   */
  static async queryByContact(contactId, limit = 50, offset = 0) {
    const result = await db.query(
      `SELECT * FROM sms_messages 
       WHERE contact_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [contactId, limit, offset]
    );

    return result.rows;
  }

  /**
   * Get SMS history for a contact with count
   * @param {string} contactId - UUID of contact
   * @param {number} limit - Records per page (default 50)
   * @param {number} offset - Pagination offset (default 0)
   * @returns {Object} { messages, total }
   */
  static async queryByContactWithCount(contactId, limit = 50, offset = 0) {
    const messages = await this.queryByContact(contactId, limit, offset);

    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM sms_messages WHERE contact_id = $1`,
      [contactId]
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
   * @returns {Object} Message
   */
  static async getById(messageId) {
    const result = await db.query(
      `SELECT * FROM sms_messages WHERE id = $1`,
      [messageId]
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
   * @returns {boolean} Success
   */
  static async delete(messageId) {
    const result = await db.query(
      `DELETE FROM sms_messages WHERE id = $1`,
      [messageId]
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
