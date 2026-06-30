// server/src/tests/isolation/deals.isolation.test.js
const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

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

jest.mock('../../services/gmail', () => ({
  GmailService: jest.fn(),
}));

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  jest.resetModules();
  return require('../../routes/deals');
}

describe('deals — cross-org isolation', () => {
  beforeEach(() => {
    capturedFilters.length = 0;
  });

  it('org-b user gets 403 when accessing org-a deals', async () => {
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
