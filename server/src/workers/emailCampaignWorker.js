// server/src/workers/emailCampaignWorker.js
// Bull worker that processes campaign email sends with rate limiting

const Queue = require('bull');
const GmailService = require('../services/gmail');
const { db, sql } = require('../db');
const { logger } = require('../utils/logger');
const EmailCampaignService = require('../services/emailCampaignService');

const CAMPAIGN_QUEUE_NAME = 'email-campaign';

const emailCampaignQueue = new Queue(CAMPAIGN_QUEUE_NAME, process.env.REDIS_URL || 'redis://localhost:6379', {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: true,
  },
});

// Rate limit: max 50 sends per hour per user (well under Google's 500/day)
const userRateLimiters = new Map();

function getRateLimiter(userId) {
  if (!userRateLimiters.has(userId)) {
    userRateLimiters.set(userId, { count: 0, resetAt: Date.now() + 3600000 });
  }
  return userRateLimiters.get(userId);
}

function checkRateLimit(userId) {
  const limiter = getRateLimiter(userId);
  if (Date.now() > limiter.resetAt) {
    limiter.count = 0;
    limiter.resetAt = Date.now() + 3600000;
  }
  if (limiter.count >= 50) return false;
  limiter.count++;
  return true;
}

function initEmailCampaignWorker() {
  emailCampaignQueue.process(async (job) => {
    const { campaignId, userId, template, recipients } = job.data;

    if (campaignId && !recipients) {
      // Scheduled/polling job — fetch pending recipients
      return processScheduledCampaign(campaignId, userId);
    }

    // Direct send job with recipients
    return processCampaignSend(campaignId, userId, template, recipients);
  });

  // Poll for scheduled campaigns every minute
  setInterval(pollScheduledCampaigns, 60 * 1000);

  logger.info({ queue: CAMPAIGN_QUEUE_NAME }, 'Email campaign worker initialized');
}

async function pollScheduledCampaigns() {
  try {
    const now = new Date();
    const campaigns = await db.selectFrom('email_campaigns')
      .select(['id', 'user_id'])
      .where('status', '=', 'scheduled')
      .where('schedule_at', '<=', now)
      .execute();

    for (const campaign of campaigns) {
      logger.info({ campaignId: campaign.id }, 'Picking up scheduled campaign');
      await emailCampaignQueue.add(
        { campaignId: campaign.id, userId: campaign.user_id },
        { jobId: `send-${campaign.id}`, removeOnComplete: true }
      );
    }
  } catch (err) {
    logger.error({ err }, 'Poll scheduled campaigns failed');
  }
}

async function processScheduledCampaign(campaignId, userId) {
  const campaign = await EmailCampaignService.getCampaign(campaignId, userId);
  if (!campaign || campaign.status === 'sent' || campaign.status === 'cancelled') {
    return { skipped: true, reason: 'Campaign not active' };
  }

  if (!campaign.template) {
    await db.updateTable('email_campaigns')
      .set({ status: 'draft', updated_at: new Date() })
      .where('id', '=', campaignId)
      .execute();
    return { skipped: true, reason: 'No template' };
  }

  const recipients = await db.selectFrom('campaign_recipients')
    .selectAll()
    .where('campaign_id', '=', campaignId)
    .where('status', '=', 'pending')
    .execute();

  if (recipients.length === 0) {
    await db.updateTable('email_campaigns')
      .set({ status: 'sent', sent_at: new Date(), updated_at: new Date() })
      .where('id', '=', campaignId)
      .execute();
    return { sent: 0 };
  }

  return processCampaignSend(campaignId, userId, campaign.template, recipients);
}

async function processCampaignSend(campaignId, userId, template, recipients) {
  logger.info({ campaignId, recipientCount: recipients.length }, 'Processing campaign send');

  await db.updateTable('email_campaigns')
    .set({ status: 'sending', updated_at: new Date() })
    .where('id', '=', campaignId)
    .execute();

  // Fetch contact names for personalization
  const contactIds = recipients.map(r => r.contact_id);
  const contacts = contactIds.length > 0
    ? await db.selectFrom('contacts')
        .select(['id', 'name', 'company'])
        .where('id', 'in', contactIds)
        .execute()
    : [];

  const contactMap = {};
  for (const c of contacts) {
    contactMap[c.id] = c;
  }

  // Enrich recipients with contact data
  const enrichedRecipients = recipients.map(r => ({
    ...r,
    contact_name: contactMap[r.contact_id]?.name || r.email.split('@')[0],
    contact_company: contactMap[r.contact_id]?.company || '',
  }));

  // Process in batches with rate limiting
  let sent = 0;
  let failed = 0;

  for (const recipient of enrichedRecipients) {
    // Check rate limit
    if (!checkRateLimit(userId)) {
      logger.info({ userId }, 'Rate limit hit, pausing campaign send');
      // Queue remaining for later (1 hour)
      const remaining = enrichedRecipients.filter(r => !r.sent_at);
      if (remaining.length > 0) {
        await emailCampaignQueue.add(
          { campaignId, userId, template, recipients: remaining },
          { delay: 3600000, attempts: 3 }
        );
      }
      break;
    }

    try {
      const personalizedSubject = template.subject
        .replace(/\{\{contact\.name\}\}/g, recipient.contact_name)
        .replace(/\{\{contact\.company\}\}/g, recipient.contact_company || '');

      let htmlBody = template.body_html
        .replace(/\{\{contact\.name\}\}/g, recipient.contact_name)
        .replace(/\{\{contact\.company\}\}/g, recipient.contact_company || '');

      htmlBody = EmailCampaignService.buildEmailBody(htmlBody, recipient, campaignId);

      await GmailService.sendEmail(userId, recipient.email, personalizedSubject, htmlBody);

      await db.updateTable('campaign_recipients')
        .set({ status: 'sent', sent_at: new Date() })
        .where('id', '=', recipient.id)
        .execute();

      sent++;

      await db.updateTable('email_campaigns')
        .set({ sent_count: sql`sent_count + 1`, updated_at: new Date() })
        .where('id', '=', campaignId)
        .execute();

      // Small delay between sends to avoid hitting Gmail limits
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (err) {
      logger.error({ err, email: recipient.email }, 'Campaign send failed for recipient');

      await db.updateTable('campaign_recipients')
        .set({ status: 'failed', error: err.message })
        .where('id', '=', recipient.id)
        .execute();

      failed++;
    }
  }

  // Check if campaign is fully sent
  const remaining = await db.selectFrom('campaign_recipients')
    .select(db.fn.count('id').as('count'))
    .where('campaign_id', '=', campaignId)
    .where('status', '=', 'pending')
    .executeTakeFirst();

  if (!remaining || Number(remaining.count) === 0) {
    await db.updateTable('email_campaigns')
      .set({ status: 'sent', sent_at: new Date(), updated_at: new Date() })
      .where('id', '=', campaignId)
      .execute();
  }

  return { sent, failed };
}

module.exports = { emailCampaignQueue, initEmailCampaignWorker };
