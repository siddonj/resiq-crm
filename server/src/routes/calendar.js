const express = require('express');
const { db, sql, orgWhere, orgUserWhere } = require('../db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

// ── Unified calendar feed ────────────────────────────────────────────────────
// GET /api/calendar?start=ISO&end=ISO
// Returns activities, reminders, and calendar_events in the date range
router.get('/', auth, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end are required' });

  try {
    const [eventsRes, activitiesRes, remindersRes] = await Promise.all([
      sql`
        SELECT e.*, c.name AS contact_name, d.title AS deal_title
        FROM calendar_events e
        LEFT JOIN contacts c ON c.id = e.contact_id
        LEFT JOIN deals d ON d.id = e.deal_id
        WHERE e.user_id = ${req.user.id} AND e.start_at < ${end} AND e.end_at > ${start}
        ORDER BY e.start_at
      `.execute(db),
      sql`
        SELECT a.*, c.name AS contact_name, d.title AS deal_title
        FROM activities a
        LEFT JOIN contacts c ON c.id = a.contact_id
        LEFT JOIN deals d ON d.id = a.deal_id
        WHERE a.user_id = ${req.user.id} AND a.occurred_at >= ${start} AND a.occurred_at < ${end}
        ORDER BY a.occurred_at
      `.execute(db),
      sql`
        SELECT r.*, c.name AS contact_name, d.title AS deal_title
        FROM reminders r
        LEFT JOIN contacts c ON c.id = r.contact_id
        LEFT JOIN deals d ON d.id = r.deal_id
        WHERE r.user_id = ${req.user.id} AND r.remind_at >= ${start} AND r.remind_at < ${end}
        ORDER BY r.remind_at
      `.execute(db),
    ]);

    const events = [
      ...eventsRes.rows.map(e => ({ ...e, _type: 'event' })),
      ...activitiesRes.rows.map(a => ({ ...a, _type: 'activity', start_at: a.occurred_at, end_at: a.occurred_at })),
      ...remindersRes.rows.map(r => ({ ...r, _type: 'reminder', title: r.message, start_at: r.remind_at, end_at: r.remind_at })),
    ];

    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Calendar events CRUD ─────────────────────────────────────────────────────
router.get('/events', auth, async (req, res) => {
  try {
    const rows = await sql`
      SELECT e.*, c.name AS contact_name, d.title AS deal_title
      FROM calendar_events e
      LEFT JOIN contacts c ON c.id = e.contact_id
      LEFT JOIN deals d ON d.id = e.deal_id
      WHERE e.user_id = ${req.user.id}
      ORDER BY e.start_at DESC
      LIMIT 200
    `.execute(db);
    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/events', auth, async (req, res) => {
  const { title, description, start_at, end_at, contact_id, deal_id } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!start_at || !end_at) return res.status(400).json({ error: 'start_at and end_at are required' });
  try {
    const event = await db.insertInto('calendar_events')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        title,
        description: description || null,
        start_at,
        end_at,
        contact_id: contact_id || null,
        deal_id: deal_id || null,
        source: 'manual',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    logAction(req.user.id, req.user.email, 'create', 'calendar_event', event.id, title);

    // Also create a reminder for the event start
    await db.insertInto('reminders')
      .values({
        organization_id: req.orgId,
        user_id: req.user.id,
        message: `Event: ${title}`,
        remind_at: start_at,
        contact_id: contact_id || null,
        deal_id: deal_id || null,
      })
      .execute()
      .catch(() => {});

    res.status(201).json(event);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/events/:id', auth, async (req, res) => {
  const { title, description, start_at, end_at, contact_id, deal_id } = req.body;
  try {
    const result = await db.updateTable('calendar_events')
      .$call(orgUserWhere(req.orgId, req.user.id))
      .set({
        title,
        description: description || null,
        start_at,
        end_at,
        contact_id: contact_id || null,
        deal_id: deal_id || null,
      })
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/events/:id', auth, async (req, res) => {
  try {
    const result = await db.deleteFrom('calendar_events')
      .$call(orgUserWhere(req.orgId, req.user.id))
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .returning('title')
      .executeTakeFirst();
    if (!result) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'calendar_event', req.params.id, result.title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Scheduling settings ──────────────────────────────────────────────────────
router.get('/scheduling', auth, async (req, res) => {
  try {
    const result = await db.selectFrom('scheduling_settings')
      .selectAll()
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();
    res.json(result || null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/scheduling', auth, async (req, res) => {
  const { slug, enabled, slot_duration, availability, timezone, title, description } = req.body;
  if (!slug?.trim()) return res.status(400).json({ error: 'Slug is required' });
  try {
    const result = await sql`
      INSERT INTO scheduling_settings (user_id, slug, enabled, slot_duration, availability, timezone, title, description)
      VALUES (${req.user.id}, ${slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')}, ${enabled !== false},
              ${slot_duration || 30}, ${JSON.stringify(availability || {})}, ${timezone || 'UTC'},
              ${title || 'Book a meeting'}, ${description || null})
      ON CONFLICT (user_id) DO UPDATE SET
        slug = ${slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')},
        enabled = ${enabled !== false},
        slot_duration = ${slot_duration || 30},
        availability = ${JSON.stringify(availability || {})},
        timezone = ${timezone || 'UTC'},
        title = ${title || 'Book a meeting'},
        description = ${description || null},
        updated_at = NOW()
      RETURNING *
    `.execute(db);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'That URL slug is already taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Public booking endpoints (no auth) ──────────────────────────────────────
// GET /api/calendar/book/:slug — get availability + settings
router.get('/book/:slug', async (req, res) => {
  try {
    const settingsRes = await sql`
      SELECT s.*, u.name AS owner_name
      FROM scheduling_settings s
      JOIN users u ON u.id = s.user_id
      WHERE s.slug = ${req.params.slug} AND s.enabled = true
    `.execute(db);
    if (settingsRes.rows.length === 0) return res.status(404).json({ error: 'Scheduling page not found' });

    const settings = settingsRes.rows[0];

    // Get booked slots for the next 60 days
    const bookedRes = await sql`
      SELECT start_at, end_at FROM calendar_events
      WHERE user_id = ${settings.user_id} AND start_at >= NOW() AND start_at < NOW() + INTERVAL '60 days'
      ORDER BY start_at
    `.execute(db);

    res.json({ settings, booked: bookedRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/calendar/book/:slug — create a booking
router.post('/book/:slug', async (req, res) => {
  const { name, email, start_at, end_at, notes } = req.body;
  if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: 'Name and email are required' });
  if (!start_at || !end_at) return res.status(400).json({ error: 'start_at and end_at are required' });

  try {
    const settingsRes = await sql`
      SELECT * FROM scheduling_settings WHERE slug = ${req.params.slug} AND enabled = true
    `.execute(db);
    if (settingsRes.rows.length === 0) return res.status(404).json({ error: 'Scheduling page not found' });

    const settings = settingsRes.rows[0];

    // Check for conflicts
    const conflictRes = await sql`
      SELECT id FROM calendar_events
      WHERE user_id = ${settings.user_id} AND start_at < ${end_at} AND end_at > ${start_at}
    `.execute(db);
    if (conflictRes.rows.length > 0) return res.status(409).json({ error: 'That slot is no longer available' });

    const title = `Meeting with ${name}`;
    const description = [email, notes].filter(Boolean).join('\n');

    const eventRes = await sql`
      INSERT INTO calendar_events (user_id, title, description, start_at, end_at, source, booking_name, booking_email)
      VALUES (${settings.user_id}, ${title}, ${description}, ${start_at}, ${end_at}, 'booking', ${name}, ${email})
      RETURNING *
    `.execute(db);

    // Create reminder for the owner
    await sql`
      INSERT INTO reminders (user_id, message, remind_at)
      VALUES (${settings.user_id}, ${`Booking: ${title}`}, ${start_at})
    `.execute(db).catch(() => {});

    // Create activity for the owner
    await sql`
      INSERT INTO activities (user_id, type, description, occurred_at)
      VALUES (${settings.user_id}, 'meeting', ${`Scheduled meeting with ${name} (${email})`}, ${start_at})
    `.execute(db).catch(() => {});

    res.status(201).json(eventRes.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
