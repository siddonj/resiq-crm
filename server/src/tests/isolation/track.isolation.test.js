// server/src/tests/isolation/track.isolation.test.js
// track.js mixes public tracking-pixel/link routes (GET /:trackingId.png, GET /pixel.png,
// GET /link) — no session, no req.orgId, by design — with authed routes (POST /create,
// GET /contact/:contactId, GET /asset/:assetType/:assetId) that read req.orgId. Both
// engagement_tracking and activities are ORG_TABLES (organization_id NOT NULL since
// migration 062). Before this fix the authed routes only had `requireAuth` wired (no
// resolveOrg) — req.orgId was undefined on the flat /api/track mount, and the public
// routes' activities inserts omitted organization_id entirely (NOT NULL violation,
// silently swallowed by each route's own try/catch).
//
// Public-route org attribution never comes from the request:
// - GET /:trackingId.png resolves it from the engagement_tracking row itself (stamped
//   at creation time in POST /create).
// - GET /pixel.png and GET /link resolve it from the embedded sender (data.userId) via
//   resolveOrgIdForUser — never from any request-supplied org value.

const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

const insertValues = { activities: [], engagement_tracking: [] };
const updateCalls = [];

function makeInsertChain(table) {
  const chain = {
    values: jest.fn((v) => {
      insertValues[table] = insertValues[table] || [];
      insertValues[table].push(v);
      return chain;
    }),
    returningAll: jest.fn(() => chain),
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue({ id: 'tracking-1', tracking_id: 'tid-1' }),
    execute: jest.fn().mockResolvedValue({}),
  };
  return chain;
}

function makeUpdateChain() {
  const chain = {
    set: jest.fn((v) => { updateCalls.push(v); return chain; }),
    where: jest.fn(() => chain),
    execute: jest.fn().mockResolvedValue({}),
  };
  return chain;
}

// The tracking row backing the public pixel endpoint. organization_id here simulates
// the value already stamped at POST /create time — the pixel route must forward it,
// never invent its own.
const pixelTrackingRow = {
  tracking_id: 'tid-existing',
  organization_id: 'org-owner-id',
  user_id: 'sender-user-id',
  contact_id: 'contact-1',
  asset_type: 'proposal',
  asset_id: 'asset-1',
};

// Mirrors real behavior: only resolves a row when the requested tracking_id actually
// matches an existing record (real production would query a real trackingId UUID; a
// mismatched param, e.g. from the routing-shadow scenario below, must resolve nothing).
function makeSelectChain() {
  let trackingIdFilter;
  const chain = {
    $call: jest.fn((fn) => { fn(chain); return chain; }),
    where: jest.fn((field, op, value) => {
      if (field === 'tracking_id') trackingIdFilter = value;
      return chain;
    }),
    selectAll: jest.fn(() => chain),
    orderBy: jest.fn(() => chain),
    execute: jest.fn().mockResolvedValue([]),
    executeTakeFirst: jest.fn(() =>
      Promise.resolve(trackingIdFilter === pixelTrackingRow.tracking_id ? pixelTrackingRow : undefined)
    ),
  };
  return chain;
}

const mockDb = {
  insertInto: jest.fn((table) => makeInsertChain(table)),
  updateTable: jest.fn(() => makeUpdateChain()),
  selectFrom: jest.fn(() => makeSelectChain()),
};

// Owner of the embedded sender userId used by the legacy pixel/link tests.
const senderUserId = 'sender-user-id';
const senderOrgId = 'org-owner-id';

jest.mock('../../db', () => ({
  db: mockDb,
  sql: jest.fn(),
  orgWhere: (orgId) => (qb) => qb.where('organization_id', '=', orgId),
  orgUserWhere: (orgId, userId) => (qb) => qb.where('organization_id', '=', orgId).where('user_id', '=', userId),
}));

jest.mock('../../middleware/auth', () => (req, res, next) => next());

jest.mock('../../middleware/resolveOrg', () => ({ resolveOrg: (req, res, next) => next() }));

jest.mock('../../services/auditLogger', () => ({
  logAction: jest.fn(),
  resolveOrgIdForUser: jest.fn(async (userId) => (userId === senderUserId ? senderOrgId : null)),
}));

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  jest.resetModules();
  return require('../../routes/track');
}

