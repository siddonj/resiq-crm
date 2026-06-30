const express = require('express');
const { db, orgWhere, orgUserWhere } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all forms for the authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const rows = await db
      .selectFrom('forms')
      .$call(orgWhere(req.orgId))
      .where('user_id', '=', req.user.id)
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();
    res.json(rows);
  } catch (err) {
    console.error('Error fetching forms:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new form
router.post('/', auth, async (req, res) => {
  const { title, redirect_url, fields } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    const form = await db.insertInto('forms')
      .values({
        user_id: req.user.id,
        title,
        redirect_url: redirect_url || null,
        fields: JSON.stringify(fields || []),
        organization_id: req.orgId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(form);
  } catch (err) {
    console.error('Error creating form:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a form
router.put('/:id', auth, async (req, res) => {
  const { title, redirect_url, fields } = req.body;
  try {
    const form = await db.updateTable('forms')
      .$call(orgWhere(req.orgId))
      .set({
        title,
        redirect_url: redirect_url || null,
        fields: JSON.stringify(fields || []),
      })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();

    if (!form) return res.status(404).json({ error: 'Form not found' });
    res.json(form);
  } catch (err) {
    console.error('Error updating form:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a form
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.deleteFrom('forms')
      .$call(orgWhere(req.orgId))
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .execute();
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting form:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
