// server/src/tests/isolation/sms.isolation.test.js
process.env.ENCRYPTION_KEY = 'a'.repeat(32);

const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// sms.js and its dependencies (models/SMS.js, models/SMSTemplate.js,
// models/client.js, services/twilioService.js) all use raw `pool.query`
// against ../../models/db (not Kysely) for sms_messages/sms_optouts/
// sms_templates/clients. Capture every (text, params) pair so we can assert
// org filtering/stamping on the target table, without hitting a real DB.

const capturedQueries = [];

const mockPool = {
  query: jest.fn((text, params) => {
    capturedQueries.push({ text, params });

    // Client.findById (getContact) — return a usable contact row so routes
    // proceed past the 404 check.
    if (/FROM clients WHERE id = \$1 AND organization_id = \$2/.test(text)) {
      return Promise.resolve({
        rows: [{ id: params[0], organization_id: params[1], phone_number: '+15555550100', name: 'Test Contact', email: 'test@example.com' }],
      });
    }

    // isOptedOut check — not opted out.
    if (/FROM sms_optouts WHERE contact_id = \$1 AND organization_id = \$2/.test(text)) {
      return Promise.resolve({ rows: [] });
    }

    // sms_optouts INSERT (manual opt-out)
    if (/INSERT INTO sms_optouts/.test(text)) {
      return Promise.resolve({ rows: [{ id: 'optout-1', ...Object.fromEntries(['contact_id', 'phone_number', 'reason', 'opted_out_by', 'organization_id'].map((k, i) => [k, params[i]])) }] });
    }

    return Promise.resolve({ rows: [] });
  }),
};

jest.mock('../../models/db', () => mockPool);

// updateContact() uses the Kysely `sql` tag from '../db' (not the raw pool) —
// stub it out so it doesn't throw; not the target of these assertions.
jest.mock('../../db', () => ({
  db: {},
  sql: Object.assign(
    jest.fn(() => ({ execute: jest.fn().mockResolvedValue({ rows: [] }) })),
    { join: jest.fn((items) => items) }
  ),
}));

jest.mock('../../middleware/auth', () => (req, res, next) => next());

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  jest.resetModules();
  return require('../../routes/sms');
}

const CONTACT_ID = 'contact-1';

describe('sms — cross-org isolation', () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    mockPool.query.mockClear();
  });

  it('org-b user gets 403 when accessing org-a sms endpoint', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post(`/api/org/org-a/${CONTACT_ID}/optout`)
      .set('x-test-user', JSON.stringify(userB));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('org-a user accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post(`/api/org/org-a/${CONTACT_ID}/optout`)
      .set('x-test-user', JSON.stringify(userA));

    expect(res.status).not.toBe(403);
  });

  it('super-admin accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .post(`/api/org/org-a/${CONTACT_ID}/optout`)
      .set('x-test-user', JSON.stringify(superAdmin));

    expect(res.status).not.toBe(403);
  });

  it('stamps organization_id with the org id on the sms_optouts insert', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .post(`/api/org/org-a/${CONTACT_ID}/optout`)
      .set('x-test-user', JSON.stringify(userA));

    // Tighten to the target table first, then assert the org filter on that
    // subset — the route fires several queries (contact lookup, opt-out
    // check, insert); asserting against "any captured query" would pass
    // even if the insert itself were unscoped.
    const optoutInserts = capturedQueries.filter((q) => /INSERT INTO sms_optouts/.test(q.text));
    expect(optoutInserts.length).toBeGreaterThan(0);
    const orgScoped = optoutInserts.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('filters the Client.findById (getContact) lookup by organization_id', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .post(`/api/org/org-a/${CONTACT_ID}/optout`)
      .set('x-test-user', JSON.stringify(userA));

    const clientLookups = capturedQueries.filter((q) => /FROM clients WHERE id = \$1/.test(q.text));
    expect(clientLookups.length).toBeGreaterThan(0);
    const orgScoped = clientLookups.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });
});
