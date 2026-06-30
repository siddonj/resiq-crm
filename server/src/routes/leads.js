const express = require('express');
const { db, sql, orgWhere, orgUserWhere } = require('../db');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

// Public endpoint for form submission from external websites
router.post('/:formId', async (req, res) => {
  const { formId } = req.params;
  const { name, email, phone, company, notes, ...customFields } = req.body;

  if (!name || (!email && !phone)) {
    return res.status(400).json({ error: 'Name and either email or phone are required.' });
  }

  try {
    // 1. Verify the form exists and get the target user_id owner
    const form = await db
      .selectFrom('forms')
      .where('id', '=', formId)
      .selectAll()
      .executeTakeFirst();

    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const userId = form.user_id;
    const orgId = form.organization_id;

    // 2. Create the Contact
    const newContact = await db.insertInto('contacts')
      .values({
        organization_id: orgId,
        user_id: userId,
        name,
        email: email || null,
        phone: phone || null,
        company: company || null,
        type: 'prospect',
        notes: `Captured via Web Form: ${form.title}\n\n${notes || ''}`,
        custom_fields: JSON.stringify(customFields),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // 3. Create the Deal (Lead pipeline stage)
    const newDeal = await db.insertInto('deals')
      .values({
        organization_id: orgId,
        user_id: userId,
        contact_id: newContact.id,
        title: `Inbound Lead: ${company || name}`,
        stage: 'lead',
        notes: 'Auto-generated from Web-to-Lead Form',
        custom_fields: JSON.stringify(customFields),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Trigger AI Auto-Enrichment (Phase 17)
    const { enrichmentQueue } = require('../workers/enrichmentWorker');
    enrichmentQueue.add({
      contactId: newContact.id,
      dealId: newDeal.id,
      userId: userId
    }).catch(e => console.error('Failed to queue enrichment:', e));

    // 4. Log the activity 
    logAction(userId, 'System (Web Form)', 'create', 'contact', newContact.id, `Lead captured via form: ${form.title}`);

    // If it was a standard HTML form POST, redirect back to their site if a redirect URL is set.
    // Otherwise, return JSON.
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(201).json({ success: true, message: 'Lead captured successfully' });
    } else if (form.redirect_url) {
      return res.redirect(form.redirect_url);
    } else {
      return res.send(`
        <html><body>
          <h2>Thank you!</h2>
          <p>Your information has been submitted successfully.</p>
        </body></html>
      `);
    }

  } catch (err) {
    console.error('Error processing web-to-lead form:', err);
    res.status(500).json({ error: 'Processing error' });
  }
});

module.exports = router;
