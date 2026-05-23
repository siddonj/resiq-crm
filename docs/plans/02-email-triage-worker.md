# Proactive Email Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Bull queue worker that periodically scans the CRM user's Gmail inbox, surfaces actionable emails, auto-creates contacts from unknown senders, and generates reply drafts.

**Architecture:** Extend the existing `emailSyncWorker.js` pattern — a new `emailTriageWorker.js` that runs on a cron schedule, processes unread inbox emails, and creates tasks/drafts via existing CRM APIs.

**Tech Stack:** Bull (Redis-backed queues), existing GmailService, existing contacts and outbound routes, Pino logger.

---

## Files

- **Create:** `server/src/workers/emailTriageWorker.js` — The triage worker
- **Modify:** `server/src/index.js` — Initialize the worker on startup
- **Modify:** `server/src/routes/extension.js` (already done) — `/api/extension/lookup` endpoint
- **Potential mod:** `server/src/routes/outboundAutomation.js` — New endpoint to create tasks from triage (if needed)

## Tasks

### Task 1: Create emailTriageWorker.js

- [ ] **Step 1:** Create the worker file

```javascript
// server/src/workers/emailTriageWorker.js
const Queue = require('bull');
const GmailService = require('../services/gmail');
const { db, sql } = require('../db');
const { logger } = require('../utils/logger');

const TRIAGE_QUEUE_NAME = 'email-triage';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const emailTriageQueue = new Queue(TRIAGE_QUEUE_NAME, process.env.REDIS_URL || 'redis://localhost:6379', {
  defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true },
});

function initEmailTriageWorker() {
  emailTriageQueue.process(async (job) => {
    const { userId } = job.data;
    return triageInbox(userId);
  });

  // Schedule recurring triage for connected users
  scheduleTriage();
  logger.info({ queue: TRIAGE_QUEUE_NAME }, 'Email triage worker initialized');
}

async function scheduleTriage() {
  // Find all users with Gmail connected
  const users = await db.selectFrom('oauth_tokens')
    .select(['user_id'])
    .where('provider', '=', 'gmail')
    .where('access_token', 'is not', null)
    .execute();

  for (const user of users) {
    // Add recurring job (remove any existing first)
    const jobs = await emailTriageQueue.getRepeatableJobs();
    const existing = jobs.find(j => j.data?.userId === user.user_id && j.name === 'triage');
    if (existing) await emailTriageQueue.removeRepeatableByKey(existing.key);

    await emailTriageQueue.add(
      { userId: user.user_id },
      { repeat: { every: POLL_INTERVAL_MS }, jobId: `triage-${user.user_id}` }
    );
    logger.info({ userId: user.user_id, interval: POLL_INTERVAL_MS }, 'Triage scheduled');
  }
}

async function triageInbox(userId) {
  logger.info({ userId }, 'Starting email triage');

  try {
    // Fetch recent unread inbox emails
    const { messages } = await GmailService.fetchEmails(userId, {
      maxResults: 20,
      query: 'in:inbox is:unread -category:promotional -category:social',
    });

    if (!messages || messages.length === 0) {
      logger.info({ userId }, 'No actionable emails found');
      return { triaged: 0 };
    }

    let triaged = 0;
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

        // Log activity
        await db.insertInto('activities')
          .values({
            user_id: userId,
            contact_id: result.id,
            type: 'note',
            description: `Auto-created from triaged email: "${msg.subject}"`,
            created_at: new Date(),
          })
          .execute();

        logger.info({ userId, email: senderEmail, contactId: result.id }, 'Auto-created contact from email');
      }

      // Mark email as triaged (could add a label)
      triaged++;
    }

    logger.info({ userId, triaged }, 'Email triage completed');
    return { triaged };
  } catch (err) {
    logger.error({ err, userId }, 'Email triage failed');
    throw err;
  }
}

function extractEmail(fromStr) {
  if (!fromStr) return null;
  const match = fromStr.match(/<([^>]+@[^>]+)>/);
  return match ? match[1].toLowerCase() : fromStr.includes('@') ? fromStr.toLowerCase() : null;
}

function extractName(fromStr) {
  if (!fromStr) return null;
  const match = fromStr.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : null;
}

module.exports = { emailTriageQueue, initEmailTriageWorker };
```

- [ ] **Step 2:** Add to index.js — require and init

Add after existing worker inits in `server/src/index.js`:

```javascript
const { initEmailTriageWorker } = require('./workers/emailTriageWorker');
// ... add after other init calls:
initEmailTriageWorker();
```

- [ ] **Step 3:** Verify worker starts cleanly

Check logs for `Email triage worker initialized` and `Triage scheduled` messages.

- [ ] **Step 4:** Commit

```bash
git add server/src/workers/emailTriageWorker.js server/src/index.js
git commit -m "feat: add email triage worker - auto-create contacts from Gmail inbox"
```

---

## Edge Cases & Pitfalls

1. **Rate limiting** — Gmail API has daily quotas (currently `gmail.readonly` scope). The 5-minute poll interval with max 20 messages keeps us well under limits.
2. **Duplicate contacts** — Checked by email lookup before insert.
3. **Promotional/social emails** — Query excludes `-category:promotional -category:social`.
4. **User disconnects Gmail** — Worker will fail gracefully (GmailService throws "User not connected").
5. **Empty inbox** — Handled with early return.
