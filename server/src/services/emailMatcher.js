const Email = require('../models/email');
const pool = require('../models/db');

class EmailMatcher {
  // Extract all email addresses from a string (handles "Name <email@example.com>")
  extractEmails(emailString) {
    if (!emailString) return [];
    // Match both "email@example.com" and "Name <email@example.com>" formats
    const regex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    return [...new Set(emailString.match(regex) || [])]; // Deduplicate
  }

  // Find contact by email (case-insensitive, exact match)
  async findContactByEmail(user_id, email) {
    if (!email) return null;

    const result = await pool.query(
      'SELECT id, name, email FROM contacts WHERE user_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1',
      [user_id, email.trim()]
    );
    return result.rows[0] || null;
  }

  // Match email to contact, or create new contact if not found
  async matchEmailToContact(user_id, fromEmail, toEmails) {
    const sender = this.extractEmails(fromEmail)[0];
    const allRecipients = [sender, ...toEmails.flatMap((e) => this.extractEmails(e))];

    console.log(`[EmailMatcher] Matching: sender=${sender}, recipients=${allRecipients}`);

    // Try to find matching contact
    for (const email of allRecipients) {
      const contact = await this.findContactByEmail(user_id, email);
      if (contact) {
        console.log(`[EmailMatcher] Found existing contact: ${contact.email}`);
        return contact;
      }
    }

    // No contact found - create new one from sender email
    if (sender) {
      try {
        // Create contact or return existing one with same email
        const contactName = sender.split('@')[0];
        const result = await pool.query(
          `INSERT INTO contacts (user_id, name, email, type)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT(user_id, email) DO UPDATE SET id=EXCLUDED.id
           RETURNING id, name, email`,
          [user_id, contactName, sender, 'prospect']
        );
        const newContact = result.rows[0];
        console.log(`[EmailMatcher] Contact: ${sender} (${newContact.id})`);
        return newContact;
      } catch (err) {
        console.error(`[EmailMatcher] Failed to create/find contact for ${sender}:`, err.message);
      }
    } else {
      console.log(`[EmailMatcher] No sender email found in: ${fromEmail}`);
    }

    return null; // Still no contact
  }

  // Process a Gmail message and create email record
  async processGmailMessage(user_id, gmailMessage) {
    const { id, threadId, from, to, cc, subject, date, body } = gmailMessage;

    console.log(`[EmailMatcher] Processing: from="${from}" | to="${to}" | subject="${subject}"`);

    // Determine if outbound (from user's email(s) - we'll check all connected user emails)
    const userTokens = await pool.query(
      'SELECT email FROM users WHERE id = $1',
      [user_id]
    );
    const userEmail = userTokens.rows[0]?.email;
    const sender = this.extractEmails(from)[0];
    const isOutbound = sender && userEmail &&
      sender.toLowerCase() === userEmail.toLowerCase();

    // Extract primary recipient email and all recipients
    const recipients = this.extractEmails(to);
    const ccRecipients = this.extractEmails(cc);
    const primaryRecipient = recipients[0] || ccRecipients[0] || null;

    // Match to contact
    const contact = await this.matchEmailToContact(user_id, isOutbound ? to : from, [cc || '']);

    // Parse date to timestamp
    const receivedAt = date ? new Date(date) : new Date();

    // Create email record
    const emailData = {
      user_id,
      contact_id: contact?.id || null,
      sender_email: sender || from,
      recipient_email: primaryRecipient || to,
      subject,
      body: body?.substring(0, 10000) || '', // Limit body size to 10k chars
      is_outbound: isOutbound,
      gmail_id: id,
      gmail_thread_id: threadId,
      received_at: receivedAt,
    };

    try {
      const email = await Email.createIfNotExists(emailData);
      console.log(`[EmailMatcher] Email saved: ${id} -> contact=${contact?.id || 'null'}`);
      return {
        success: true,
        email,
        contact,
      };
    } catch (err) {
      console.error('Error creating email record:', err);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  // Sync emails for a user
  async syncUserEmails(user_id, options = {}) {
    const { maxResults = 20, pageToken = null, labelIds = null } = options;

    const GmailService = require('./gmail');
    try {
      // Fetch emails from Gmail
      const { messages, nextPageToken } = await GmailService.fetchEmails(user_id, {
        maxResults,
        pageToken,
        labelIds, // Pass label filters to Gmail service
        query: 'newer_than:30d', // First sync: 30 days; ongoing: incremental
      });

      if (!messages.length) {
        return { success: true, count: 0, nextPageToken };
      }

      // Process each email
      const results = await Promise.all(
        messages.map((msg) => this.processGmailMessage(user_id, msg))
      );

      const successCount = results.filter((r) => r.success).length;
      const matchedContacts = results.filter((r) => r.contact).length;

      console.log(`Synced ${successCount} emails for user ${user_id}, matched ${matchedContacts} to contacts`);

      return {
        success: true,
        count: successCount,
        matched: matchedContacts,
        nextPageToken,
      };
    } catch (err) {
      console.error(`Error syncing emails for user ${user_id}:`, err);
      return {
        success: false,
        error: err.message,
      };
    }
  }
}

module.exports = new EmailMatcher();
