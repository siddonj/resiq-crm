// server/src/tests/isolation/multiSourceLeads.isolation.test.js
const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// multiSourceLeads.js uses raw pool.query (../models/db) against `unified_leads`,
// which IS in ORG_TABLES per migration 062 (organization_id NOT NULL). Capture the
// (text, params) pairs passed to pool.query so we can assert org filtering.

const capturedQueries = [];

const mockPool = {
  query: jest.fn((text, params) => {
    capturedQueries.push({ text, params });
    if (/^\s*INSERT INTO unified_leads/i.test(text)) {
      return Promise.resolve({ rows: [{ id: 'lead-row-id' }] });
    }
    if (/^\s*UPDATE unified_leads/i.test(text)) {
      return Promise.resolve({ rows: [{ id: 'lead-row-id', status: 'rejected' }] });
    }
    return Promise.resolve({ rows: [] });
  }),
};

jest.mock('../../models/db', () => mockPool);

jest.mock('../../middleware/auth', () => (req, res, next) => next());

jest.mock('../../services/appSettings', () => ({
  getSetting: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../services/multiSourceLeadService', () => ({
  searchAllSources: jest.fn().mockResolvedValue([
    {
      sourceId: 'reddit-startups-janedoe',
      source: 'reddit',
      author: 'janedoe',
      title: 'Need a CRM',
      content: 'Looking for a CRM solution',
      sourceUrl: 'https://reddit.com/r/startups',
      company: 'Acme',
      relevanceScore: 0.9,
      keywords: ['crm'],
      email: 'jane@acme.com',
      subreddit: 'startups',
    },
    {
      sourceId: 'linkedin-acme-johndoe',
      source: 'linkedin',
      author: 'John Doe',
      name: 'John Doe',
      title: 'Founder',
      content: 'Looking for a CRM solution',
      sourceUrl: 'https://linkedin.com/in/johndoe',
      company: 'Acme',
      relevanceScore: 0.95,
      keywords: ['crm'],
      email: 'john@acme.com',
      linkedinUrl: 'https://linkedin.com/in/johndoe',
    },
  ]),
}));

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  jest.resetModules();
  return require('../../routes/multiSourceLeads');
}

const searchBody = {
  allowSynthetic: true,
  sources: ['reddit', 'linkedin'],
  subreddits: ['startups'],
  keywords: ['crm'],
  minRelevance: 0,
};

describe('multiSourceLeads — cross-org isolation', () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    mockPool.query.mockClear();
  });

  it('org-b user gets 403 when accessing org-a multi-source-leads endpoint', async () => {
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

  it('stamps organization_id with the org id on every unified_leads insert from /search', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .post('/api/org/org-a/search')
      .set('x-test-user', JSON.stringify(userA))
      .send(searchBody);

    const insertQueries = capturedQueries.filter((q) => /INSERT INTO unified_leads/.test(q.text));
    expect(insertQueries.length).toBeGreaterThan(0);
    // Two leads returned by the mocked service — every insert must be org-stamped.
    const allOrgScoped = insertQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(allOrgScoped).toBe(true);
  });

  it('does not reassign organization_id in the ON CONFLICT clause', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .post('/api/org/org-a/search')
      .set('x-test-user', JSON.stringify(userA))
      .send(searchBody);

    const insertQueries = capturedQueries.filter((q) => /INSERT INTO unified_leads/.test(q.text));
    expect(insertQueries.length).toBeGreaterThan(0);
    const conflictClauses = insertQueries.map((q) => q.text.split(/ON CONFLICT/i)[1] || '');
    const noneReassignOrgId = conflictClauses.every(
      (clause) => !/organization_id\s*=/i.test(clause)
    );
    expect(noneReassignOrgId).toBe(true);
  });

  it('applies an organization_id filter with the org id on list (GET /)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .get('/api/org/org-a')
      .set('x-test-user', JSON.stringify(userA));

    const selectQueries = capturedQueries.filter((q) => /FROM unified_leads/.test(q.text));
    expect(selectQueries.length).toBeGreaterThan(0);
    const orgScoped = selectQueries.some(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on PATCH /:id', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .patch('/api/org/org-a/some-lead-id')
      .set('x-test-user', JSON.stringify(userA))
      .send({ status: 'contacted' });

    const updateQueries = capturedQueries.filter((q) => /UPDATE unified_leads/.test(q.text));
    expect(updateQueries.length).toBeGreaterThan(0);
    const orgScoped = updateQueries.some(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on DELETE /:id', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .delete('/api/org/org-a/some-lead-id')
      .set('x-test-user', JSON.stringify(userA));

    const updateQueries = capturedQueries.filter((q) => /UPDATE unified_leads/.test(q.text));
    expect(updateQueries.length).toBeGreaterThan(0);
    const orgScoped = updateQueries.some(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on GET /stats/summary', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .get('/api/org/org-a/stats/summary')
      .set('x-test-user', JSON.stringify(userA));

    const statsQueries = capturedQueries.filter((q) => /FROM unified_leads/.test(q.text));
    expect(statsQueries.length).toBeGreaterThan(0);
    const orgScoped = statsQueries.some(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on GET /stats/by-source', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .get('/api/org/org-a/stats/by-source')
      .set('x-test-user', JSON.stringify(userA));

    const statsQueries = capturedQueries.filter((q) => /FROM unified_leads/.test(q.text));
    expect(statsQueries.length).toBeGreaterThan(0);
    const orgScoped = statsQueries.some(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });
});
