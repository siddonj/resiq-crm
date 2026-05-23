// server/src/services/emailCampaignService.js
// Business logic for email campaigns: creation, sending, tracking

const { db, sql } = require('../db');
const GmailService = require('./gmail');
const { logger } = require('../utils/logger');
const { emailCampaignQueue } = require('../workers/emailCampaignWorker');

const TRACKING_BASE = process.env.API_URL || 'https://crm.resiq.co';
const DAILY_SEND_LIMIT = 450; // Leave buffer under Google's 500/day

class EmailCampaignService {

  // ── Templates ──────────────────────────────────────────────────────────────

  async listTemplates(userId) {
    return db.selectFrom('email_templates')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async createTemplate(userId, data) {
    const { name, subject, body_html, body_text, category } = data;
    return db.insertInto('email_templates')
      .values({ user_id: userId, name, subject, body_html, body_text: body_text || null, category: category || 'general' })
      .returningAll()
      .executeTakeFirst();
  }

  async updateTemplate(templateId, userId, data) {
    const { name, subject, body_html, body_text, category } = data;
    return db.updateTable('email_templates')
      .set({ name, subject, body_html, body_text, category, updated_at: new Date() })
      .where('id', '=', templateId)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirst();
  }

  // ── Campaigns ──────────────────────────────────────────────────────────────

  async listCampaigns(userId) {
    return db.selectFrom('email_campaigns')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async getCampaign(campaignId, userId) {
    const campaign = await db.selectFrom('email_campaigns')
      .selectAll()
      .where('id', '=', campaignId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!campaign) return null;

    // Attach template if set
    let template = null;
    if (campaign.template_id) {
      template = await db.selectFrom('email_templates')
        .selectAll()
        .where('id', '=', campaign.template_id)
        .executeTakeFirst();
    }

    // Attach recipient counts
    const stats = await db.selectFrom('campaign_recipients')
      .select([
        db.fn.count('id').as('total'),
        db.fn.sum(sql`CASE WHEN status = 'sent' THEN 1 ELSE 0 END`).as('sent'),
        db.fn.sum(sql`CASE WHEN status = 'failed' THEN 1 ELSE 0 END`).as('failed'),
        db.fn.sum(sql`CASE WHEN status IN ('opened','clicked') THEN 1 ELSE 0 END`).as('opened'),
        db.fn.sum(sql`CASE WHEN status = 'clicked' THEN 1 ELSE 0 END`).as('clicked'),
      ])
      .where('campaign_id', '=', campaignId)
      .executeTakeFirst();

    return { ...campaign, template, stats };
  }

  async createCampaign(userId, data) {
    const { name, template_id, schedule_at, segment_filter } = data;

    const campaign = await db.insertInto('email_campaigns')
      .values({
        user_id: userId,
        name,
        template_id: template_id || null,
        schedule_at: schedule_at || null,
        segment_filter: segment_filter ? JSON.stringify(segment_filter) : null,
        status: schedule_at ? 'scheduled' : 'draft',
      })
      .returningAll()
      .executeTakeFirst();

    // If segment filter provided, resolve recipients immediately
    if (segment_filter) {
      await this.refreshRecipients(campaign.id, userId, segment_filter);
    }

    return campaign;
  }

  async updateCampaign(campaignId, userId, data) {
    const { name, template_id, schedule_at, segment_filter, status } = data;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (template_id !== undefined) updateData.template_id = template_id;
    if (schedule_at !== undefined) updateData.schedule_at = schedule_at;
    if (segment_filter !== undefined) updateData.segment_filter = JSON.stringify(segment_filter);
    if (status !== undefined) updateData.status = status;
    updateData.updated_at = new Date();

    const result = await db.updateTable('email_campaigns')
      .set(updateData)
      .where('id', '=', campaignId)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirst();

    // Re-resolve recipients if segment changed
    if (segment_filter && result) {
      await this.refreshRecipients(campaignId, userId, segment_filter);
    }

    return result;
  }

  async deleteCampaign(campaignId, userId) {
    await db.deleteFrom('email_campaigns')
      .where('id', '=', campaignId)
      .where('user_id', '=', userId)
      .execute();
  }

  // ── Recipients ─────────────────────────────────────────────────────────────

  async refreshRecipients(campaignId, userId, segmentFilter) {
    // Clear existing recipients
    await db.deleteFrom('campaign_recipients')
      .where('campaign_id', '=', campaignId)
      .execute();

    // Find matching contacts
    const contacts = await this.resolveSegment(userId, segmentFilter);

    if (contacts.length === 0) {
      await db.updateTable('email_campaigns')
        .set({ total_recipients: 0, updated_at: new Date() })
        .where('id', '=', campaignId)
        .execute();
      return [];
    }

    // Batch insert recipients
    const values = contacts.map(c => ({
      campaign_id: campaignId,
      contact_id: c.id,
      email: c.email,
      status: 'pending',
      tracking_id: require('crypto').randomUUID(),
    }));

    // Insert in batches of 100
    for (let i = 0; i < values.length; i += 100) {
      const batch = values.slice(i, i + 100);
      await db.insertInto('campaign_recipients')
        .values(batch)
        .execute();
    }

    // Update total count
    await db.updateTable('email_campaigns')
      .set({ total_recipients: contacts.length, updated_at: new Date() })
      .where('id', '=', campaignId)
      .execute();

    return contacts;
  }

  async resolveSegment(userId, filter) {
    let query = db.selectFrom('contacts')
      .select(['id', 'email', 'name', 'company'])
      .where('user_id', '=', userId)
      .where('email', 'is not', null)
      .where('unsubscribed', 'is', null); // Skip unsubscribed

    if (!filter) return query.execute();

    if (filter.types && filter.types.length > 0) {
      query = query.where('type', 'in', filter.types);
    }

    if (filter.tags && filter.tags.length > 0) {
      query = query.innerJoin('contact_tags', 'contact_tags.contact_id', 'contacts.id')
        .innerJoin('tags', 'tags.id', 'contact_tags.tag_id')
        .where('tags.name', 'in', filter.tags);
    }

    if (filter.service_lines && filter.service_lines.length > 0) {
      query = query.where('service_line', 'in', filter.service_lines);
    }

    if (filter.search) {
      query = query.where(sql`(contacts.name ILIKE ${'%' + filter.search + '%'} OR contacts.email ILIKE ${'%' + filter.search + '%'})`);
    }

    return query.execute();
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  async sendCampaign(campaignId, userId) {
    const campaign = await this.getCampaign(campaignId, userId);
    if (!campaign) throw new Error('Campaign not found');
    if (campaign.status === 'sent') throw new Error('Campaign already sent');

    // Get template
    let template = campaign.template;
    if (!template) {
      template = await db.selectFrom('email_templates')
        .where('id', '=', campaign.template_id)
        .executeTakeFirst();
    }
    if (!template) throw new Error('No template set for campaign');

    // Mark campaign as sending
    await db.updateTable('email_campaigns')
      .set({ status: 'sending', updated_at: new Date() })
      .where('id', '=', campaignId)
      .execute();

    // Get pending recipients
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

    // Queue the send via Bull worker for throttled delivery
    const job = await emailCampaignQueue.add({
      campaignId,
      userId,
      template,
      recipients,
    }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
    });

    return { queued: true, jobId: job.id, recipients: recipients.length };
  }

  async scheduleCampaign(campaignId, userId, scheduleAt) {
    await db.updateTable('email_campaigns')
      .set({ schedule_at: scheduleAt, status: 'scheduled', updated_at: new Date() })
      .where('id', '=', campaignId)
      .where('user_id', '=', userId)
      .execute();

    // Add to Bull queue with delay
    const delay = new Date(scheduleAt).getTime() - Date.now();
    if (delay > 0) {
      await emailCampaignQueue.add(
        { campaignId, userId },
        { delay, jobId: `scheduled-${campaignId}`, attempts: 1 }
      );
    }
  }

  async pauseCampaign(campaignId, userId) {
    await db.updateTable('email_campaigns')
      .set({ status: 'paused', updated_at: new Date() })
      .where('id', '=', campaignId)
      .where('user_id', '=', userId)
      .execute();
  }

  // ── Tracking ───────────────────────────────────────────────────────────────

  /**
   * Generate the HTML body for a campaign email, injecting tracking pixel
   * and wrapping links with click tracking.
   */
  buildEmailBody(htmlBody, recipient, campaignId) {
    const trackingId = recipient.tracking_id;
    const pixelUrl = `${TRACKING_BASE}/api/track/c/${campaignId}/${trackingId}.png`;

    // Append tracking pixel
    let body = htmlBody;
    body += `\n<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />`;

    // Add unsubscribe link
    const unsubscribeUrl = `${TRACKING_BASE}/api/track/unsubscribe?rid=${trackingId}&cid=${campaignId}`;
    body += `\n<p style="font-size:11px;color:#999;">If you'd prefer not to receive these emails, <a href="${unsubscribeUrl}">unsubscribe here</a>.</p>`;

    return body;
  }

  async processSends(campaignId, userId, template, recipients) {
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        // Build personalized email body
        const personalizedSubject = template.subject
          .replace(/\{\{contact\.name\}\}/g, recipient.contact_name || 'there')
          .replace(/\{\{contact\.company\}\}/g, recipient.contact_company || '');

        let htmlBody = template.body_html
          .replace(/\{\{contact\.name\}\}/g, recipient.contact_name || 'there')
          .replace(/\{\{contact\.company\}\}/g, recipient.contact_company || '');

        htmlBody = this.buildEmailBody(htmlBody, recipient, campaignId);

        await GmailService.sendEmail(userId, recipient.email, personalizedSubject, htmlBody);

        // Mark as sent
        await db.updateTable('campaign_recipients')
          .set({ status: 'sent', sent_at: new Date() })
          .where('id', '=', recipient.id)
          .execute();

        sent++;

        // Update campaign sent count
        await db.updateTable('email_campaigns')
          .set({ sent_count: sql`sent_count + 1`, updated_at: new Date() })
          .where('id', '=', campaignId)
          .execute();

      } catch (err) {
        logger.error({ err, recipientId: recipient.id, email: recipient.email }, 'Campaign send failed');

        await db.updateTable('campaign_recipients')
          .set({ status: 'failed', error: err.message, updated_at: new Date() })
          .where('id', '=', recipient.id)
          .execute();

        failed++;
      }
    }

    return { sent, failed };
  }
}

module.exports = new EmailCampaignService();
