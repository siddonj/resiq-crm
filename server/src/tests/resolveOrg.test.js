const express = require('express');
const request = require('supertest');

const memberships = { rows: [] };
const mockDb = {
  selectFrom: jest.fn(() => ({
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(memberships.rows),
  })),
};
jest.mock('../db', () => ({ db: mockDb }));

const { resolveOrg } = require('../middleware/resolveOrg');

function buildApp(user) {
  const app = express();
  app.use((req, res, next) => {
    res.sendError = (m, c, s) => res.status(s).json({ error: m, code: c });
    if (user) req.user = user;
    next();
  });
  app.use('/x', resolveOrg, (req, res) => res.json({ orgId: req.orgId, orgRole: req.orgRole }));
  return app;
}

describe('resolveOrg', () => {
  beforeEach(() => { memberships.rows = []; });

  it('401 when unauthenticated', async () => {
    const res = await request(buildApp(null)).get('/x');
    expect(res.status).toBe(401);
  });

  it('403 ORG_REQUIRED when user has no membership', async () => {
    memberships.rows = [];
    const res = await request(buildApp({ id: 'u1', is_super_admin: false })).get('/x');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_REQUIRED');
  });

  it('sets orgId/orgRole from the single membership', async () => {
    memberships.rows = [{ organization_id: 'org-1', role: 'admin' }];
    const res = await request(buildApp({ id: 'u1', is_super_admin: false })).get('/x');
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe('org-1');
    expect(res.body.orgRole).toBe('admin');
  });

  it('403 ORG_AMBIGUOUS when non-super-admin has multiple memberships', async () => {
    memberships.rows = [
      { organization_id: 'org-1', role: 'admin' },
      { organization_id: 'org-2', role: 'user' },
    ];
    const res = await request(buildApp({ id: 'u1', is_super_admin: false })).get('/x');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_AMBIGUOUS');
  });
});
