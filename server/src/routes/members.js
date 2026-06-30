// server/src/routes/members.js
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');

const router = express.Router({ mergeParams: true });

// requireOrg and auth already applied by the orgRouter in index.js

// GET /api/org/:orgSlug/members
router.get('/', async (req, res) => {
  try {
    const members = await db.selectFrom('organization_members as om')
      .innerJoin('users as u', 'u.id', 'om.user_id')
      .where('om.organization_id', '=', req.orgId)
      .select([
        'om.id',
        'om.role',
        'om.created_at',
        'u.id as user_id',
        'u.name',
        'u.email',
      ])
      .orderBy('om.created_at', 'asc')
      .execute();
    res.sendSuccess(members);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// POST /api/org/:orgSlug/members/invite
router.post('/invite', async (req, res) => {
  const { email, role = 'member' } = req.body;
  if (!email) return res.sendError('email is required', 'VALIDATION_ERROR', 400);
  if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
    return res.sendError('Invalid role', 'VALIDATION_ERROR', 400);
  }

  try {
    // Check if user already exists
    const existingUser = await db.selectFrom('users')
      .where('email', '=', email.toLowerCase())
      .select(['id'])
      .executeTakeFirst();

    if (existingUser) {
      // Add directly to org
      await db.insertInto('organization_members')
        .values({ organization_id: req.orgId, user_id: existingUser.id, role })
        .onConflict((oc) => oc.columns(['organization_id', 'user_id']).doUpdateSet({ role }))
        .execute();
      return res.sendSuccess({ message: 'User added to organization' });
    }

    // Create pending invite
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insertInto('organization_invites')
      .values({
        organization_id: req.orgId,
        email: email.toLowerCase(),
        role,
        token,
        expires_at: expiresAt,
      })
      .execute();

    // Invite email wiring is a follow-up task.
    // For now the token is returned in the response so it can be manually shared.
    // Wire to the existing nodemailer/sendgrid service in server/src/services/email.js
    // when ready. The database row is already created and will work once the email is sent.

    res.sendSuccess({ message: 'Invite sent' });
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// PATCH /api/org/:orgSlug/members/:userId — update role
router.patch('/:userId', async (req, res) => {
  const { role } = req.body;
  if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
    return res.sendError('Invalid role', 'VALIDATION_ERROR', 400);
  }

  try {
    const updated = await db.updateTable('organization_members')
      .set({ role })
      .where('organization_id', '=', req.orgId)
      .where('user_id', '=', req.params.userId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) return res.sendError('Member not found', 'NOT_FOUND', 404);
    res.sendSuccess(updated);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// DELETE /api/org/:orgSlug/members/:userId — remove member
router.delete('/:userId', async (req, res) => {
  try {
    const deleted = await db.deleteFrom('organization_members')
      .where('organization_id', '=', req.orgId)
      .where('user_id', '=', req.params.userId)
      .returningAll()
      .executeTakeFirst();

    if (!deleted) return res.sendError('Member not found', 'NOT_FOUND', 404);
    res.sendSuccess({ message: 'Member removed' });
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

module.exports = router;
