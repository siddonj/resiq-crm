// server/src/tests/isolation/integrations.isolation.test.js
const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// integrations.js's own DB access is a single Kysely insert: POST /gcal/sync writes
// synced Google Calendar events into `calendar_events`, which IS in ORG_TABLES
// (organization_id NOT NULL since migration 062, no default). The insert previously
// omitted organization_id entirely, which would throw a not-null-violation at the DB —
// silently swallowed by the route's per-item try/catch, so no calendar event has ever
// synced successfully since migration 062 shipped.
//
// Everything else in this file is per-user, not per-org: oauth_tokens (services/oauth.js)
// keys on (user_id, service_type) and is not in ORG_TABLES; gmail/gcal connect, callback,
// disconnect, status routes never touch an ORG_TABLES table.

const insertValues = [];

function makeChain() {
  const chain = {
    values: jest.fn((v) => {
      insertValues.push(v);
      return chain;
    }),
    onConflict: jest.fn(() => chain),
    execute: jest.fn().mockResolvedValue({}),
  };
  return chain;
}

const mockDb = {
  insertInto: jest.fn(() => makeChain()),
};

jest.mock('../../db', () => ({
  db: mockDb,
  sql: jest.fn(),
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

jest.mock('../../middleware/auth', () => (req, res, next) => next());

// resolveOrg has its own dedicated unit test (tests/resolveOrg.test.js). Here it is
// mocked as a no-op — the org-scoped mount (buildIsolationApp) uses a plain
// express.Router() without mergeParams, so req.params.orgSlug isn't propagated down
// to this router the way it is in production (index.js's orgRouter sets
// mergeParams: true). Mocking resolveOrg away keeps this test focused on what it
// actually verifies: the route stamps req.orgId (set by the mock requireOrg
// middleware) onto the calendar_events insert.
jest.mock('../../middleware/resolveOrg', () => ({ resolveOrg: (req, res, next) => next() }));

jest.mock('../../services/gmail', () => ({
  getAuthUrl: jest.fn(),
  exchangeCodeForTokens: jest.fn(),
  getUserEmail: jest.fn(),
  revokeAccess: jest.fn(),
  getLabels: jest.fn(),
  fetchEmails: jest.fn(),
}));

jest.mock('../../services/googleCalendar', () => ({
  getAuthUrl: jest.fn(),
  exchangeCodeForTokens: jest.fn(),
  listEvents: jest.fn().mockResolvedValue([
    {
      id: 'gcal-event-1',
      summary: 'Synced event',
      description: 'test',
      start: { dateTime: '2026-07-11T10:00:00Z' },
      end: { dateTime: '2026-07-11T11:00:00Z' },
    },
  ]),
}));

jest.mock('../../services/oauth', () => ({
  saveTokens: jest.fn(),
  getTokens: jest.fn().mockResolvedValue({ accessToken: 'token' }),
  clearTokens: jest.fn(),
}));

jest.mock('../../workers/emailSyncWorker', () => ({
  emailSyncQueue: { add: jest.fn() },
}));

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  jest.resetModules();
  return require('../../routes/integrations');
}

describe('integrations — cross-org isolation (POST /gcal/sync)', () => {
  beforeEach(() => {
    insertValues.length = 0;
    mockDb.insertInto.mockClear();
  });

  it('org-b user gets 403 when accessing org-a gcal/sync endpoint', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/gcal/sync')
      .set('x-test-user', JSON.stringify(userB));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('org-a user accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/gcal/sync')
      .set('x-test-user', JSON.stringify(userA));

    expect(res.status).not.toBe(403);
  });

  it('super-admin accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/gcal/sync')
      .set('x-test-user', JSON.stringify(superAdmin));

    expect(res.status).not.toBe(403);
  });

  it('stamps organization_id with the org id on every calendar_events insert', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/gcal/sync')
      .set('x-test-user', JSON.stringify(userA));

    expect(res.status).toBe(200);
    expect(insertValues.length).toBeGreaterThan(0);
    expect(insertValues.every((v) => v.organization_id === orgA.id)).toBe(true);
  });
});
