// server/src/tests/isolation/outbound.isolation.test.js
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

jest.mock('../../services/outboundScoring', () => ({
  scoreLead: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../services/appSettings', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../utils/outboundUtils', () => new Proxy({}, {
  get: (_, prop) => {
    if (prop === 'VALID_OUTBOUND_SAVED_VIEW_SCOPES') return new Set(['outbound_leads']);
    if (prop === 'mapSavedViewRow') return (r) => r;
    return jest.fn(() => (prop.startsWith('build') || prop.startsWith('format') || prop.startsWith('normalize') ? [] : null));
  },
}));

jest.mock('../../services/outbound/leadService', () => ({
  importLeads: jest.fn(),
  getLeads: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/outbound/draftService', () => ({
  getDrafts: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/outbound/sequenceService', () => ({
  getSequences: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/outbound/campaignService', () => ({
  getCampaigns: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../middleware/validateZod', () => ({
  validateBody: () => (req, res, next) => { req.validatedBody = req.body; next(); },
  validateQuery: () => (req, res, next) => { req.validatedQuery = req.query; next(); },
}));

jest.mock('../../utils/outboundSchemas', () => ({
  ImportCsvSchema: {},
  LeadFiltersSchema: {},
  CreateCampaignSchema: {},
  UpdateCampaignStatusSchema: {},
  CreateDraftSchema: {},
  EnrollSequenceSchema: {},
  ChangeSequenceStateSchema: {},
  BulkActionSchema: {},
  SuppressionSchema: {},
  CreateWorkflowRuleSchema: {},
  CreateMultifamilyObjectSchema: {},
  AssociateToObjectSchema: {},
  SaveGoalsSchema: {},
  WorkspaceConfigSchema: {},
}));

jest.mock('multer', () => {
  const m = () => ({
    single: () => (req, res, next) => next(),
    array: () => (req, res, next) => next(),
  });
  m.memoryStorage = jest.fn(() => ({}));
  m.diskStorage = jest.fn(() => ({}));
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
  return require('../../routes/outboundAutomation');
}

describe('outbound — cross-org isolation', () => {
  beforeEach(() => {
    capturedFilters.length = 0;
  });

  it('org-b user gets 403 when accessing org-a outbound routes', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/saved-views')
      .set('x-test-user', JSON.stringify(userB));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('org-a user accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/saved-views')
      .set('x-test-user', JSON.stringify(userA));

    expect(res.status).not.toBe(403);
  });

  it('super-admin accesses org-a endpoint — request reaches route (not blocked)', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/saved-views')
      .set('x-test-user', JSON.stringify(superAdmin));

    expect(res.status).not.toBe(403);
  });
});
