// server/src/tests/isolation/auditLogs.isolation.test.js
const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// auditLogs.js uses the Kysely `sql` tagged template from '../db' directly
// (not ownershipWhere/orgWhere, not raw pool.query). Capture every sql`` tag
// invocation's raw strings + interpolated values so we can assert that the
// route always adds an `organization_id = <req.orgId>` condition — filtered
// to that specific condition, not just "any query mentions organization_id".

const capturedTagCalls = [];

const mockSql = Object.assign(
  jest.fn((strings, ...values) => {
    capturedTagCalls.push({ strings: [...strings], values });
    return {
      strings: [...strings],
      values,
      execute: jest.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
    };
  }),
  {
    join: jest.fn((items) => ({ __joined: items })),
    ref: jest.fn((r) => r),
  }
);

jest.mock('../../db', () => ({
  db: {},
  sql: mockSql,
}));

jest.mock('../../middleware/auth', () => (req, res, next) => next());
jest.mock('../../middleware/requireRole', () => () => (req, res, next) => next());

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  jest.resetModules();
  return require('../../routes/auditLogs');
}

describe('auditLogs — cross-org isolation', () => {
  beforeEach(() => {
    capturedTagCalls.length = 0;
  });

  it('org-b user gets 403 when accessing org-a audit logs', async () => {
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

  it('applies an organization_id filter with the org id on list', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .get('/api/org/org-a/')
      .set('x-test-user', JSON.stringify(userA));

    // Tighten to the specific `organization_id = ` condition fragment first,
    // then assert the org id was interpolated into it — not a bare check
    // that some captured sql`` call anywhere mentions organization_id.
    const orgConditionCalls = capturedTagCalls.filter((c) =>
      c.strings.join('').replace(/\s+/g, ' ').trim() === 'organization_id ='
    );
    expect(orgConditionCalls.length).toBeGreaterThan(0);
    const orgScoped = orgConditionCalls.every((c) => c.values.includes(orgA.id));
    expect(orgScoped).toBe(true);
  });
});
