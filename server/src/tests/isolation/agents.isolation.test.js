// server/src/tests/isolation/agents.isolation.test.js
process.env.ENCRYPTION_KEY = 'a'.repeat(32);

const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// agents.js's /prospect/import route delegates to agentProspectService.importProspects,
// which uses raw pool.query (../models/db) to insert into `contacts` and `deals` — both
// ORG_TABLES per migration 062. Capture the (text, params) pairs passed to pool.query so
// we can assert org filtering on insert.

const capturedQueries = [];

const mockPool = {
  query: jest.fn((text, params) => {
    capturedQueries.push({ text, params });
    // Both INSERT statements use `RETURNING *`, so return a row shape that satisfies
    // downstream code (newContact.id / newContact.company / newContact.name).
    return Promise.resolve({ rows: [{ id: 'row-id', company: 'Acme', name: 'Acme' }] });
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
  return require('../../routes/agents');
}

const importBody = {
  prompt: 'test prompt',
  prospects: [{ name: 'Jane Doe', email: 'jane@example.com', company: 'Acme' }],
};

describe('agents — cross-org isolation', () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    mockPool.query.mockClear();
  });

  it('org-b user gets 403 when accessing org-a agents endpoint', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/prospect/import')
      .set('x-test-user', JSON.stringify(userB))
      .send(importBody);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('org-a user accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/prospect/import')
      .set('x-test-user', JSON.stringify(userA))
      .send(importBody);

    expect(res.status).not.toBe(403);
  });

  it('super-admin accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post('/api/org/org-a/prospect/import')
      .set('x-test-user', JSON.stringify(superAdmin))
      .send(importBody);

    expect(res.status).not.toBe(403);
  });

  it('stamps organization_id with the org id on the contacts insert', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .post('/api/org/org-a/prospect/import')
      .set('x-test-user', JSON.stringify(userA))
      .send(importBody);

    // Tighten to the target table first, then assert the org filter on that subset —
    // the route fires two INSERTs (contacts, deals); asserting against "any captured
    // query" would pass even if one of the two were unscoped.
    const contactsQueries = capturedQueries.filter((q) => /INSERT INTO contacts/.test(q.text));
    expect(contactsQueries.length).toBeGreaterThan(0);
    const orgScoped = contactsQueries.some(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('stamps organization_id with the org id on the deals insert', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .post('/api/org/org-a/prospect/import')
      .set('x-test-user', JSON.stringify(userA))
      .send(importBody);

    const dealsQueries = capturedQueries.filter((q) => /INSERT INTO deals/.test(q.text));
    expect(dealsQueries.length).toBeGreaterThan(0);
    const orgScoped = dealsQueries.some(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });
});
