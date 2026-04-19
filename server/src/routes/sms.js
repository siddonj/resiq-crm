/**
 * SMS Routes
 * All SMS-related API endpoints
 */

const express = require('express');
const router = express.Router();

const authenticate = require('../middleware/auth');
const SMS = require('../models/SMS');
const SMSTemplate = require('../models/SMSTemplate');
const Client = require('../models/client');
const pool = require('../models/db');
const TwilioService = require('../services/twilioService');
const WebhookReceiverService = require('../services/webhookReceiver');
const { MessageQueueService } = require('../services/messageQueue');

// Helper to get client by ID
async function getContact(contactId) {
  try {
    return await Client.findById(contactId);
  } catch (err) {
    return null;
  }
}

// Helper to update contact
async function updateContact(contactId, updates) {
  const fields = [];
  const values = [];
  let paramCount = 1;
  
  if (updates.sms_opted_in !== undefined) {
    fields.push(`sms_opted_in = $${paramCount}`);
    values.push(updates.sms_opted_in);
    paramCount++;
  }
  if (updates.phone_number !== undefined) {
    fields.push(`phone_number = $${paramCount}`);
    values.push(updates.phone_number);
    paramCount++;
  }
  
  if (fields.length === 0) return;
  
  values.push(contactId);
  await pool.query(
    `UPDATE clients SET ${fields.join(', ')} WHERE id = $${paramCount}`,
    values
  );
}

// Helper to log activity
async function logActivity(metadata) {
  // Activity logging is optional - just warn if it fails
  try {
    const Activity = require('../models/Activity');
    if (Activity && Activity.log) {
      await logActivity(metadata);
    }
  } catch (err) {
    console.warn('Could not log activity:', err.message);
  }
}

/**
 * POST /api/sms/send
 * Send SMS to a contact
 * Body: { contactId, templateId?, variables?, content? }
 */
