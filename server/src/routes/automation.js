const express = require('express');
const { db, orgWhere, orgUserWhere } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

const DEFAULT_RULES = [
  {
    stage: 'lead',
    inactivity_days: 7,
    rule_name: 'Lead Nurture',
    email_template: `<p>Hi {{contact_name}},</p><p>I wanted to follow up and see if you'd be open to a quick chat about {{deal_title}}.</p><p>Best,<br>[Your name]</p>`,
  },
  {
    stage: 'qualified',
    inactivity_days: 5,
    rule_name: 'Discovery Follow-up',
    email_template: `<p>Hi {{contact_name}},</p><p>Following up on our conversation about {{deal_title}}. Happy to answer any questions or share more detail.</p><p>Best,<br>[Your name]</p>`,
  },
  {
    stage: 'closed_lost',
    inactivity_days: 90,
    rule_name: 'Win-back Check-in',
    email_template: `<p>Hi {{contact_name}},</p><p>It's been a while since we last spoke about {{deal_title}}. Checking in to see if circumstances have changed — I'd love to reconnect if the timing feels right.</p><p>Best,<br>[Your name]</p>`,
  },
];

// GET /api/automation/rules
router.get('/rules', auth, async (req, res) => {
  try {
    const rules = await db
      .selectFrom('stage_automation_rules')
      .$call(orgWhere(req.orgId))
      .where('user_id', '=', req.user.id)
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();
    res.json(rules);
  } catch (err) {
    console.error('[Automation] GET /rules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/automation/rules
router.post('/rules', auth, async (req, res) => {
  const { stage, inactivity_days, rule_name, email_template, enabled } = req.body;
  if (!stage || !rule_name || !email_template) {
    return res.status(400).json({ error: 'stage, rule_name, email_template required' });
  }
  try {
    const rule = await db
      .insertInto('stage_automation_rules')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        stage,
        inactivity_days: inactivity_days || 7,
        rule_name,
        email_template,
        enabled: enabled !== false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(rule);
  } catch (err) {
    console.error('[Automation] POST /rules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/automation/rules/:id
router.patch('/rules/:id', auth, async (req, res) => {
  const { stage, inactivity_days, rule_name, email_template, enabled } = req.body;
  try {
    const updates = {};
    if (stage !== undefined) updates.stage = stage;
    if (inactivity_days !== undefined) updates.inactivity_days = inactivity_days;
    if (rule_name !== undefined) updates.rule_name = rule_name;
    if (email_template !== undefined) updates.email_template = email_template;
    if (enabled !== undefined) updates.enabled = enabled;
    updates.updated_at = new Date();

    const rule = await db
      .updateTable('stage_automation_rules')
      .$call(orgWhere(req.orgId))
      .set(updates)
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();
    if (!rule) return res.status(404).json({ error: 'Not found' });
    res.json(rule);
  } catch (err) {
    console.error('[Automation] PATCH /rules/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/automation/rules/:id
router.delete('/rules/:id', auth, async (req, res) => {
  try {
    await db
      .deleteFrom('stage_automation_rules')
      .$call(orgWhere(req.orgId))
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .execute();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Automation] DELETE /rules/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/automation/seed-defaults — idempotent seed of default rules for a user
router.post('/seed-defaults', auth, async (req, res) => {
  try {
    const existing = await db
      .selectFrom('stage_automation_rules')
      .$call(orgWhere(req.orgId))
      .where('user_id', '=', req.user.id)
      .select(['stage'])
      .execute();
    const existingStages = new Set(existing.map(r => r.stage));

    const toInsert = DEFAULT_RULES.filter(r => !existingStages.has(r.stage));
    if (toInsert.length > 0) {
      await db
        .insertInto('stage_automation_rules')
        .values(toInsert.map(r => ({ ...r, organization_id: req.orgId, user_id: req.user.id, enabled: false })))
        .execute();
    }

    const all = await db
      .selectFrom('stage_automation_rules')
      .$call(orgWhere(req.orgId))
      .where('user_id', '=', req.user.id)
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();
    res.json(all);
  } catch (err) {
    console.error('[Automation] POST /seed-defaults error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
