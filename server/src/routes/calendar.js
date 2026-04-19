const express = require('express');
const pool = require('../models/db');
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
      pool.query(`
        SELECT e.*, c.name AS contact_name, d.title AS deal_title
        FROM calendar_events e
        LEFT JOIN contacts c ON c.id = e.contact_id
        LEFT JOIN deals d ON d.id = e.deal_id
        WHERE e.user_id = $1 AND e.start_at < $3 AND e.end_at > $2
        ORDER BY e.start_at
      `, [req.user.id, start, end]),
      pool.query(`
        SELECT a.*, c.name AS contact_name, d.title AS deal_title
        FROM activities a
        LEFT JOIN contacts c ON c.id = a.contact_id
        LEFT JOIN deals d ON d.id = a.deal_id
        WHERE a.user_id = $1 AND a.occurred_at >= $2 AND a.occurred_at < $3
        ORDER BY a.occurred_at
      `, [req.user.id, start, end]),
      pool.query(`
        SELECT r.*, c.name AS contact_name, d.title AS deal_title
        FROM reminders r
        LEFT JOIN contacts c ON c.id = r.contact_id
        LEFT JOIN deals d ON d.id = r.deal_id
        WHERE r.user_id = $1 AND r.remind_at >= $2 AND r.remind_at < $3
        ORDER BY r.remind_at
      `, [req.user.id, start, end]),
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
    const result = await pool.query(
      `SELECT e.*, c.name AS contact_name, d.title AS deal_title
       FROM calendar_events e
       LEFT JOIN contacts c ON c.id = e.contact_id
       LEFT JOIN deals d ON d.id = e.deal_id
       WHERE e.user_id = $1 ORDER BY e.start_at DESC LIMIT 200`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/events', auth, async (req, res) => {
  const { title, description, start_at, end_at, contact_id, deal_id } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!start_at || !end_at) return res.status(400).json({ error: 'start_at and end_at are required' });
  try {
    const result = await pool.query(
      `INSERT INTO calendar_events (user_id, title, description, start_at, end_at, contact_id, deal_id, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual') RETURNING *`,
      [req.user.id, title, description || null, start_at, end_at, contact_id || null, deal_id || null]
    );
    logAction(req.user.id, req.user.email, 'create', 'calendar_event', result.rows[0].id, title);

    // Also create a reminder for the event start
    await pool.query(
      `INSERT INTO reminders (user_id, message, remind_at, contact_id, deal_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, `Event: ${title}`, start_at, contact_id || null, deal_id || null]
    ).catch(() => {});

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/events/:id', auth, async (req, res) => {
  const { title, description, start_at, end_at, contact_id, deal_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE calendar_events SET title=$1, description=$2, start_at=$3, end_at=$4, contact_id=$5, deal_id=$6
       WHERE id=$7 AND user_id=$8 RETURNING *`,
      [title, description || null, start_at, end_at, contact_id || null, deal_id || null, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/events/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM calendar_events WHERE id=$1 AND user_id=$2 RETURNING title',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    logAction(req.user.id, req.user.email, 'delete', 'calendar_event', req.params.id, result.rows[0].title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Scheduling settings ──────────────────────────────────────────────────────
router.get('/scheduling', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM scheduling_settings WHERE user_id = $1',
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/scheduling', auth, async (req, res) => {
  const { slug, enabled, slot_duration, availability, timezone, title, description } = req.body;
  if (!slug?.trim()) return res.status(400).json({ error: 'Slug is required' });
  try {
    const result = await pool.query(
      `INSERT INTO scheduling_settings (user_id, slug, enabled, slot_duration, availability, timezone, title, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET
         slug = $2, enabled = $3, slot_duration = $4, availability = $5,
         timezone = $6, title = $7, description = $8, updated_at = NOW()
       RETURNING *`,
      [req.user.id, slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'), enabled !== false,
       slot_duration || 30, JSON.stringify(availability || {}), timezone || 'UTC', title || 'Book a meeting', description || null]
    );
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
    const settingsRes = await pool.query(
      `SELECT s.*, u.name AS owner_name
       FROM scheduling_settings s
       JOIN users u ON u.id = s.user_id
       WHERE s.slug = $1 AND s.enabled = true`,
      [req.params.slug]
    );
    if (settingsRes.rows.length === 0) return res.status(404).json({ error: 'Scheduling page not found' });

    const settings = settingsRes.rows[0];

    // Get booked slots for the next 60 days
    const bookedRes = await pool.query(
      `SELECT start_at, end_at FROM calendar_events
       WHERE user_id = $1 AND start_at >= NOW() AND start_at < NOW() + INTERVAL '60 days'
       ORDER BY start_at`,
      [settings.user_id]
    );

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
    const settingsRes = await pool.query(
      'SELECT * FROM scheduling_settings WHERE slug = $1 AND enabled = true',
      [req.params.slug]
    );
    if (settingsRes.rows.length === 0) return res.status(404).json({ error: 'Scheduling page not found' });

    const settings = settingsRes.rows[0];

    // Check for conflicts
    const conflictRes = await pool.query(
      `SELECT id FROM calendar_events
       WHERE user_id = $1 AND start_at < $3 AND end_at > $2`,
      [settings.user_id, start_at, end_at]
    );
    if (conflictRes.rows.length > 0) return res.status(409).json({ error: 'That slot is no longer available' });

    const title = `Meeting with ${name}`;
    const description = [email, notes].filter(Boolean).join('\n');

    const eventRes = await pool.query(
      `INSERT INTO calendar_events (user_id, title, description, start_at, end_at, source, booking_name, booking_email)
       VALUES ($1, $2, $3, $4, $5, 'booking', $6, $7) RETURNING *`,
      [settings.user_id, title, description, start_at, end_at, name, email]
    );

    // Create reminder for the owner
    await pool.query(
      `INSERT INTO reminders (user_id, message, remind_at)
       VALUES ($1, $2, $3)`,
      [settings.user_id, `Booking: ${title}`, start_at]
    ).catch(() => {});

    // Create activity for the owner
    await pool.query(
      `INSERT INTO activities (user_id, type, description, occurred_at)
       VALUES ($1, 'meeting', $2, $3)`,
      [settings.user_id, `Scheduled meeting with ${name} (${email})`, start_at]
    ).catch(() => {});

    res.status(201).json(eventRes.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
