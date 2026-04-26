const express = require('express');
const pool = require('../models/db');
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
    const formResult = await pool.query('SELECT * FROM forms WHERE id = $1', [formId]);
    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    const form = formResult.rows[0];
    const userId = form.user_id;

    // 2. Create the Contact
    const contactResult = await pool.query(
      `INSERT INTO contacts (user_id, name, email, phone, company, type, notes, custom_fields)
       VALUES ($1, $2, $3, $4, $5, 'prospect', $6, $7) RETURNING *`,
      [userId, name, email || null, phone || null, company || null, `Captured via Web Form: ${form.title}\n\n${notes || ''}`, JSON.stringify(customFields)]
    );
    const newContact = contactResult.rows[0];

    // 3. Create the Deal (Lead pipeline stage)
    const dealResult = await pool.query(
      `INSERT INTO deals (user_id, contact_id, title, stage, notes, custom_fields)
       VALUES ($1, $2, $3, 'lead', $4, $5) RETURNING *`,
      [userId, newContact.id, `Inbound Lead: ${company || name}`, 'Auto-generated from Web-to-Lead Form', JSON.stringify(customFields)]
    );
    const newDeal = dealResult.rows[0];

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
