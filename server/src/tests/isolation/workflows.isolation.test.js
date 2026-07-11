// server/src/tests/isolation/workflows.isolation.test.js
const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// routes/workflows.js uses raw pool.query (../models/db, via models/workflow.js) against
// `workflows`, which IS in ORG_TABLES per migration 062 (organization_id NOT NULL).
// Capture the (text, params) pairs passed to pool.query so we can assert org filtering.
// workflow_executions is NOT in ORG_TABLES (no organization_id column) — access to it is
// gated entirely through the parent workflow's org-scoped lookup, so it is left unfiltered
// intentionally (same shape as deal_followup_tasks being gated through its owning deal).

const capturedQueries = [];

const existingWorkflowRow = (orgId, overrides = {}) => ({
  id: 'wf-1',
  user_id: 'user-a',
  organization_id: orgId,
  name: 'Existing workflow',
  description: null,
  trigger_type: 'contact.created',
  trigger_config: {},
  actions: [{ type: 'create_activity', description: 'auto' }],
  conditions: null,
  enabled: true,
  created_by: 'user-a',
  ...overrides,
});

const mockPool = {
  query: jest.fn((text, params) => {
    capturedQueries.push({ text, params });

    if (/^\s*INSERT INTO workflows/i.test(text)) {
      return Promise.resolve({
        rows: [existingWorkflowRow(params[1], { id: 'wf-new', name: params[2] })],
      });
    }
    if (/^\s*SELECT \* FROM workflows WHERE user_id = \$1 AND organization_id = \$2/i.test(text)) {
      return Promise.resolve({ rows: [existingWorkflowRow(params[1])] });
    }
    if (/^\s*SELECT \* FROM workflows WHERE id = \$1 AND organization_id = \$2/i.test(text)) {
      // Only "resolve" the row when the org id matches what we seeded the test with —
      // mirrors how a real WHERE ... AND organization_id = $2 would behave.
      if (params[1] === 'org-org-a-id') {
        return Promise.resolve({ rows: [existingWorkflowRow(params[1])] });
      }
      return Promise.resolve({ rows: [] });
    }
    if (/^\s*UPDATE workflows SET/i.test(text)) {
      return Promise.resolve({ rows: [existingWorkflowRow(params[params.length - 1])] });
    }
    if (/^\s*DELETE FROM workflows WHERE/i.test(text)) {
      return Promise.resolve({ rowCount: 1 });
    }
    if (/^\s*SELECT \* FROM workflow_executions/i.test(text)) {
      return Promise.resolve({ rows: [] });
    }
    if (/COUNT\(\*\)/i.test(text)) {
      return Promise.resolve({ rows: [{ count: '0' }] });
    }
    return Promise.resolve({ rows: [] });
  }),
};

jest.mock('../../models/db', () => mockPool);

jest.mock('../../middleware/auth', () => (req, res, next) => next());

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id, { id: 'user-a' }), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  jest.resetModules();
  return require('../../routes/workflows');
}

const createBody = {
  name: 'New workflow',
  triggerType: 'contact.created',
  actions: [{ type: 'create_activity', description: 'auto' }],
};

describe('workflows — cross-org isolation', () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    mockPool.query.mockClear();
  });

  it('org-b user gets 403 when accessing org-a workflows endpoint', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a')
      .set('x-test-user', JSON.stringify(userB));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('org-a user accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a')
      .set('x-test-user', JSON.stringify(userA));

    expect(res.status).not.toBe(403);
  });

  it('super-admin accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a')
      .set('x-test-user', JSON.stringify(superAdmin));

    expect(res.status).not.toBe(403);
  });

  it('stamps organization_id with the org id on the workflows insert (POST /)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .post('/api/org/org-a')
      .set('x-test-user', JSON.stringify(userA))
      .send(createBody);

    const insertQueries = capturedQueries.filter((q) => /INSERT INTO workflows/.test(q.text));
    expect(insertQueries.length).toBeGreaterThan(0);
    const allOrgScoped = insertQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(allOrgScoped).toBe(true);
  });

  it('applies an organization_id filter with the org id on list (GET /)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .get('/api/org/org-a')
      .set('x-test-user', JSON.stringify(userA));

    const selectQueries = capturedQueries.filter((q) => /FROM workflows WHERE user_id/.test(q.text));
    expect(selectQueries.length).toBeGreaterThan(0);
    const orgScoped = selectQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on GET /:id', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .get('/api/org/org-a/wf-1')
      .set('x-test-user', JSON.stringify(userA));

    const selectQueries = capturedQueries.filter((q) => /FROM workflows WHERE id = \$1/.test(q.text));
    expect(selectQueries.length).toBeGreaterThan(0);
    const orgScoped = selectQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on PATCH /:id', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .patch('/api/org/org-a/wf-1')
      .set('x-test-user', JSON.stringify(userA))
      .send({ enabled: false });

    const updateQueries = capturedQueries.filter((q) => /UPDATE workflows SET/.test(q.text));
    expect(updateQueries.length).toBeGreaterThan(0);
    const orgScoped = updateQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on DELETE /:id', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .delete('/api/org/org-a/wf-1')
      .set('x-test-user', JSON.stringify(userA));

    const deleteQueries = capturedQueries.filter((q) => /DELETE FROM workflows WHERE/.test(q.text));
    expect(deleteQueries.length).toBeGreaterThan(0);
    const orgScoped = deleteQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('a workflow from a different org resolves to 404, not the row, on GET /:id', async () => {
    // Simulates cross-org access after the org-membership gate — the row lookup itself
    // must also filter by organization_id (defense in depth), not just rely on the
    // org-membership middleware. userB is a member of org-b, so this exercises org-b's
    // own workflows endpoint looking up an id that only exists under org-a.
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-b/wf-1')
      .set('x-test-user', JSON.stringify(userB));

    expect(res.status).toBe(404);
  });
});
