// server/src/tests/isolation/compliance.isolation.test.js
const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// compliance.js and complianceService.js use raw pool.query (../models/db),
// not the Kysely `db`/`orgWhere` helpers used elsewhere. Capture the
// (text, params) pairs passed to pool.query so we can assert org filtering.

const capturedQueries = [];

const mockPool = {
  query: jest.fn((text, params) => {
    capturedQueries.push({ text, params });
    return Promise.resolve({ rows: [] });
  }),
};

jest.mock('../../models/db', () => mockPool);

jest.mock('../../middleware/auth', () => (req, res, next) => next());

jest.mock('../../services/auditLogger', () => ({
  logAction: jest.fn(),
}));

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  jest.resetModules();
  return require('../../routes/compliance');
}

describe('compliance — cross-org isolation', () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    mockPool.query.mockClear();
  });

  it('org-b user gets 403 when accessing org-a compliance data', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/suppression')
      .set('x-test-user', JSON.stringify(userB));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('org-a user accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/suppression')
      .set('x-test-user', JSON.stringify(userA));

    expect(res.status).not.toBe(403);
  });

  it('super-admin accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/suppression')
      .set('x-test-user', JSON.stringify(superAdmin));

    expect(res.status).not.toBe(403);
  });

  it('applies an organization_id filter with the org id on list', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .get('/api/org/org-a/suppression')
      .set('x-test-user', JSON.stringify(userA));

    const orgScoped = capturedQueries.some(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });
});
