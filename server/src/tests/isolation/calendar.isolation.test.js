// server/src/tests/isolation/calendar.isolation.test.js
const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// calendar.js mixes Kysely (db.insertInto/updateTable/deleteFrom/selectFrom) for the
// events CRUD + scheduling routes with raw Kysely `sql` tagged templates for the unified
// feed (GET /) and the public booking endpoints (GET/POST /book/:slug). calendar_events,
// activities, and reminders are all ORG_TABLES (organization_id NOT NULL since migration
// 062). Before this fix the authed routes only had `auth` wired (no resolveOrg), so
// req.orgId was undefined on the flat /api/calendar mount — POST /events threw a
// not-null-violation on every call. The public /book/:slug routes have no req.orgId at
// all (unauthenticated); a booking must be stamped with the booking-page OWNER's
// organization_id (resolved server-side from scheduling_settings.user_id), never a
// request-derived value.

const insertValues = { calendar_events: [], reminders: [] };
const capturedTagCalls = [];

function makeInsertChain(table) {
  const chain = {
    values: jest.fn((v) => {
      insertValues[table] = insertValues[table] || [];
      insertValues[table].push(v);
      return chain;
    }),
    returningAll: jest.fn(() => chain),
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue({ id: 'event-1' }),
    execute: jest.fn().mockResolvedValue({}),
  };
  return chain;
}

function makeUpdateDeleteChain() {
  const chain = {
    $call: jest.fn((fn) => { fn(chain); return chain; }),
    where: jest.fn(() => chain),
    set: jest.fn(() => chain),
    returningAll: jest.fn(() => chain),
    returning: jest.fn(() => chain),
    executeTakeFirst: jest.fn().mockResolvedValue(undefined),
  };
  return chain;
}

function makeSelectChain() {
  const chain = {
    selectAll: jest.fn(() => chain),
    where: jest.fn(() => chain),
    executeTakeFirst: jest.fn().mockResolvedValue(undefined),
  };
  return chain;
}

const mockDb = {
  insertInto: jest.fn((table) => makeInsertChain(table)),
  updateTable: jest.fn(() => makeUpdateDeleteChain()),
  deleteFrom: jest.fn(() => makeUpdateDeleteChain()),
  selectFrom: jest.fn(() => makeSelectChain()),
};

// Owner of the booking-page slug used by the public-booking tests.
const bookingOwnerUserId = 'owner-user-id';
const bookingOwnerOrgId = 'org-owner-id';

const mockSql = Object.assign(
  jest.fn((strings, ...values) => {
    capturedTagCalls.push({ strings: [...strings], values });
    const text = strings.join(' ');
    let rows = [];
    if (text.includes('FROM scheduling_settings') || text.includes('scheduling_settings WHERE')) {
      rows = [{ user_id: bookingOwnerUserId, slug: 'owner-slug', enabled: true }];
    } else if (text.includes('INSERT INTO calendar_events')) {
      rows = [{ id: 'booked-event-1' }];
    }
    return {
      strings: [...strings],
      values,
      execute: jest.fn().mockResolvedValue({ rows }),
    };
  }),
  { join: jest.fn((items) => ({ __joined: items })), ref: jest.fn((r) => r) }
);

jest.mock('../../db', () => ({
  db: mockDb,
  sql: mockSql,
  orgWhere: (orgId) => (qb) => qb.where('organization_id', '=', orgId),
  orgUserWhere: (orgId, userId) => (qb) => qb.where('organization_id', '=', orgId).where('user_id', '=', userId),
}));

jest.mock('../../middleware/auth', () => (req, res, next) => next());

// resolveOrg has its own dedicated unit test. The org-scoped mount (buildIsolationApp)
// uses a plain express.Router() without mergeParams, so req.params.orgSlug isn't
// propagated the way it is in production (index.js's orgRouter sets mergeParams: true)
// — mock it away so req.orgId comes only from the mock requireOrg middleware, same
// precedent as the integrations isolation test.
jest.mock('../../middleware/resolveOrg', () => ({ resolveOrg: (req, res, next) => next() }));

jest.mock('../../services/auditLogger', () => ({
  logAction: jest.fn(),
  resolveOrgIdForUser: jest.fn(async (userId) => (userId === bookingOwnerUserId ? bookingOwnerOrgId : null)),
}));

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  jest.resetModules();
  return require('../../routes/calendar');
}

describe('calendar — cross-org isolation (POST /events)', () => {
  beforeEach(() => {
    insertValues.calendar_events = [];
    insertValues.reminders = [];
    capturedTagCalls.length = 0;
    mockDb.insertInto.mockClear();
  });

  const body = { title: 'Standup', start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T10:30:00Z' };

  it('org-b user gets 403 when accessing org-a events endpoint', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/events')
      .set('x-test-user', JSON.stringify(userB))
      .send(body);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('org-a user accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/events')
      .set('x-test-user', JSON.stringify(userA))
      .send(body);

    expect(res.status).not.toBe(403);
  });

  it('super-admin accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/events')
      .set('x-test-user', JSON.stringify(superAdmin))
      .send(body);

    expect(res.status).not.toBe(403);
  });

  it('stamps organization_id with the org id on every calendar_events and reminders insert', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/events')
      .set('x-test-user', JSON.stringify(userA))
      .send(body);

    expect(res.status).toBe(201);
    expect(insertValues.calendar_events.length).toBeGreaterThan(0);
    expect(insertValues.calendar_events.every((v) => v.organization_id === orgA.id)).toBe(true);
    expect(insertValues.reminders.length).toBeGreaterThan(0);
    expect(insertValues.reminders.every((v) => v.organization_id === orgA.id)).toBe(true);
  });
});

describe('calendar — unified feed (GET /) applies an organization_id filter', () => {
  beforeEach(() => {
    capturedTagCalls.length = 0;
  });

  it('every calendar_events/activities/reminders query in the feed is org-scoped', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/?start=2026-01-01T00:00:00Z&end=2026-01-02T00:00:00Z')
      .set('x-test-user', JSON.stringify(userA));

    expect(res.status).toBe(200);

    const orgConditionCalls = capturedTagCalls.filter((c) =>
      c.strings.join('').includes('organization_id =')
    );
    expect(orgConditionCalls.length).toBeGreaterThanOrEqual(3);
    expect(orgConditionCalls.every((c) => c.values.includes(orgA.id))).toBe(true);
  });
});

describe('calendar — public booking (POST /book/:slug) stamps the SLUG OWNER\'s org', () => {
  beforeEach(() => {
    capturedTagCalls.length = 0;
  });

  it('stamps organization_id resolved from the booking-page owner, not from any request value', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      res.sendSuccess = (data) => res.json({ success: true, data });
      res.sendError = (msg, code, status) => res.status(status).json({ error: msg, code });
      next();
    });
    app.use('/api/calendar', routerFactory());

    const res = await request(app)
      .post('/api/calendar/book/owner-slug')
      .send({ name: 'Ada Booker', email: 'ada@example.com', start_at: '2026-01-05T10:00:00Z', end_at: '2026-01-05T10:30:00Z' });

    expect(res.status).toBe(201);

    const insertCalls = capturedTagCalls.filter((c) => c.strings.join(' ').includes('INSERT INTO calendar_events'));
    expect(insertCalls.length).toBeGreaterThan(0);
    // The public route has no req.orgId (anonymous booker) — organization_id must come
    // from resolveOrgIdForUser(settings.user_id), i.e. the slug OWNER's org.
    expect(insertCalls.every((c) => c.values.includes(bookingOwnerOrgId))).toBe(true);
  });
});
