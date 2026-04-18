const pool = require('./db');

const Email = {
  // Create or get existing email
  createIfNotExists: async (emailData) => {
    const { user_id, contact_id, sender_email, recipient_email, subject, body, is_outbound, gmail_id, gmail_thread_id, received_at } = emailData;

    // Check if already exists by gmail_id
    if (gmail_id) {
      const existing = await pool.query('SELECT id FROM emails WHERE gmail_id = $1', [gmail_id]);
      if (existing.rows.length > 0) {
        return existing.rows[0];
      }
    }

    const result = await pool.query(
      `INSERT INTO emails (user_id, contact_id, sender_email, recipient_email, subject, body, is_outbound, gmail_id, gmail_thread_id, received_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'synced')
       RETURNING *`,
      [user_id, contact_id, sender_email, recipient_email, subject, body, is_outbound, gmail_id, gmail_thread_id, received_at]
    );
    return result.rows[0];
  },

  // Get emails for a contact
  getByContactId: async (contact_id, limit = 50) => {
    const result = await pool.query(
      'SELECT * FROM emails WHERE contact_id = $1 ORDER BY received_at DESC LIMIT $2',
      [contact_id, limit]
    );
    return result.rows;
  },

  // Get emails for a user
  getByUserId: async (user_id, limit = 100) => {
    const result = await pool.query(
      'SELECT * FROM emails WHERE user_id = $1 ORDER BY received_at DESC LIMIT $2',
      [user_id, limit]
    );
    return result.rows;
  },

  // Get last sync timestamp for user
  getLastSyncTime: async (user_id) => {
    const result = await pool.query(
      'SELECT MAX(received_at) as last_sync FROM emails WHERE user_id = $1',
      [user_id]
    );
    return result.rows[0]?.last_sync || null;
  },

  // Find contact by email
  findContactByEmail: async (user_id, email) => {
    const result = await pool.query(
      'SELECT id FROM contacts WHERE user_id = $1 AND (email = $2 OR email ILIKE $2)',
      [user_id, email]
    );
    return result.rows[0] || null;
  },

  // Get email with enriched contact info
  getEmailsWithContact: async (user_id, contact_id) => {
    const result = await pool.query(
      `SELECT e.*, c.name as contact_name
       FROM emails e
       LEFT JOIN contacts c ON e.contact_id = c.id
       WHERE e.user_id = $1 AND e.contact_id = $2
       ORDER BY e.received_at DESC`,
      [user_id, contact_id]
    );
    return result.rows;
  },
};

module.exports = Email;
