const express = require('express');
const request = require('supertest');

const mockDb = { selectFrom: jest.fn() };
jest.mock('../db', () => ({ db: mockDb }));

const mockRedis = { get: jest.fn(), setex: jest.fn() };
jest.mock('ioredis', () => jest.fn(() => mockRedis));

jest.mock('../middleware/responseHelpers', () => (req, res, next) => {
  res.sendError = (msg, code, status) => res.status(status).json({ error: msg, code });
  next();
});

const { requireOrg } = require('../middleware/requireOrg');

const mockOrg = { id: 'org-uuid-1', name: 'Acme', slug: 'acme' };

function makeChain(result) {
  const chain = {
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    executeTakeFirst: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function buildApp(userOverride = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.sendError = (msg, code, status) => res.status(status).json({ error: msg, code });
    next();
  });
  app.use((req, res, next) => {
    req.user = { id: 'user-1', is_super_admin: false, ...userOverride };
    next();
  });
  app.use('/api/org/:orgSlug', requireOrg, (req, res) => {
    res.json({ orgId: req.orgId, orgRole: req.orgRole });
  });
  return app;
}

describe('requireOrg middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
  });

  it('returns 404 for non-existent org slug', async () => {
    mockDb.selectFrom.mockReturnValue(makeChain(undefined));
    const res = await request(buildApp()).get('/api/org/ghost/contacts');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ORG_NOT_FOUND');
  });

  it('returns 403 when user is not a member of the org', async () => {
    mockDb.selectFrom
      .mockReturnValueOnce(makeChain(mockOrg))
      .mockReturnValueOnce(makeChain(undefined));
    const res = await request(buildApp()).get('/api/org/acme/contacts');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('attaches req.orgId and req.orgRole for a valid member', async () => {
    mockDb.selectFrom
      .mockReturnValueOnce(makeChain(mockOrg))
      .mockReturnValueOnce(makeChain({ role: 'member' }));
    const res = await request(buildApp()).get('/api/org/acme/contacts');
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe('org-uuid-1');
    expect(res.body.orgRole).toBe('member');
  });

  it('super-admin bypasses membership check and gets no orgRole', async () => {
    mockDb.selectFrom.mockReturnValueOnce(makeChain(mockOrg));
    const res = await request(buildApp({ is_super_admin: true })).get('/api/org/acme/contacts');
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe('org-uuid-1');
    expect(res.body.orgRole).toBeUndefined();
    expect(mockDb.selectFrom).toHaveBeenCalledTimes(1);
  });

  it('uses Redis cache — skips DB org lookup on cache hit', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockOrg));
    mockDb.selectFrom.mockReturnValue(makeChain({ role: 'member' }));
    const res = await request(buildApp()).get('/api/org/acme/contacts');
    expect(res.status).toBe(200);
    // org lookup skipped (came from cache), only membership lookup hit DB
    const orgLookupCalls = mockDb.selectFrom.mock.calls.filter(
      ([tbl]) => tbl === 'organizations'
    );
    expect(orgLookupCalls).toHaveLength(0);
  });
});