router.post('/send', authenticate, async (req, res) => {
  try {
    const { contactId, templateId, variables, content } = req.body;
    const userId = req.user.id;

    if (!contactId) {
      return res.status(400).json({ error: 'contactId is required' });
    }

    // Get contact
    const contact = await getContact(contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Check if contact has phone number
    if (!contact.phone_number) {
      return res.status(400).json({ error: 'Contact has no phone number' });
    }

    // Check if contact opted out
    const isOptedOut = await TwilioService.isOptedOut(contactId);
    if (isOptedOut) {
      return res.status(403).json({ error: 'Contact has opted out of SMS' });
    }

    // Check rate limit
    const rateLimit = await TwilioService.checkRateLimit(contactId);
    if (!rateLimit.isAllowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: 3600,
        sentInLastHour: rateLimit.sentInLastHour
      });
    }

    // Get SMS content
    let smsContent = content;

    if (templateId) {
      // Render from template
      const template = await SMSTemplate.getById(templateId);
      const renderResult = await SMSTemplate.render(template, variables || {});
      smsContent = renderResult.content;

      if (renderResult.warnings.length > 0) {
        console.warn(`⚠️  Template rendering warnings: ${renderResult.warnings.join(', ')}`);
      }
    }

    if (!smsContent) {
      return res.status(400).json({ error: 'SMS content is required (templateId or content)' });
    }

    if (smsContent.length > 160) {
      console.warn(`⚠️  SMS exceeds 160 characters (${smsContent.length}), will be split into multiple messages`);
    }

    // Create SMS message record (pending)
    const message = await SMS.send({
      contactId,
      employeeId: userId,
      content: smsContent,
      phoneFrom: process.env.TWILIO_PHONE_NUMBER || '+1-555-RESIQ-1',
      phoneTo: contact.phone_number,
      templateId
    });

    // Enqueue for sending
    const queueResult = await MessageQueueService.enqueueSMS({
      messageId: message.id,
      to: contact.phone_number,
      content: smsContent
    });

    if (!queueResult.success) {
      await SMS.updateStatus(message.id, 'failed', queueResult.error);
      return res.status(500).json({ error: 'Failed to queue SMS', details: queueResult.error });
    }

    // Log as activity
    await logActivity({
      userId,
      contactId,
      actionType: 'sms_sent',
      metadata: {
        messageId: message.id,
        content: smsContent.substring(0, 100),
        templateId
      }
    });

    return res.json({
      success: true,
      message: {
        id: message.id,
        status: 'pending',
        content: smsContent,
        createdAt: message.created_at
      }
    });
  } catch (error) {
    console.error('❌ SMS send error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/sms/send-batch
 * Send SMS to multiple contacts
 * Body: { contactIds: [], templateId, variables }
 */
router.post('/send-batch', authenticate, async (req, res) => {
  try {
    const { contactIds, templateId, variables } = req.body;
    const userId = req.user.id;

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ error: 'contactIds array is required' });
    }

    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required for batch send' });
    }

    const template = await SMSTemplate.getById(templateId);

    const results = {
      sent: [],
      failed: [],
      skipped: []
    };

    for (const contactId of contactIds) {
      try {
        const contact = await getContact(contactId);

        if (!contact) {
          results.skipped.push({ contactId, reason: 'Contact not found' });
          continue;
        }

        if (!contact.phone_number) {
          results.skipped.push({ contactId, reason: 'No phone number' });
          continue;
        }

        const isOptedOut = await TwilioService.isOptedOut(contactId);
        if (isOptedOut) {
          results.skipped.push({ contactId, reason: 'Opted out' });
          continue;
        }

        const rateLimit = await TwilioService.checkRateLimit(contactId);
        if (!rateLimit.isAllowed) {
          results.skipped.push({ contactId, reason: 'Rate limit exceeded' });
          continue;
        }

        // Render template with contact-specific variables
        const contactVariables = { ...variables, contactName: contact.name };
        const renderResult = await SMSTemplate.render(template, contactVariables);
        const smsContent = renderResult.content;

        // Create message
        const message = await SMS.send({
          contactId,
          employeeId: userId,
          content: smsContent,
          phoneFrom: process.env.TWILIO_PHONE_NUMBER || '+1-555-RESIQ-1',
          phoneTo: contact.phone_number,
          templateId
        });

        // Enqueue
        const queueResult = await MessageQueueService.enqueueSMS({
          messageId: message.id,
          to: contact.phone_number,
          content: smsContent
        });

        if (queueResult.success) {
          results.sent.push({ contactId, messageId: message.id });

          // Log activity
          await logActivity({
            userId,
            contactId,
            actionType: 'sms_sent',
            metadata: { messageId: message.id, templateId }
          });
        } else {
          await SMS.updateStatus(message.id, 'failed', queueResult.error);
          results.failed.push({ contactId, messageId: message.id, error: queueResult.error });
        }
      } catch (error) {
        results.failed.push({ contactId, error: error.message });
      }
    }

    return res.json({
      success: true,
      results,
      summary: {
        sent: results.sent.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
        total: contactIds.length
      }
    });
  } catch (error) {
    console.error('❌ Batch SMS error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/contacts/:id/messages
 * Get SMS history for a contact (paginated)
 */
router.get('/:contactId/history', authenticate, async (req, res) => {
  try {
    const { contactId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    // Verify contact exists
    const contact = await getContact(contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Get SMS history
    const result = await SMS.queryByContactWithCount(contactId, limit, offset);

    return res.json({
      success: true,
      messages: result.messages,
      pagination: {
        limit,
        offset,
        total: result.total,
        pages: Math.ceil(result.total / limit)
      }
    });
  } catch (error) {
    console.error('❌ SMS history error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sms/messages/:id
 * Get single SMS message details
 */
router.get('/messages/:messageId', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await SMS.getById(messageId);

    return res.json({
      success: true,
      message
    });
  } catch (error) {
    console.error('❌ Get message error:', error.message);
    res.status(error.message.includes('not found') ? 404 : 500).json({ error: error.message });
  }
});

/**
 * DELETE /api/sms/messages/:id
 * Delete SMS message (soft delete or hard delete based on status)
 */
router.delete('/messages/:messageId', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;

    const success = await SMS.delete(messageId);

    if (!success) {
      return res.status(404).json({ error: 'Message not found' });
    }

    return res.json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error) {
    console.error('❌ Delete message error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

/**
 * TEMPLATES ENDPOINTS
 */

/**
 * GET /api/sms/templates
 * List all SMS templates (default and custom)
 */
router.get('/templates', authenticate, async (req, res) => {
  try {
    const templates = await SMSTemplate.list();

    return res.json({
      success: true,
      templates,
      count: templates.length
    });
  } catch (error) {
    console.error('❌ List templates error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/sms/templates
 * Create new SMS template
 * Body: { name, slug, content, description?, variables? }
 */
router.post('/templates', authenticate, async (req, res) => {
  try {
    const { name, slug, content, description, variables } = req.body;
    const userId = req.user.id;

    if (!name || !slug || !content) {
      return res.status(400).json({ error: 'name, slug, content are required' });
    }

    // Validate template syntax
    const validation = SMSTemplate.validateSyntax(content);
    if (!validation.isValid) {
      return res.status(400).json({ error: 'Invalid template syntax', errors: validation.errors });
    }

    const template = await SMSTemplate.create({
      name,
      slug,
      content,
      description,
      variables: variables || validation.variables,
      createdBy: userId
    });

    return res.status(201).json({
      success: true,
      template
    });
  } catch (error) {
    console.error('❌ Create template error:', error.message);
    res.status(error.message.includes('already exists') ? 409 : 500).json({ error: error.message });
  }
});

/**
 * GET /api/sms/templates/:id
 * Get template by ID
 */
router.get('/templates/:templateId', authenticate, async (req, res) => {
  try {
    const { templateId } = req.params;

    const template = await SMSTemplate.getById(templateId);

    return res.json({
      success: true,
      template
    });
  } catch (error) {
    console.error('❌ Get template error:', error.message);
    res.status(error.message.includes('not found') ? 404 : 500).json({ error: error.message });
  }
});

/**
 * PATCH /api/sms/templates/:id
 * Update SMS template
 */
router.patch('/templates/:templateId', authenticate, async (req, res) => {
  try {
    const { templateId } = req.params;
    const updates = req.body;

    // Validate syntax if content is being updated
    if (updates.content) {
      const validation = SMSTemplate.validateSyntax(updates.content);
      if (!validation.isValid) {
        return res.status(400).json({ error: 'Invalid template syntax', errors: validation.errors });
      }
    }

    const template = await SMSTemplate.update(templateId, updates);

    return res.json({
      success: true,
      template
    });
  } catch (error) {
    console.error('❌ Update template error:', error.message);
    res.status(error.message.includes('not found') ? 404 : 500).json({ error: error.message });
  }
});

/**
 * DELETE /api/sms/templates/:id
 * Delete SMS template (cannot delete default templates)
 */
router.delete('/templates/:templateId', authenticate, async (req, res) => {
  try {
    const { templateId } = req.params;

    const success = await SMSTemplate.delete(templateId);

    if (!success) {
      return res.status(404).json({ error: 'Template not found' });
    }

    return res.json({
      success: true,
      message: 'Template deleted'
    });
  } catch (error) {
    console.error('❌ Delete template error:', error.message);
    res.status(error.message.includes('default') ? 403 : 500).json({ error: error.message });
  }
});

/**
 * OPT-OUT ENDPOINTS
 */

/**
 * POST /api/contacts/:id/sms-optout
 * Manually opt-out a contact from SMS
 */
router.post('/:contactId/optout', authenticate, async (req, res) => {
  try {
    const { contactId } = req.params;
    const userId = req.user.id;

    const contact = await getContact(contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    if (!contact.phone_number) {
      return res.status(400).json({ error: 'Contact has no phone number' });
    }

    // Check if already opted out
    const isOptedOut = await TwilioService.isOptedOut(contactId);
    if (isOptedOut) {
      return res.status(400).json({ error: 'Contact is already opted out' });
    }

    // Create opt-out record
    const { db } = require('../models/index');
    const result = await db.query(
      `INSERT INTO sms_optouts (contact_id, phone_number, reason, opted_out_by)
       VALUES ($1, $2, 'manual', $3)
       RETURNING *`,
      [contactId, contact.phone_number, userId]
    );

    // Update contact SMS preferences
    await updateContact(contactId, { sms_opted_in: false });

    // Log activity
    await logActivity({
      userId,
      contactId,
      actionType: 'sms_optout',
      metadata: { reason: 'manual' }
    });

    return res.json({
      success: true,
      optout: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Opt-out error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/contacts/:id/sms-optin
 * Manually opt-in a contact to SMS
 */
router.post('/:contactId/optin', authenticate, async (req, res) => {
  try {
    const { contactId } = req.params;
    const userId = req.user.id;

    const contact = await getContact(contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    if (!contact.phone_number) {
      return res.status(400).json({ error: 'Contact has no phone number' });
    }

    // Remove opt-out record if exists
    const { db } = require('../models/index');
    await db.query(
      'DELETE FROM sms_optouts WHERE contact_id = $1',
      [contactId]
    );

    // Update contact SMS preferences
    await updateContact(contactId, { 
      sms_opted_in: true,
      sms_opted_in_at: new Date()
    });

    // Log activity
    await logActivity({
      userId,
      contactId,
      actionType: 'sms_optin',
      metadata: { timestamp: new Date() }
    });

    return res.json({
      success: true,
      message: 'Contact opted in to SMS'
    });
  } catch (error) {
    console.error('❌ Opt-in error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sms/optouts
 * List all opted-out contacts
 */
router.get('/optouts', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const { db } = require('../models/index');
    const result = await db.query(
      `SELECT o.*, c.name, c.email, c.phone_number 
       FROM sms_optouts o
       LEFT JOIN contacts c ON o.contact_id = c.id
       ORDER BY o.opted_out_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await db.query('SELECT COUNT(*) as total FROM sms_optouts');
    const total = parseInt(countResult.rows[0].total);

    return res.json({
      success: true,
      optouts: result.rows,
      pagination: {
        limit,
        offset,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ List optouts error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
