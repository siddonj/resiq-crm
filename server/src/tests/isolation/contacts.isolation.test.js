// server/src/tests/isolation/contacts.isolation.test.js
const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// --- Mock all external dependencies before requiring the route ---

const capturedFilters = [];

const mockSql = Object.assign(
  jest.fn((strings, ...values) => ({
    execute: jest.fn().mockResolvedValue({ rows: [] }),
  })),
  {
    join: jest.fn(() => 'joined'),
    ref: jest.fn((r) => r),
  }
);

jest.mock('../../db', () => ({
  db: {},
  sql: mockSql,
  ownershipWhere: jest.fn(() => 'ownership-clause'),
  orgWhere: jest.fn((orgId) => (qb) => {
    capturedFilters.push(orgId);
    return qb;
  }),
  orgUserWhere: jest.fn((orgId, userId) => (qb) => qb),
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

jest.mock('../../middleware/auth', () => (req, res, next) => next());

jest.mock('../../services/auditLogger', () => ({
  logAction: jest.fn(),
}));

jest.mock('../../models/email', () => ({}));

jest.mock('multer', () => {
  const m = () => ({ single: () => (req, res, next) => next(), array: () => (req, res, next) => next() });
  m.memoryStorage = jest.fn();
  return m;
});

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  jest.resetModules();
  return require('../../routes/contacts');
}

describe('contacts — cross-org isolation', () => {
  beforeEach(() => {
    capturedFilters.length = 0;
  });

  it('org-b user gets 403 when accessing org-a contacts', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/')
      .set('x-test-user', JSON.stringify(userB));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('org-a user accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/')
      .set('x-test-user', JSON.stringify(userA));

    // Route may return 200 or 500 (db mock) — but NOT 403
    expect(res.status).not.toBe(403);
  });

  it('super-admin accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/')
      .set('x-test-user', JSON.stringify(superAdmin));

    expect(res.status).not.toBe(403);
  });
});