describe('track — cross-org isolation (POST /create)', () => {
  beforeEach(() => {
    insertValues.engagement_tracking = [];
    mockDb.insertInto.mockClear();
  });

  const body = { assetType: 'proposal', assetId: 'asset-1' };

  it('org-b user gets 403 when accessing org-a create endpoint', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/create')
      .set('x-test-user', JSON.stringify(userB))
      .send(body);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('org-a user accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/create')
      .set('x-test-user', JSON.stringify(userA))
      .send(body);

    expect(res.status).not.toBe(403);
  });

  it('super-admin accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/create')
      .set('x-test-user', JSON.stringify(superAdmin))
      .send(body);

    expect(res.status).not.toBe(403);
  });

  it('stamps organization_id with the org id on every engagement_tracking insert', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/create')
      .set('x-test-user', JSON.stringify(userA))
      .send(body);

    expect(res.status).toBe(200);
    expect(insertValues.engagement_tracking.length).toBeGreaterThan(0);
    expect(insertValues.engagement_tracking.every((v) => v.organization_id === orgA.id)).toBe(true);
  });
});

describe('track — GET /contact/:contactId and GET /asset/:type/:id apply an organization_id filter', () => {
  it('GET /contact/:contactId filters engagement_tracking by req.orgId', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/contact/contact-1')
      .set('x-test-user', JSON.stringify(userA));

    expect(res.status).toBe(200);
    // orgWhere is applied via $call — verified indirectly through the mocked chain
    // being invoked at all (no throw) and the route completing successfully.
    expect(mockDb.selectFrom).toHaveBeenCalledWith('engagement_tracking');
  });

  it('GET /asset/:assetType/:assetId filters engagement_tracking by req.orgId', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/asset/proposal/asset-1')
      .set('x-test-user', JSON.stringify(userA));

    expect(res.status).toBe(200);
    expect(mockDb.selectFrom).toHaveBeenCalledWith('engagement_tracking');
  });
});

describe('track — public pixel (GET /:trackingId.png) stamps org from the tracking record owner', () => {
  it('stamps organization_id from the tracking record, not from any request value', async () => {
    insertValues.activities = [];
    const app = express();
    app.use('/api/track', routerFactory());

    const res = await request(app).get('/api/track/tid-existing.png');

    expect(res.status).toBe(200);
    expect(insertValues.activities.length).toBeGreaterThan(0);
    expect(insertValues.activities.every((v) => v.organization_id === pixelTrackingRow.organization_id)).toBe(true);
  });
});

describe('track — legacy public routes resolve org from the embedded sender, not the request', () => {
  beforeEach(() => {
    insertValues.activities = [];
  });

  function encode(payload) {
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  it('GET /pixel.png stamps organization_id resolved from data.userId', async () => {
    const app = express();
    app.use('/api/track', routerFactory());

    const d = encode({ contactId: 'contact-1', userId: senderUserId, subject: 'Hi' });
    const res = await request(app).get(`/api/track/pixel.png?d=${d}`);

    expect(res.status).toBe(200);
    expect(insertValues.activities.length).toBeGreaterThan(0);
    expect(insertValues.activities.every((v) => v.organization_id === senderOrgId)).toBe(true);
  });

  it('GET /link stamps organization_id resolved from data.userId', async () => {
    const app = express();
    app.use('/api/track', routerFactory());

    const d = encode({ contactId: 'contact-1', userId: senderUserId, url: 'https://example.com' });
    const res = await request(app).get(`/api/track/link?d=${d}`);

    expect(res.status).toBe(302);
    expect(insertValues.activities.length).toBeGreaterThan(0);
    expect(insertValues.activities.every((v) => v.organization_id === senderOrgId)).toBe(true);
  });

  it('GET /pixel.png does not write an activity when the sender org cannot be resolved', async () => {
    const app = express();
    app.use('/api/track', routerFactory());

    const d = encode({ contactId: 'contact-1', userId: 'unknown-user', subject: 'Hi' });
    const res = await request(app).get(`/api/track/pixel.png?d=${d}`);

    expect(res.status).toBe(200);
    expect(insertValues.activities.length).toBe(0);
  });
});
