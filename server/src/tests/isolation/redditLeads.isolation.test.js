// server/src/tests/isolation/redditLeads.isolation.test.js
const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// redditLeads.js uses raw pool.query (../models/db) against `reddit_leads`,
// which IS in ORG_TABLES per migration 062 (organization_id NOT NULL). Capture the
// (text, params) pairs passed to pool.query so we can assert org filtering.
// reddit_search_configs / reddit_search_results are NOT in ORG_TABLES (no
// organization_id column since 062) — those routes are left unfiltered intentionally.

const capturedQueries = [];

const mockPool = {
  query: jest.fn((text, params) => {
    capturedQueries.push({ text, params });
    if (/^\s*INSERT INTO reddit_leads/i.test(text)) {
      return Promise.resolve({ rows: [{ id: 'lead-row-id' }] });
    }
    if (/^\s*UPDATE reddit_leads/i.test(text)) {
      return Promise.resolve({ rows: [{ id: 'lead-row-id', status: 'rejected' }] });
    }
    if (/^\s*SELECT \* FROM reddit_leads WHERE id/i.test(text)) {
      return Promise.resolve({ rows: [{ id: 'lead-row-id' }] });
    }
    if (/COUNT\(\*\)/i.test(text)) {
      return Promise.resolve({ rows: [{ count: '1', total_leads: '1' }] });
    }
    return Promise.resolve({ rows: [] });
  }),
};

jest.mock('../../models/db', () => mockPool);

jest.mock('../../middleware/auth', () => (req, res, next) => next());

jest.mock('../../services/redditMCPService', () => ({
  searchMultipleSubreddits: jest.fn().mockResolvedValue([
    {
      author: 'janedoe',
      post_title: 'Need a CRM',
      post_url: 'https://reddit.com/r/startups/1',
      subreddit: 'startups',
      post_content: 'Looking for a CRM solution',
      relevance_score: 0.9,
      pain_points: ['crm'],
      contact_email: 'jane@acme.com',
      contact_name: 'Jane Doe',
      discovered_at: new Date().toISOString(),
    },
    {
      author: 'johndoe',
      post_title: 'Any CRM recs?',
      post_url: 'https://reddit.com/r/smallbusiness/2',
      subreddit: 'smallbusiness',
      post_content: 'Need a good CRM',
      relevance_score: 0.8,
      pain_points: ['crm'],
      contact_email: 'john@acme.com',
      contact_name: 'John Doe',
      discovered_at: new Date().toISOString(),
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
  return require('../../routes/redditLeads');
}

const searchBody = {
  subreddits: ['startups', 'smallbusiness'],
  keywords: ['crm'],
  minRelevance: 0,
};

describe('redditLeads — cross-org isolation', () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    mockPool.query.mockClear();
  });

  it('org-b user gets 403 when accessing org-a reddit-leads endpoint', async () => {
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

  it('stamps organization_id with the org id on every reddit_leads insert from /search', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .post('/api/org/org-a/search')
      .set('x-test-user', JSON.stringify(userA))
      .send(searchBody);

    const insertQueries = capturedQueries.filter((q) => /INSERT INTO reddit_leads/.test(q.text));
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

    const insertQueries = capturedQueries.filter((q) => /INSERT INTO reddit_leads/.test(q.text));
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

    const selectQueries = capturedQueries.filter((q) => /FROM reddit_leads/.test(q.text));
    expect(selectQueries.length).toBeGreaterThan(0);
    const orgScoped = selectQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on GET /:id', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .get('/api/org/org-a/some-lead-id')
      .set('x-test-user', JSON.stringify(userA));

    const selectQueries = capturedQueries.filter((q) => /FROM reddit_leads WHERE/.test(q.text));
    expect(selectQueries.length).toBeGreaterThan(0);
    const orgScoped = selectQueries.every(
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

    const updateQueries = capturedQueries.filter((q) => /UPDATE reddit_leads/.test(q.text));
    expect(updateQueries.length).toBeGreaterThan(0);
    const orgScoped = updateQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on DELETE /:id', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .delete('/api/org/org-a/some-lead-id')
      .set('x-test-user', JSON.stringify(userA));

    const updateQueries = capturedQueries.filter((q) => /UPDATE reddit_leads/.test(q.text));
    expect(updateQueries.length).toBeGreaterThan(0);
    const orgScoped = updateQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on GET /stats/summary', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .get('/api/org/org-a/stats/summary')
      .set('x-test-user', JSON.stringify(userA));

    const statsQueries = capturedQueries.filter((q) => /FROM reddit_leads/.test(q.text));
    expect(statsQueries.length).toBeGreaterThan(0);
    const orgScoped = statsQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });

  it('applies an organization_id filter on GET /stats/by-subreddit', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app)
      .get('/api/org/org-a/stats/by-subreddit')
      .set('x-test-user', JSON.stringify(userA));

    const statsQueries = capturedQueries.filter((q) => /FROM reddit_leads/.test(q.text));
    expect(statsQueries.length).toBeGreaterThan(0);
    const orgScoped = statsQueries.every(
      (q) => /organization_id/.test(q.text) && q.params.includes(orgA.id)
    );
    expect(orgScoped).toBe(true);
  });
});
