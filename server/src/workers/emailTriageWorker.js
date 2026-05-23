// server/src/workers/emailTriageWorker.js
// Periodically scans Gmail inbox for connected users, auto-creates contacts
// from unknown senders, and surfaces actionable emails.

const Queue = require('bull');
const GmailService = require('../services/gmail');
const { db, sql } = require('../db');
const { logger } = require('../utils/logger');

const TRIAGE_QUEUE_NAME = 'email-triage';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const emailTriageQueue = new Queue(TRIAGE_QUEUE_NAME, process.env.REDIS_URL || 'redis://localhost:6379', {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
  },
});

function initEmailTriageWorker() {
  emailTriageQueue.process(async (job) => {
    const { userId } = job.data;
    return triageInbox(userId);
  });

  // Schedule recurring triage for all connected users
  scheduleTriage();
  logger.info({ queue: TRIAGE_QUEUE_NAME }, 'Email triage worker initialized');
}

async function scheduleTriage() {
  try {
    const users = await db.selectFrom('users')
      .select(['id'])
      .where('oauth_provider', '=', 'gmail')
      .where('oauth_access_token', 'is not', null)
      .execute();

    if (users.length === 0) {
      logger.info('No Gmail-connected users found for triage scheduling');
      return;
    }

    for (const user of users) {
      const jobs = await emailTriageQueue.getRepeatableJobs();
      const existing = jobs.find(j =>
        j.id === `triage-${user.id}` &&
        j.name === TRIAGE_QUEUE_NAME
      );
      if (existing) {
        await emailTriageQueue.removeRepeatableByKey(existing.key);
      }

      await emailTriageQueue.add(
        { userId: user.id },
        {
          repeat: { every: POLL_INTERVAL_MS },
          jobId: `triage-${user.id}`,
        }
      );
      logger.info({ userId: user.id, interval: POLL_INTERVAL_MS }, 'Triage scheduled');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to schedule triage jobs');
  }
}

async function triageInbox(userId) {
  logger.info({ userId }, 'Starting email triage');

  try {
    // Fetch recent unread inbox emails (excluding promotional/social)
    const { messages } = await GmailService.fetchEmails(userId, {
      maxResults: 20,
      query: 'in:inbox is:unread -category:promotional -category:social',
    });

    if (!messages || messages.length === 0) {
      logger.info({ userId }, 'No actionable emails found for triage');
      return { triaged: 0, contactsCreated: 0 };
    }

    let triaged = 0;
    let contactsCreated = 0;

    for (const msg of messages) {
      const senderEmail = extractEmail(msg.from);
      if (!senderEmail) continue;

      // Check if sender is already a contact
      const contact = await db.selectFrom('contacts')
        .select(['id', 'name', 'email'])
        .where('email', '=', senderEmail)
        .where('user_id', '=', userId)
        .executeTakeFirst();

      if (!contact) {
        // Auto-create contact from unknown sender
        const senderName = extractName(msg.from) || senderEmail.split('@')[0];
        const result = await db.insertInto('contacts')
          .values({
            user_id: userId,
            email: senderEmail,
            name: senderName,
            source: 'email-triage',
            type: 'lead',
            created_at: new Date(),
            updated_at: new Date(),
          })
          .returning('id')
          .executeTakeFirst();

        // Log activity for the new contact
        await db.insertInto('activities')
          .values({
            user_id: userId,
            contact_id: result.id,
            type: 'note',
            description: `Auto-created from triaged email: "${msg.subject}"`,
            created_at: new Date(),
          })
          .execute();

        logger.info(
          { userId, email: senderEmail, contactId: result.id, subject: msg.subject },
          'Auto-created contact from triaged email'
        );
        contactsCreated++;
      }

      triaged++;
    }

    logger.info({ userId, triaged, contactsCreated }, 'Email triage completed');
    return { triaged, contactsCreated };
  } catch (err) {
    logger.error({ err, userId }, 'Email triage failed');
    throw err;
  }
}

function extractEmail(fromStr) {
  if (!fromStr) return null;
  const match = fromStr.match(/<([^>]+@[^>]+)>/);
  return match
    ? match[1].toLowerCase()
    : fromStr.includes('@')
      ? fromStr.toLowerCase()
      : null;
}

function extractName(fromStr) {
  if (!fromStr) return null;
  // "Name <email>" or "Name" pattern
  const match = fromStr.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : null;
}

module.exports = { emailTriageQueue, initEmailTriageWorker };
