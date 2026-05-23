const express = require('express');
const router = express.Router();
const { db, sql } = require('../db');
const auth = require('../middleware/auth');
const GmailService = require('../services/gmail');

/**
 * GET /api/extension/me
 * Used by the extension to verify auth and get user info
 */
router.get('/me', auth, (req, res) => {
  res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
  });
});

/**
 * GET /api/extension/lookup?email=xxx
 * Look up a contact by email address. Returns contact + deals + recent emails.
 */
router.get('/lookup', auth, async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email query param required' });

  try {
    // Find contact by email
    const contact = await db.selectFrom('contacts')
      .selectAll()
      .where('email', '=', email)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!contact) {
      return res.json({ found: false, email });
    }

    // Get related deals
    const deals = await db.selectFrom('deals')
      .selectAll()
      .where('contact_id', '=', contact.id)
      .execute();

    // Get recent emails
    const recentEmails = await db.selectFrom('emails')
      .selectAll()
      .where('contact_id', '=', contact.id)
      .orderBy('date', 'desc')
      .limit(10)
      .execute();

    // Get recent activities
    const recentActivities = await db.selectFrom('activities')
      .selectAll()
      .where('contact_id', '=', contact.id)
      .orderBy('created_at', 'desc')
      .limit(10)
      .execute();

    // Get tags
    const tags = await db.selectFrom('contact_tags')
      .innerJoin('tags', 'tags.id', 'contact_tags.tag_id')
      .select(['tags.id', 'tags.name'])
      .where('contact_tags.contact_id', '=', contact.id)
      .execute();

    res.json({
      found: true,
      contact: {
        ...contact,
        tags: tags.map(t => t.name),
      },
      deals,
      recentEmails,
      recentActivities,
    });
  } catch (err) {
    console.error('Extension lookup error:', err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

/**
 * POST /api/extension/contacts
 * Quick-create a contact from an email sender.
 * Body: { email, name, company?, phone?, source? }
 */
router.post('/contacts', auth, async (req, res) => {
  const { email, name, company, phone, source } = req.body;
  if (!email || !name) {
    return res.status(400).json({ error: 'email and name required' });
  }

  try {
    // Check if contact already exists
    const existing = await db.selectFrom('contacts')
      .select('id')
      .where('email', '=', email)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (existing) {
      return res.json({ created: false, id: existing.id, message: 'Contact already exists' });
    }

    const result = await db.insertInto('contacts')
      .values({
        user_id: req.user.id,
        email,
        name,
        company: company || null,
        phone: phone || null,
        source: source || 'gmail-extension',
        type: 'prospect',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirst();

    // Log activity
    await db.insertInto('activities')
      .values({
        user_id: req.user.id,
        contact_id: result.id,
        type: 'note',
        description: `Contact created via Gmail extension (${source || 'manual'})`,
        created_at: new Date(),
      })
      .execute();

    res.json({ created: true, id: result.id });
  } catch (err) {
    console.error('Extension create contact error:', err);
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

/**
 * POST /api/extension/emails/log
 * Log an email to a contact's timeline.
 * Body: { contactId, subject, body, from, to, date, gmailMessageId, direction? }
 */
router.post('/emails/log', auth, async (req, res) => {
  const { contactId, subject, body, from, to, date, gmailMessageId, direction } = req.body;
  if (!contactId || !subject) {
    return res.status(400).json({ error: 'contactId and subject required' });
  }

  try {
    // Verify contact belongs to user
    const contact = await db.selectFrom('contacts')
      .select('id')
      .where('id', '=', contactId)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Upsert email into emails table
    const result = await db.insertInto('emails')
      .values({
        user_id: req.user.id,
        contact_id: contactId,
        subject: subject,
        body: body || '',
        sender: from || '',
        recipient: to || '',
        date: date ? new Date(date) : new Date(),
        gmail_id: gmailMessageId || null,
        direction: direction || 'inbound',
        created_at: new Date(),
      })
      .onConflict(c => c
        .column('gmail_id')
        .doNothing()
      )
      .returning('id')
      .executeTakeFirst();

    // Also log as activity
    await db.insertInto('activities')
      .values({
        user_id: req.user.id,
        contact_id: contactId,
        type: 'email',
        description: `${direction === 'outbound' ? 'Sent' : 'Received'} email: ${subject}`,
        metadata: JSON.stringify({ gmailMessageId, subject }),
        created_at: new Date(),
      })
      .execute();

    res.json({ logged: true, id: result?.id });
  } catch (err) {
    console.error('Extension log email error:', err);
    res.status(500).json({ error: 'Failed to log email' });
  }
});

module.exports = router;
