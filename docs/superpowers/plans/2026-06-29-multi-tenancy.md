# Multi-Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add row-level multi-tenancy to resiq-crm so each consulting client gets a fully isolated org workspace, accessible via `/org/:slug/*` URLs, while super-admins retain cross-org visibility.

**Architecture:** Every tenant-scoped table gains an `organization_id` FK column. A `requireOrg` Express middleware (backed by a Redis cache) resolves and validates the org from the URL slug on every protected request. The React frontend uses an `OrgShell` wrapper and a module-level slug ref so all existing API calls automatically route to the correct org with zero changes to individual API modules.

**Tech Stack:** Node.js/Express/CommonJS, Kysely ORM (`server/src/db.js`), PostgreSQL, Redis, ioredis, Jest + supertest for backend tests; React 18, React Router v6, TanStack Query v5, Axios for frontend.

## Global Constraints

- All new server files use CommonJS (`require`/`module.exports`) — the server is not yet TypeScript
- Kysely is the only query builder — no raw `pool.query()` calls in new code
- All responses go through `res.sendSuccess(data, meta)` and `res.sendError(message, code, status)` from `server/src/middleware/responseHelpers.js`
- Migration files are numbered sequentially; next available is **062**
- Migration filename convention: `NNN-description.sql` (e.g. `062-multi-tenancy.sql`)
- Jest tests live in `server/src/tests/` and match `**/*.test.js`
- Frontend files use ES modules (import/export); `.jsx` extension for components
- Token stored in `localStorage` as `resiq_token`; user stored as `resiq_user`
- Do not modify `client/src/ClientApp.jsx` or `/client/*` routes (client portal is a separate app)

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `database/migrations/062-multi-tenancy.sql` | Schema: orgs, members, invites tables; org_id columns; is_super_admin; default-org backfill |
| `server/src/middleware/requireOrg.js` | Resolve org from URL slug, validate membership, attach `req.orgId` |
| `server/src/routes/orgs.js` | Global org CRUD: list-all, create, mine, resolve-by-slug |
| `server/src/routes/members.js` | Org-scoped member management: list, invite, update role, remove |
| `server/src/tests/helpers/orgTestHelpers.js` | Shared test utilities: createTestOrg, createTestUser, etc. |
| `server/src/tests/requireOrg.test.js` | Unit tests for requireOrg middleware |
| `server/src/tests/isolation/contacts.isolation.test.js` | Cross-org isolation test — contacts |
| `server/src/tests/isolation/deals.isolation.test.js` | Cross-org isolation test — deals |
| `server/src/tests/isolation/projects.isolation.test.js` | Cross-org isolation test — projects |
| `server/src/tests/isolation/invoices.isolation.test.js` | Cross-org isolation test — invoices |
| `server/src/tests/isolation/outbound.isolation.test.js` | Cross-org isolation test — outbound |
| `client/src/context/OrgContext.jsx` | OrgShell component, OrgContext, useOrg hook, getActiveOrgSlug |
| `client/src/pages/OrgRedirect.jsx` | Post-login landing: redirect single-org users, show OrgPicker for multi-org |
| `client/src/components/OrgPicker.jsx` | Grid UI for selecting an org (used by super-admins and multi-org users) |
| `client/src/pages/Admin.jsx` | Super-admin panel: list all orgs, create org, member management |

### Modified files
| File | Change |
|------|--------|
| `server/src/middleware/auth.js` | Also fetch `is_super_admin` from DB; include in `req.user` |
| `server/src/db.js` | Add `orgWhere(orgId)` and `orgUserWhere(orgId, userId)` exports |
| `server/src/index.js` | Mount all tenant-scoped routes under `/api/org/:orgSlug` via `orgRouter`; add `/api/orgs` and `/api/org/:orgSlug/members` |
| `server/src/routes/contacts.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/deals.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/activities.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/proposals.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/invoices.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/timeEntries.js` | Add `orgUserWhere(req.orgId, req.user.id)` to every query |
| `server/src/routes/projects.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/portfolios.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/reminders.js` | Add `orgUserWhere(req.orgId, req.user.id)` to every query |
| `server/src/routes/forms.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/tickets.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/sequences.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/workflows.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/outboundAutomation.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/calendar.js` | Add `orgUserWhere(req.orgId, req.user.id)` to every query |
| `server/src/routes/clients.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/leads.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/engagement.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/teams.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/sharing.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/analytics.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/auditLogs.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/compliance.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/deliverability.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/redditLeads.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/multiSourceLeads.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/automation.js` | Add `orgWhere(req.orgId)` to every query |
| `server/src/routes/agents.js` | Add `orgWhere(req.orgId)` to every query |
| `server/jest.config.js` | Add `server/src/tests/isolation/` to roots |
| `client/src/App.jsx` | Restructure routes: add `/org/:orgSlug` parent with `OrgShell`; add `/admin`; change `/` to `OrgRedirect` |
| `client/src/api/api.js` | Add request interceptor that prepends `/org/${slug}` to tenant-scoped URLs |
| `client/src/context/AuthContext.jsx` | Store and expose `user.is_super_admin` |
| `client/src/components/DashboardLayout.jsx` | Pass `orgSlug` to nav links so sidebar routes stay within `/org/:slug/*` |

---

## Task 1: Database Migration

**Files:**
- Create: `database/migrations/062-multi-tenancy.sql`

**Interfaces:**
- Produces: `organizations(id, name, slug, created_at, updated_at)`, `organization_members(id, organization_id, user_id, role, created_at)`, `organization_invites(id, organization_id, email, role, token, expires_at, accepted_at, created_at)`, `organization_id UUID` column on all tenant-scoped tables, `is_super_admin BOOLEAN` on `users`

- [ ] **Step 1: Write the migration file**

```sql
-- database/migrations/062-multi-tenancy.sql
-- Migration 062: Row-level multi-tenancy
-- Creates organizations, members, invites tables; adds organization_id
-- to all tenant-scoped tables; backfills a Default org for existing data.

BEGIN;

-- ── New tables ──────────────────────────────────────────────────────────────

CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'member'
                   CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

CREATE TABLE organization_invites (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'member'
                   CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  token            TEXT NOT NULL UNIQUE,
  expires_at       TIMESTAMPTZ NOT NULL,
  accepted_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Super-admin flag ─────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── organization_id columns on all tenant-scoped tables ──────────────────────

ALTER TABLE contacts                ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE deals                   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE activities              ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE proposals               ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE invoices                ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE time_entries            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE projects                ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE project_tasks           ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE portfolios              ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE reminders               ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE forms                   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE tickets                 ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE sequences               ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE workflows               ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE clients                 ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE calendar_events         ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE leads                   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE teams                   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_leads          ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_campaigns      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_drafts         ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_sequence_steps ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE shared_resources        ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE engagement_events       ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE audit_logs              ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE reddit_leads            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- ── Default org + backfill ───────────────────────────────────────────────────

DO $$
DECLARE
  default_org_id UUID;
BEGIN
  INSERT INTO organizations (name, slug) VALUES ('Default', 'default')
  RETURNING id INTO default_org_id;

  -- Backfill all tenant-scoped tables
  UPDATE contacts                SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE deals                   SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE activities              SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE proposals               SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE invoices                SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE time_entries            SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE projects                SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE project_tasks           SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE portfolios              SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE reminders               SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE forms                   SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE tickets                 SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE sequences               SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE workflows               SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE clients                 SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE calendar_events         SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE leads                   SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE teams                   SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE outbound_leads          SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE outbound_campaigns      SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE outbound_drafts         SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE outbound_sequence_steps SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE shared_resources        SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE engagement_events       SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE audit_logs              SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE reddit_leads            SET organization_id = default_org_id WHERE organization_id IS NULL;

  -- Mark super-admins
  UPDATE users SET is_super_admin = TRUE WHERE email = 'siddonj@gmail.com';

  -- Add super-admins as owners of the default org
  INSERT INTO organization_members (organization_id, user_id, role)
  SELECT default_org_id, id, 'owner'
  FROM users WHERE is_super_admin = TRUE
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  -- Add all other existing users as members of default org
  INSERT INTO organization_members (organization_id, user_id, role)
  SELECT default_org_id, id, 'member'
  FROM users WHERE is_super_admin = FALSE
  ON CONFLICT (organization_id, user_id) DO NOTHING;
END $$;

-- ── Performance indexes ──────────────────────────────────────────────────────

CREATE INDEX idx_org_members_org_user ON organization_members(organization_id, user_id);
CREATE INDEX idx_contacts_org         ON contacts(organization_id);
CREATE INDEX idx_deals_org            ON deals(organization_id);
CREATE INDEX idx_projects_org         ON projects(organization_id);
CREATE INDEX idx_invoices_org         ON invoices(organization_id);
CREATE INDEX idx_outbound_leads_org   ON outbound_leads(organization_id);
CREATE INDEX idx_activities_org       ON activities(organization_id);

COMMIT;
```

- [ ] **Step 2: Run the migration against local dev DB**

```bash
npm run migrate
```

Expected: migration 062 listed as applied, no errors. Verify:
```bash
psql $DATABASE_URL -c "\d organizations"
psql $DATABASE_URL -c "SELECT name, slug FROM organizations;"
# Should show: Default | default
```

- [ ] **Step 3: Commit**

```bash
git add database/migrations/062-multi-tenancy.sql
git commit -m "feat(db): add organizations, members, invites tables + org_id backfill (migration 062)"
```

---

## Task 2: Kysely Helpers + Auth Middleware Update

**Files:**
- Modify: `server/src/db.js`
- Modify: `server/src/middleware/auth.js`

**Interfaces:**
- Consumes: existing `Kysely` instance exported as `db`, existing `pool` from `./models/db`
- Produces:
  - `orgWhere(orgId: string) → (qb) => qb` — filters a Kysely query by `organization_id`
  - `orgUserWhere(orgId: string, userId: string) → (qb) => qb` — filters by both `organization_id` and `user_id`
  - `req.user.is_super_admin: boolean` — available after `authenticate` middleware runs

- [ ] **Step 1: Add `orgWhere` and `orgUserWhere` to `server/src/db.js`**

Open `server/src/db.js`. The last line currently reads:
```js
module.exports = { db, sql, ownershipWhere, pool };
```

Add these two functions immediately before that line:

```js
/**
 * Filters a Kysely query to a specific organization.
 * Use on all tenant-scoped tables.
 * @param {string} orgId
 */
function orgWhere(orgId) {
  return (qb) => qb.where('organization_id', '=', orgId);
}

/**
 * Filters a Kysely query to a specific org AND user.
 * Use for personal records (reminders, time_entries, calendar_events).
 * @param {string} orgId
 * @param {string} userId
 */
function orgUserWhere(orgId, userId) {
  return (qb) => qb
    .where('organization_id', '=', orgId)
    .where('user_id', '=', userId);
}

module.exports = { db, sql, ownershipWhere, orgWhere, orgUserWhere, pool };
```

- [ ] **Step 2: Update `server/src/middleware/auth.js` to fetch `is_super_admin`**

Replace the SELECT query in `auth.js` (currently line ~15):

```js
// BEFORE:
const result = await pool.query(
  'SELECT id, name, email, role, is_active FROM users WHERE id = $1',
  [decoded.id]
);

// AFTER:
const result = await pool.query(
  'SELECT id, name, email, role, is_active, is_super_admin FROM users WHERE id = $1',
  [decoded.id]
);
```

Replace the `req.user` assignment (currently around line ~28):

```js
// BEFORE:
req.user = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
};

// AFTER:
req.user = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  is_super_admin: user.is_super_admin === true,
};
```

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js server/src/middleware/auth.js
git commit -m "feat(backend): add orgWhere/orgUserWhere helpers; expose is_super_admin in auth middleware"
```

---

## Task 3: `requireOrg` Middleware

**Files:**
- Create: `server/src/middleware/requireOrg.js`
- Create: `server/src/tests/requireOrg.test.js`

**Interfaces:**
- Consumes: `db` from `../db`, `redis` client (ioredis — check how existing code imports it; look at `server/src/workers/` for the pattern), `res.sendError` from responseHelpers middleware
- Produces: `req.orgId: string`, `req.org: { id, name, slug }`, `req.orgRole: string | undefined` (undefined for super-admins)

- [ ] **Step 1: Find how Redis is imported in existing server code**

```bash
grep -r "require.*redis\|ioredis" /Users/siddonj/Repos/resiq-crm/server/src --include="*.js" -l | head -5
grep -r "new Redis\|createClient" /Users/siddonj/Repos/resiq-crm/server/src --include="*.js" | head -3
```

Note the import pattern (likely `const redis = require('../services/redisClient')` or similar). Use that same import in `requireOrg.js`. If no shared Redis client exists, create a minimal one:
```js
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
```

- [ ] **Step 2: Write the failing test**

```js
// server/src/tests/requireOrg.test.js
const express = require('express');
const request = require('supertest');

// Mock db
const mockDb = {
  selectFrom: jest.fn(),
};
jest.mock('../db', () => ({ db: mockDb, sql: {} }));

// Mock redis
const mockRedis = {
  get: jest.fn(),
  setex: jest.fn(),
};
jest.mock('ioredis', () => jest.fn(() => mockRedis));

// Mock responseHelpers (wires res.sendError)
jest.mock('../middleware/responseHelpers', () => (req, res, next) => {
  res.sendError = (msg, code, status) => res.status(status).json({ error: msg, code });
  next();
});

const { requireOrg } = require('../middleware/requireOrg');

function buildApp(userOverride = {}) {
  const app = express();
  app.use(express.json());
  app.use(require('../middleware/responseHelpers'));
  app.use((req, res, next) => {
    req.user = { id: 'user-1', is_super_admin: false, ...userOverride };
    next();
  });
  app.use('/api/org/:orgSlug', requireOrg, (req, res) => {
    res.json({ orgId: req.orgId, orgRole: req.orgRole });
  });
  return app;
}

const mockOrg = { id: 'org-uuid-1', name: 'Acme', slug: 'acme' };

function makeKyselyChain(result) {
  const chain = {
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    executeTakeFirst: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

describe('requireOrg middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
  });

  it('returns 404 for non-existent org slug', async () => {
    mockDb.selectFrom.mockReturnValue(makeKyselyChain(undefined));

    const res = await request(buildApp())
      .get('/api/org/ghost/contacts');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ORG_NOT_FOUND');
  });

  it('returns 403 when user is not a member of the org', async () => {
    mockDb.selectFrom
      .mockReturnValueOnce(makeKyselyChain(mockOrg))  // org lookup
      .mockReturnValueOnce(makeKyselyChain(undefined)); // membership lookup

    const res = await request(buildApp())
      .get('/api/org/acme/contacts');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('attaches req.orgId and req.orgRole for a valid member', async () => {
    mockDb.selectFrom
      .mockReturnValueOnce(makeKyselyChain(mockOrg))
      .mockReturnValueOnce(makeKyselyChain({ role: 'member' }));

    const res = await request(buildApp())
      .get('/api/org/acme/contacts');

    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe('org-uuid-1');
    expect(res.body.orgRole).toBe('member');
  });

  it('super-admin bypasses membership check and gets no orgRole', async () => {
    mockDb.selectFrom
      .mockReturnValueOnce(makeKyselyChain(mockOrg)); // only one DB call

    const res = await request(buildApp({ is_super_admin: true }))
      .get('/api/org/acme/contacts');

    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe('org-uuid-1');
    expect(res.body.orgRole).toBeUndefined();
    // Should only have called selectFrom once (org lookup, no membership lookup)
    expect(mockDb.selectFrom).toHaveBeenCalledTimes(1);
  });

  it('uses Redis cache — only one DB call on second request', async () => {
    // First request: cache miss
    mockDb.selectFrom
      .mockReturnValueOnce(makeKyselyChain(mockOrg))
      .mockReturnValueOnce(makeKyselyChain({ role: 'admin' }));

    await request(buildApp())
      .get('/api/org/acme/contacts');

    // Second request: cache hit
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockOrg));
    mockDb.selectFrom.mockReturnValueOnce(makeKyselyChain({ role: 'admin' }));

    await request(buildApp())
      .get('/api/org/acme/contacts');

    // org lookup called once total (second hit came from Redis)
    const orgLookupCalls = mockDb.selectFrom.mock.calls.filter(
      ([tbl]) => tbl === 'organizations'
    );
    expect(orgLookupCalls).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
cd server && npx jest src/tests/requireOrg.test.js --no-coverage
```

Expected: `Cannot find module '../middleware/requireOrg'`

- [ ] **Step 4: Implement `server/src/middleware/requireOrg.js`**

First run the grep from Step 1 and substitute the actual redis import. The implementation below uses ioredis directly — replace if the project has a shared client:

```js
// server/src/middleware/requireOrg.js
const { db } = require('../db');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const CACHE_TTL = 300; // 5 minutes

async function requireOrg(req, res, next) {
  const { orgSlug } = req.params;
  const cacheKey = `org:slug:${orgSlug}`;

  try {
    // Try Redis cache first
    let org = null;
    const cached = await redis.get(cacheKey);
    if (cached) {
      org = JSON.parse(cached);
    } else {
      org = await db.selectFrom('organizations')
        .where('slug', '=', orgSlug)
        .select(['id', 'name', 'slug'])
        .executeTakeFirst();

      if (!org) {
        return res.sendError('Organization not found', 'ORG_NOT_FOUND', 404);
      }
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(org));
    }

    // Super-admins bypass membership check
    if (!req.user.is_super_admin) {
      const membership = await db.selectFrom('organization_members')
        .where('organization_id', '=', org.id)
        .where('user_id', '=', req.user.id)
        .select(['role'])
        .executeTakeFirst();

      if (!membership) {
        return res.sendError('Access denied', 'ORG_FORBIDDEN', 403);
      }
      req.orgRole = membership.role;
    }

    req.orgId = org.id;
    req.org   = org;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireOrg };
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd server && npx jest src/tests/requireOrg.test.js --no-coverage
```

Expected: 5 tests passing

- [ ] **Step 6: Commit**

```bash
git add server/src/middleware/requireOrg.js server/src/tests/requireOrg.test.js
git commit -m "feat(backend): add requireOrg middleware with Redis cache + unit tests"
```

---

## Task 4: Org & Member API Routes

**Files:**
- Create: `server/src/routes/orgs.js`
- Create: `server/src/routes/members.js`

**Interfaces:**
- Consumes: `db`, `orgWhere` from `../db`; `auth` from `../middleware/auth`; `requireOrg` from `../middleware/requireOrg`
- Produces:
  - `GET /api/orgs` → `{ data: Organization[] }` (super-admin only)
  - `POST /api/orgs` → `{ data: Organization }` (super-admin only)
  - `GET /api/orgs/mine` → `{ data: Organization[] }`
  - `GET /api/orgs/:slug` → `{ data: Organization }`
  - `GET /api/org/:orgSlug/members` → `{ data: Member[] }`
  - `POST /api/org/:orgSlug/members/invite` → `{ data: { message } }`
  - `PATCH /api/org/:orgSlug/members/:userId` → `{ data: Member }`
  - `DELETE /api/org/:orgSlug/members/:userId` → `{ data: { message } }`

- [ ] **Step 1: Create `server/src/routes/orgs.js`**

```js
// server/src/routes/orgs.js
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const auth = require('../middleware/auth');
const { requireOrg } = require('../middleware/requireOrg');

const router = express.Router();

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function requireSuperAdmin(req, res, next) {
  if (!req.user.is_super_admin) {
    return res.sendError('Super-admin access required', 'FORBIDDEN', 403);
  }
  next();
}

// GET /api/orgs — super-admin: list all orgs with member counts
router.get('/', auth, requireSuperAdmin, async (req, res) => {
  try {
    const orgs = await db.selectFrom('organizations as o')
      .leftJoin('organization_members as om', 'om.organization_id', 'o.id')
      .select([
        'o.id',
        'o.name',
        'o.slug',
        'o.created_at',
        db.fn.count('om.id').as('member_count'),
      ])
      .groupBy(['o.id', 'o.name', 'o.slug', 'o.created_at'])
      .orderBy('o.created_at', 'asc')
      .execute();
    res.sendSuccess(orgs);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// GET /api/orgs/mine — current user's orgs
router.get('/mine', auth, async (req, res) => {
  try {
    let orgs;
    if (req.user.is_super_admin) {
      orgs = await db.selectFrom('organizations')
        .selectAll()
        .orderBy('created_at', 'asc')
        .execute();
    } else {
      orgs = await db.selectFrom('organizations as o')
        .innerJoin('organization_members as om', 'om.organization_id', 'o.id')
        .where('om.user_id', '=', req.user.id)
        .select(['o.id', 'o.name', 'o.slug', 'o.created_at', 'om.role'])
        .orderBy('o.created_at', 'asc')
        .execute();
    }
    res.sendSuccess(orgs);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// GET /api/orgs/:slug — resolve org by slug (used by OrgShell)
router.get('/:slug', auth, async (req, res) => {
  try {
    const org = await db.selectFrom('organizations')
      .where('slug', '=', req.params.slug)
      .select(['id', 'name', 'slug', 'created_at'])
      .executeTakeFirst();

    if (!org) return res.sendError('Organization not found', 'ORG_NOT_FOUND', 404);

    // Non-super-admins must be members
    if (!req.user.is_super_admin) {
      const membership = await db.selectFrom('organization_members')
        .where('organization_id', '=', org.id)
        .where('user_id', '=', req.user.id)
        .select('role')
        .executeTakeFirst();
      if (!membership) return res.sendError('Access denied', 'ORG_FORBIDDEN', 403);
    }

    res.sendSuccess(org);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// POST /api/orgs — super-admin: create org
router.post('/', auth, requireSuperAdmin, async (req, res) => {
  const { name, slug: rawSlug } = req.body;
  if (!name) return res.sendError('name is required', 'VALIDATION_ERROR', 400);

  const slug = rawSlug ? rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-') : slugify(name);

  try {
    const existing = await db.selectFrom('organizations')
      .where('slug', '=', slug)
      .select('id')
      .executeTakeFirst();
    if (existing) return res.sendError('Slug already taken', 'SLUG_CONFLICT', 409);

    const org = await db.transaction().execute(async (trx) => {
      const [created] = await trx.insertInto('organizations')
        .values({ name, slug })
        .returningAll()
        .execute();

      await trx.insertInto('organization_members')
        .values({ organization_id: created.id, user_id: req.user.id, role: 'owner' })
        .execute();

      return created;
    });

    res.sendSuccess(org);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

module.exports = router;
```

- [ ] **Step 2: Create `server/src/routes/members.js`**

```js
// server/src/routes/members.js
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');

const router = express.Router({ mergeParams: true });

// requireOrg and auth already applied by the orgRouter in index.js

// GET /api/org/:orgSlug/members
router.get('/', async (req, res) => {
  try {
    const members = await db.selectFrom('organization_members as om')
      .innerJoin('users as u', 'u.id', 'om.user_id')
      .where('om.organization_id', '=', req.orgId)
      .select([
        'om.id',
        'om.role',
        'om.created_at',
        'u.id as user_id',
        'u.name',
        'u.email',
      ])
      .orderBy('om.created_at', 'asc')
      .execute();
    res.sendSuccess(members);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// POST /api/org/:orgSlug/members/invite
router.post('/invite', async (req, res) => {
  const { email, role = 'member' } = req.body;
  if (!email) return res.sendError('email is required', 'VALIDATION_ERROR', 400);
  if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
    return res.sendError('Invalid role', 'VALIDATION_ERROR', 400);
  }

  try {
    // Check if user already exists
    const existingUser = await db.selectFrom('users')
      .where('email', '=', email.toLowerCase())
      .select(['id'])
      .executeTakeFirst();

    if (existingUser) {
      // Add directly to org
      await db.insertInto('organization_members')
        .values({ organization_id: req.orgId, user_id: existingUser.id, role })
        .onConflict((oc) => oc.columns(['organization_id', 'user_id']).doUpdateSet({ role }))
        .execute();
      return res.sendSuccess({ message: 'User added to organization' });
    }

    // Create pending invite
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insertInto('organization_invites')
      .values({
        organization_id: req.orgId,
        email: email.toLowerCase(),
        role,
        token,
        expires_at: expiresAt,
      })
      .execute();

    // Invite email wiring is a follow-up task.
    // For now the token is returned in the response so it can be manually shared.
    // Wire to the existing nodemailer/sendgrid service in server/src/services/email.js
    // when ready. The database row is already created and will work once the email is sent.

    res.sendSuccess({ message: 'Invite sent', token });
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// PATCH /api/org/:orgSlug/members/:userId — update role
router.patch('/:userId', async (req, res) => {
  const { role } = req.body;
  if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
    return res.sendError('Invalid role', 'VALIDATION_ERROR', 400);
  }

  try {
    const updated = await db.updateTable('organization_members')
      .set({ role })
      .where('organization_id', '=', req.orgId)
      .where('user_id', '=', req.params.userId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) return res.sendError('Member not found', 'NOT_FOUND', 404);
    res.sendSuccess(updated);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// DELETE /api/org/:orgSlug/members/:userId — remove member
router.delete('/:userId', async (req, res) => {
  try {
    const deleted = await db.deleteFrom('organization_members')
      .where('organization_id', '=', req.orgId)
      .where('user_id', '=', req.params.userId)
      .returningAll()
      .executeTakeFirst();

    if (!deleted) return res.sendError('Member not found', 'NOT_FOUND', 404);
    res.sendSuccess({ message: 'Member removed' });
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

module.exports = router;
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/orgs.js server/src/routes/members.js
git commit -m "feat(backend): add orgs and members API routes"
```

---

## Task 5: Wire Routes in `index.js`

**Files:**
- Modify: `server/src/index.js`

**Interfaces:**
- Consumes: `requireOrg` from `./middleware/requireOrg`; `orgsRouter` from `./routes/orgs`; `membersRouter` from `./routes/members`; all existing route files
- Produces: `/api/org/:orgSlug/*` namespace for all tenant-scoped routes; `/api/orgs` for global org routes; `/api/org/:orgSlug/members` for member management

- [ ] **Step 1: Add imports at top of `server/src/index.js`**

After the last existing `require('./routes/...')` line, add:

```js
const orgsRoutes = require('./routes/orgs');
const membersRoutes = require('./routes/members');
const { requireOrg } = require('./middleware/requireOrg');
// The auth middleware (not the auth routes) — used at orgRouter level
const authMiddleware = require('./middleware/auth');
```

Note: `authMiddleware` here is `server/src/middleware/auth.js` (the JWT middleware), NOT `./routes/auth` (the auth route file). Individual route files already apply it per-route, but applying it at the orgRouter level ensures `req.user` is populated before `requireOrg` runs. Running it twice is harmless.

- [ ] **Step 2: Add the global orgs route before the orgRouter block**

Find the section of `index.js` where routes are mounted (the block of `app.use('/api/...')` lines). Add these two lines **before** the existing tenant-scoped mounts:

```js
// Global org management (not under :orgSlug)
app.use('/api/orgs', orgsRoutes);
```

- [ ] **Step 3: Replace the existing tenant-scoped route mounts with an orgRouter**

Find and **replace** this entire block in `index.js`:

```js
app.use('/api/contacts', contactsRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/sequences', sequencesRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/audit-logs', auditLogsRoutes);
app.use('/api/sharing', sharingRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/proposals', proposalsRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/time-entries', timeEntriesRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/multi-source-leads', multiSourceLeadsRoutes);
app.use('/api/outbound', outboundLimiter, outboundAutomationRoutes);
app.use('/api/app-settings', appSettingsRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/unsubscribe', unsubscribeRoutes);
app.use('/api/deliverability', deliverabilityRoutes);
app.use('/api/engagement', engagementRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/reddit-leads', redditLeadsRoutes);
app.use('/api/track', trackRoutes);
app.use('/api/portfolios', portfoliosRoutes);
app.use('/api/automation', automationRoutes);
```

With:

```js
// ── Org-scoped routes ─────────────────────────────────────────────────────
const orgRouter = express.Router({ mergeParams: true });
orgRouter.use(authMiddleware);  // server/src/middleware/auth.js — sets req.user
orgRouter.use(requireOrg);      // sets req.orgId, req.org, req.orgRole

orgRouter.use('/contacts',        contactsRoutes);
orgRouter.use('/deals',           dealsRoutes);
orgRouter.use('/workflows',       workflowsRoutes);
orgRouter.use('/sequences',       sequencesRoutes);
orgRouter.use('/integrations',    integrationsRoutes);
orgRouter.use('/projects',        projectsRoutes);
orgRouter.use('/analytics',       analyticsRoutes);
orgRouter.use('/users',           usersRoutes);
orgRouter.use('/teams',           teamsRoutes);
orgRouter.use('/audit-logs',      auditLogsRoutes);
orgRouter.use('/sharing',         sharingRoutes);
orgRouter.use('/reminders',       remindersRoutes);
orgRouter.use('/activities',      activitiesRoutes);
orgRouter.use('/proposals',       proposalsRoutes);
orgRouter.use('/invoices',        invoicesRoutes);
orgRouter.use('/time-entries',    timeEntriesRoutes);
orgRouter.use('/calendar',        calendarRoutes);
orgRouter.use('/sms',             smsRoutes);
orgRouter.use('/webhooks',        webhookRoutes);
orgRouter.use('/agents',          agentsRoutes);
orgRouter.use('/forms',           formsRoutes);
orgRouter.use('/leads',           leadsRoutes);
orgRouter.use('/multi-source-leads', multiSourceLeadsRoutes);
orgRouter.use('/outbound',        outboundLimiter, outboundAutomationRoutes);
orgRouter.use('/app-settings',    appSettingsRoutes);
orgRouter.use('/compliance',      complianceRoutes);
orgRouter.use('/deliverability',  deliverabilityRoutes);
orgRouter.use('/engagement',      engagementRoutes);
orgRouter.use('/tickets',         ticketsRoutes);
orgRouter.use('/reddit-leads',    redditLeadsRoutes);
orgRouter.use('/track',           trackRoutes);
orgRouter.use('/portfolios',      portfoliosRoutes);
orgRouter.use('/automation',      automationRoutes);
orgRouter.use('/members',         membersRoutes);

app.use('/api/org/:orgSlug', orgRouter);

// ── Non-org-scoped routes (unchanged) ─────────────────────────────────────
app.use('/api/unsubscribe', unsubscribeRoutes);  // public unsubscribe link
```

Note: `/api/auth`, `/api/client`, `/api/stripe`, `/api/clients`, `/api/book` remain mounted **above** the orgRouter block as they already are.

Note: individual route files (e.g. `contacts.js`) already apply `auth` per-route internally. The `authMiddleware` on `orgRouter` runs first and is the authoritative check; the per-route applications become redundant but harmless — do not remove them during this task.

- [ ] **Step 4: Verify server starts without crash**

```bash
npm run dev
# In another terminal:
curl http://localhost:5000/api/health
```

Expected: `{ "status": "ok" }`. Server should boot without errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.js
git commit -m "feat(backend): mount all tenant routes under /api/org/:orgSlug"
```

---

## Task 6: Add `orgWhere` to All Route Files

**Files:**
- Modify: all 27 route files listed in the File Map above

**Interfaces:**
- Consumes: `orgWhere(req.orgId)` and `orgUserWhere(req.orgId, req.user.id)` from `../db`
- Produces: every SELECT/INSERT/UPDATE/DELETE on a tenant-scoped table includes `organization_id` filtering

This task is mechanical. Follow this pattern for every route file.

- [ ] **Step 1: Update the `require('../db')` import in each route file**

For every route file, find the existing import line (it will look like one of these):
```js
const { db, sql, ownershipWhere } = require('../db');
// or
const { db, sql } = require('../db');
```

Change it to:
```js
const { db, sql, ownershipWhere, orgWhere, orgUserWhere } = require('../db');
```

- [ ] **Step 2: Add `orgWhere` to every SELECT query in each route file**

**Pattern for org-scoped tables** (contacts, deals, projects, invoices, proposals, activities, tickets, forms, sequences, workflows, outbound_*, clients, leads, teams, sharing, analytics, audit_logs, compliance, deliverability, reddit_leads, multi_source_leads, engagement, automation, agents, portfolios):

```js
// BEFORE (example from contacts.js):
const rows = await db.selectFrom('contacts')
  .where('user_id', '=', userId)
  .selectAll()
  .execute();

// AFTER:
const rows = await db.selectFrom('contacts')
  .$call(orgWhere(req.orgId))
  .where('user_id', '=', userId)
  .selectAll()
  .execute();
```

**Pattern for org+user-scoped tables** (reminders, time_entries, calendar_events):

```js
// AFTER:
const rows = await db.selectFrom('reminders')
  .$call(orgUserWhere(req.orgId, req.user.id))
  .selectAll()
  .execute();
```

**Pattern for INSERT statements** — add `organization_id` to values:

```js
// BEFORE:
await db.insertInto('contacts')
  .values({ name, email, user_id: req.user.id })
  .returningAll()
  .execute();

// AFTER:
await db.insertInto('contacts')
  .values({ name, email, user_id: req.user.id, organization_id: req.orgId })
  .returningAll()
  .execute();
```

- [ ] **Step 3: After updating each file, verify the server still starts**

```bash
npm run dev 2>&1 | head -20
```

Expected: no `SyntaxError` or `TypeError`

- [ ] **Step 4: Commit after every 5-6 route files (work in batches)**

```bash
# Batch 1: contacts, deals, activities, proposals, invoices
git add server/src/routes/contacts.js server/src/routes/deals.js \
        server/src/routes/activities.js server/src/routes/proposals.js \
        server/src/routes/invoices.js
git commit -m "feat(routes): add orgWhere to contacts, deals, activities, proposals, invoices"

# Batch 2: projects, portfolios, tickets, forms, clients
git add server/src/routes/projects.js server/src/routes/portfolios.js \
        server/src/routes/tickets.js server/src/routes/forms.js \
        server/src/routes/clients.js
git commit -m "feat(routes): add orgWhere to projects, portfolios, tickets, forms, clients"

# Batch 3: sequences, workflows, teams, sharing, analytics
git add server/src/routes/sequences.js server/src/routes/workflows.js \
        server/src/routes/teams.js server/src/routes/sharing.js \
        server/src/routes/analytics.js
git commit -m "feat(routes): add orgWhere to sequences, workflows, teams, sharing, analytics"

# Batch 4: outbound, compliance, deliverability, engagement, leads
git add server/src/routes/outboundAutomation.js server/src/routes/compliance.js \
        server/src/routes/deliverability.js server/src/routes/engagement.js \
        server/src/routes/leads.js
git commit -m "feat(routes): add orgWhere to outbound, compliance, deliverability, engagement, leads"

# Batch 5: remaining routes
git add server/src/routes/reminders.js server/src/routes/timeEntries.js \
        server/src/routes/calendar.js server/src/routes/auditLogs.js \
        server/src/routes/redditLeads.js server/src/routes/multiSourceLeads.js \
        server/src/routes/automation.js server/src/routes/agents.js \
        server/src/routes/appSettings.js server/src/routes/track.js
git commit -m "feat(routes): add orgWhere/orgUserWhere to remaining route files"
```

---

## Task 7: Isolation Test Suite

**Files:**
- Create: `server/src/tests/helpers/orgTestHelpers.js`
- Create: `server/src/tests/isolation/contacts.isolation.test.js`
- Create: `server/src/tests/isolation/deals.isolation.test.js`
- Create: `server/src/tests/isolation/projects.isolation.test.js`
- Create: `server/src/tests/isolation/invoices.isolation.test.js`
- Create: `server/src/tests/isolation/outbound.isolation.test.js`
- Modify: `server/jest.config.js`

**Interfaces:**
- Produces: CI gate verifying that a user from Org B cannot read Org A's data; super-admin can read Org A's data via the Org A slug

- [ ] **Step 1: Update `server/jest.config.js` to pick up isolation tests**

```js
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src/tests'],
  testMatch: ['**/*.test.js'],
  transform: {},
  moduleFileExtensions: ['js', 'json'],
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};
```

(No change needed if `roots: ['<rootDir>/src/tests']` already picks up subdirectories — Jest's `testMatch` recurses. Just confirm `src/tests/isolation/` is inside `src/tests/`.)

- [ ] **Step 2: Create `server/src/tests/helpers/orgTestHelpers.js`**

```js
// server/src/tests/helpers/orgTestHelpers.js
// Shared mock factories for org isolation tests.
// These helpers build mock req objects — they do NOT hit a real database.

function makeOrg(slug) {
  return { id: `org-${slug}-id`, name: slug, slug };
}

function makeUser(orgId, options = {}) {
  return {
    id: options.id || `user-${orgId}-${Math.random().toString(36).slice(2)}`,
    email: options.email || `user@${orgId}.com`,
    role: options.role || 'user',
    is_super_admin: options.is_super_admin || false,
  };
}

function makeSuperAdmin() {
  return {
    id: 'super-admin-id',
    email: 'admin@resiq.com',
    role: 'admin',
    is_super_admin: true,
  };
}

/**
 * Builds an Express app with the given route handler, wired with:
 * - A mock auth middleware that sets req.user
 * - A mock requireOrg middleware that sets req.orgId based on URL slug
 *   and validates membership (rejects if user.orgId !== slug-based org)
 */
function buildIsolationApp(express, routerFactory, orgMap) {
  const app = express();
  app.use(express.json());

  // Wire res.sendSuccess / res.sendError
  app.use((req, res, next) => {
    res.sendSuccess = (data) => res.json({ success: true, data });
    res.sendError = (msg, code, status) => res.status(status).json({ error: msg, code });
    next();
  });

  // Mock auth — user is set by test via req header x-test-user (JSON)
  app.use((req, res, next) => {
    const userHeader = req.headers['x-test-user'];
    req.user = userHeader ? JSON.parse(userHeader) : makeSuperAdmin();
    next();
  });

  // Mock requireOrg — validates membership using orgMap
  app.use('/api/org/:orgSlug', (req, res, next) => {
    const { orgSlug } = req.params;
    const org = orgMap[orgSlug];
    if (!org) return res.sendError('Organization not found', 'ORG_NOT_FOUND', 404);

    if (!req.user.is_super_admin) {
      // user must belong to this org (we simulate by checking user.orgId)
      if (req.user.orgId !== org.id) {
        return res.sendError('Access denied', 'ORG_FORBIDDEN', 403);
      }
      req.orgRole = 'member';
    }
    req.orgId = org.id;
    req.org = org;
    next();
  });

  app.use('/api/org/:orgSlug', routerFactory());

  return app;
}

module.exports = { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp };
```

- [ ] **Step 3: Write `contacts.isolation.test.js`**

```js
// server/src/tests/isolation/contacts.isolation.test.js
const express = require('express');
const request = require('supertest');
const { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp } = require('../helpers/orgTestHelpers');

// Mock the DB — capture what org filter was applied
const capturedFilters = [];
const mockRows = [];

jest.mock('../../db', () => {
  const chain = {
    where: jest.fn(function(col, op, val) {
      if (col === 'organization_id') capturedFilters.push(val);
      return this;
    }),
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    execute: jest.fn(() => Promise.resolve(mockRows)),
    executeTakeFirst: jest.fn(() => Promise.resolve(mockRows[0])),
    $call: jest.fn(function(fn) { fn(this); return this; }),
  };
  return {
    db: { selectFrom: jest.fn(() => chain), fn: { count: () => ({ as: () => 'count' }) } },
    sql: { ref: (r) => r },
    ownershipWhere: jest.fn(() => () => {}),
    orgWhere: jest.fn((orgId) => (qb) => qb.where('organization_id', '=', orgId)),
    orgUserWhere: jest.fn((orgId, userId) => (qb) => qb.where('organization_id', '=', orgId).where('user_id', '=', userId)),
    pool: {},
  };
});

// Also mock auth middleware since it's required by the route file
jest.mock('../../middleware/auth', () => (req, res, next) => next());

const orgA = makeOrg('org-a');
const orgB = makeOrg('org-b');
const orgMap = { 'org-a': orgA, 'org-b': orgB };

const userA = { ...makeUser(orgA.id), orgId: orgA.id };
const userB = { ...makeUser(orgB.id), orgId: orgB.id };
const superAdmin = makeSuperAdmin();

function routerFactory() {
  return require('../../routes/contacts');
}

describe('contacts — cross-org isolation', () => {
  beforeEach(() => {
    capturedFilters.length = 0;
  });

  it('org-b user gets 403 when accessing org-a contacts', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/')
      .set('x-test-user', JSON.stringify(userB));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_FORBIDDEN');
  });

  it('org-a user accesses org-a contacts — org_id filter applied', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/')
      .set('x-test-user', JSON.stringify(userA));

    expect(res.status).toBe(200);
    // Verify organization_id filter was applied with org-a's id
    expect(capturedFilters).toContain(orgA.id);
    // Verify org-b's id was never used as a filter
    expect(capturedFilters).not.toContain(orgB.id);
  });

  it('super-admin accesses org-a contacts — org_id filter still scoped to org-a', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    const res = await request(app)
      .get('/api/org/org-a/')
      .set('x-test-user', JSON.stringify(superAdmin));

    expect(res.status).toBe(200);
    expect(capturedFilters).toContain(orgA.id);
  });
});
```

- [ ] **Step 4: Run the contacts isolation test — expect PASS (or fix any route-level issues)**

```bash
cd server && npx jest src/tests/isolation/contacts.isolation.test.js --no-coverage
```

Expected: 3 tests passing. If any fail, debug the orgWhere application in `contacts.js`.

- [ ] **Step 5: Write isolation tests for deals, projects, invoices, outbound**

Create the following files using the **exact same pattern** as `contacts.isolation.test.js` — change only:
- The `jest.mock` path to `../../routes/deals` (or projects/invoices/outbound)
- The `routerFactory` require path
- The `describe` label

**`deals.isolation.test.js`** — copy contacts test verbatim, change:
```js
// routerFactory:
return require('../../routes/deals');
// describe label:
describe('deals — cross-org isolation', () => {
```

**`projects.isolation.test.js`** — copy, change to `../../routes/projects` and `'projects — cross-org isolation'`

**`invoices.isolation.test.js`** — copy, change to `../../routes/invoices` and `'invoices — cross-org isolation'`

**`outbound.isolation.test.js`** — copy, change to `../../routes/outboundAutomation` and `'outbound — cross-org isolation'`

- [ ] **Step 6: Run all isolation tests**

```bash
cd server && npx jest src/tests/isolation/ --no-coverage
```

Expected: 15 tests passing (3 per file × 5 files)

- [ ] **Step 7: Run full test suite to confirm no regressions**

```bash
cd server && npm test
```

Expected: all existing tests still pass

- [ ] **Step 8: Commit**

```bash
git add server/jest.config.js \
        server/src/tests/helpers/orgTestHelpers.js \
        server/src/tests/isolation/
git commit -m "test(isolation): add cross-org isolation test suite for contacts, deals, projects, invoices, outbound"
```

---

## Task 8: Frontend — `OrgContext` and API Interceptor

**Files:**
- Create: `client/src/context/OrgContext.jsx`
- Modify: `client/src/api/api.js`
- Modify: `client/src/context/AuthContext.jsx`

**Interfaces:**
- Consumes: `useQuery` from `@tanstack/react-query`; `useParams`, `Outlet` from `react-router-dom`; `api` from `../api/api`
- Produces:
  - `OrgShell` component — wraps all org-scoped pages, provides OrgContext
  - `useOrg()` hook — returns `{ id, name, slug }` of active org
  - `getActiveOrgSlug()` — module-level function consumed by axios interceptor
  - Updated `api.js` interceptor — automatically prepends `/org/:slug` to tenant-scoped requests
  - `AuthContext` exposes `user.is_super_admin`

- [ ] **Step 1: Create `client/src/context/OrgContext.jsx`**

```jsx
// client/src/context/OrgContext.jsx
import { createContext, useContext } from 'react'
import { useParams, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/api'

const OrgContext = createContext(null)

// Module-level slug ref consumed by the axios interceptor.
// Updated synchronously whenever OrgShell renders.
let _activeOrgSlug = null
export const getActiveOrgSlug = () => _activeOrgSlug

export function OrgShell() {
  const { orgSlug } = useParams()
  _activeOrgSlug = orgSlug

  const { data: org, isLoading, isError } = useQuery({
    queryKey: ['org', orgSlug],
    queryFn: () => api.get(`/orgs/${orgSlug}`).then((r) => r.data.data),
    staleTime: 5 * 60 * 1000, // 5 minutes — matches Redis TTL
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Loading workspace…
      </div>
    )
  }

  if (isError || !org) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Organization not found.
      </div>
    )
  }

  return (
    <OrgContext.Provider value={org}>
      <Outlet />
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
```

- [ ] **Step 2: Update `client/src/api/api.js` — add org slug interceptor**

Open `client/src/api/api.js`. Find the existing request interceptor:

```js
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('resiq_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})
```

Replace it with:

```js
import { getActiveOrgSlug } from '../context/OrgContext'

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('resiq_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  // Prepend /org/:slug for all tenant-scoped requests.
  // Skip public endpoints: /auth, /orgs, /book, /client, /track.
  const slug = getActiveOrgSlug()
  const isPublic = ['/auth', '/orgs', '/book', '/client', '/track', '/unsubscribe']
    .some((prefix) => config.url.startsWith(prefix))

  if (slug && !isPublic) {
    config.url = `/org/${slug}${config.url}`
  }

  return config
})
```

- [ ] **Step 3: Update `AuthContext.jsx` to persist and expose `is_super_admin`**

In `client/src/context/AuthContext.jsx`, find where `req.user` is stored in `localStorage`:

```js
const login = (token, user) => {
  localStorage.setItem('resiq_token', token)
  localStorage.setItem('resiq_user', JSON.stringify(user))
  setToken(token)
  setUser(user)
}
```

This is unchanged — `is_super_admin` will be included if the server returns it in the login response. Find the server's login handler (`server/src/routes/auth.js`) and confirm it returns `is_super_admin` in the user payload. If not, add it:

```js
// In server/src/routes/auth.js — in the login route response:
// Find the line that builds the user object for the JWT/response and add:
is_super_admin: user.is_super_admin,
```

- [ ] **Step 4: Verify in browser**

Start the dev server:
```bash
npm run dev
```

Navigate to `http://localhost:5173`. You should still be redirected to `/login`. After login, you'll be taken to `/` (which will 404 until Task 9). The OrgContext is not yet wired into routing — that's Task 9.

- [ ] **Step 5: Commit**

```bash
git add client/src/context/OrgContext.jsx client/src/api/api.js client/src/context/AuthContext.jsx
git commit -m "feat(frontend): add OrgContext, OrgShell, and org-slug axios interceptor"
```

---

## Task 9: Frontend — Route Restructuring

**Files:**
- Create: `client/src/pages/OrgRedirect.jsx`
- Create: `client/src/components/OrgPicker.jsx`
- Modify: `client/src/App.jsx`
- Modify: `client/src/components/DashboardLayout.jsx`

**Interfaces:**
- Consumes: `OrgShell` from `../context/OrgContext`; `useAuth` from `../context/AuthContext`; `api` from `../api/api`
- Produces: all existing pages now reachable at `/org/:orgSlug/*`; `/` redirects to correct org post-login

- [ ] **Step 1: Create `client/src/pages/OrgRedirect.jsx`**

```jsx
// client/src/pages/OrgRedirect.jsx
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/api'
import OrgPicker from '../components/OrgPicker'

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      Loading…
    </div>
  )
}

export default function OrgRedirect() {
  const { data: orgs, isLoading } = useQuery({
    queryKey: ['my-orgs'],
    queryFn: () => api.get('/orgs/mine').then((r) => r.data.data),
  })

  if (isLoading) return <Spinner />
  if (!orgs || orgs.length === 0) return <div>No organizations found. Contact your admin.</div>
  if (orgs.length === 1) return <Navigate to={`/org/${orgs[0].slug}`} replace />
  return <OrgPicker orgs={orgs} />
}
```

- [ ] **Step 2: Create `client/src/components/OrgPicker.jsx`**

```jsx
// client/src/components/OrgPicker.jsx
import { useNavigate } from 'react-router-dom'

export default function OrgPicker({ orgs }) {
  const navigate = useNavigate()

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: '1.5rem',
      background: '#f9fafb',
    }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>
        Select a workspace
      </h1>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '1rem',
        maxWidth: '640px',
        width: '100%',
        padding: '0 1rem',
      }}>
        {orgs.map((org) => (
          <button
            key={org.id}
            onClick={() => navigate(`/org/${org.slug}`)}
            style={{
              padding: '1.5rem',
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '0.75rem',
              cursor: 'pointer',
              textAlign: 'left',
              boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
              transition: 'box-shadow 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.07)'}
          >
            <div style={{ fontWeight: 600, color: '#111827', marginBottom: '0.25rem' }}>
              {org.name}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>/{org.slug}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update `client/src/App.jsx` to restructure routes**

Add this import near the top of `App.jsx` with the other imports:

```js
import { OrgShell } from './context/OrgContext'
const OrgRedirect = lazy(() => import('./pages/OrgRedirect'))
const Admin = lazy(() => import('./pages/Admin'))
```

Find the `AppRoutes` function and replace the entire `<Routes>` block with:

```jsx
function AppRoutes() {
  const { isAuthenticated } = useAuth()
  return (
    <Routes>
      {/* Client portal — unchanged */}
      <Route path="/client/*" element={<ClientPortalApp />} />

      {/* Public */}
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/book/:slug" element={<BookingPage />} />

      {/* Org-scoped — all pages now live under /org/:orgSlug */}
      <Route
        path="/org/:orgSlug"
        element={<ProtectedRoute><OrgShell /></ProtectedRoute>}
      >
        <Route element={<DashboardLayout />}>
          <Route index element={<Overview />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="forecasting" element={<Forecasting />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="workflows" element={<Navigate to="outbound-automation/execution" replace />} />
          <Route path="sequences" element={<Navigate to="outbound-automation/execution" replace />} />
          <Route path="settings" element={<Settings />} />
          <Route path="teams" element={<Teams />} />
          <Route path="audit-logs" element={<AuditLogs />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:projectId" element={<ProjectDetail />} />
          <Route path="portfolios" element={<Portfolios />} />
          <Route path="portfolios/:portfolioId" element={<PortfolioDetail />} />
          <Route path="users" element={<Users />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="agents" element={<Agents />} />
          <Route path="forms" element={<Forms />} />
          <Route path="help-desk" element={<HelpDesk />} />
          <Route path="proposals" element={<Proposals />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="time-tracking" element={<TimeTracking />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="reddit-leads" element={<RedditLeads />} />
          <Route path="multi-source-leads" element={<MultiSourceLeads />} />
          <Route path="outbound-automation/*" element={<OutboundAutomation />} />
          <Route path="compliance" element={<Compliance />} />
          <Route path="deliverability" element={<Deliverability />} />
          <Route path="help" element={<Help />} />
        </Route>
      </Route>

      {/* Super-admin panel */}
      <Route
        path="/admin"
        element={<ProtectedRoute><Admin /></ProtectedRoute>}
      />

      {/* Post-login landing — resolves to correct org */}
      <Route path="/" element={<ProtectedRoute><OrgRedirect /></ProtectedRoute>} />
    </Routes>
  )
}
```

- [ ] **Step 4: Update `DashboardLayout` navigation links to use org-relative paths**

Open `client/src/components/DashboardLayout.jsx`. Find where sidebar nav links are defined (they will look like `to="/contacts"` or `href="/contacts"`). Add `useParams` to get the org slug, then prefix all internal links:

```jsx
import { useParams } from 'react-router-dom'

// Inside the component:
const { orgSlug } = useParams()
const p = (path) => `/org/${orgSlug}${path}` // helper

// Then change each nav link:
// BEFORE: <NavLink to="/contacts">
// AFTER:  <NavLink to={p('/contacts')}>
```

Apply this to every internal navigation link in `DashboardLayout.jsx`.

- [ ] **Step 5: Test in browser**

```bash
npm run dev
```

1. Go to `http://localhost:5173` — should redirect to login
2. Log in — should redirect to `/org/default` (the Default org)
3. All sidebar links should navigate within `/org/default/*`
4. Page data should load (contacts, deals, etc.)

- [ ] **Step 6: Commit**

```bash
git add client/src/App.jsx client/src/pages/OrgRedirect.jsx \
        client/src/components/OrgPicker.jsx client/src/components/DashboardLayout.jsx
git commit -m "feat(frontend): restructure routes under /org/:orgSlug; add OrgRedirect and OrgPicker"
```

---

## Task 10: Super-Admin Panel

**Files:**
- Create: `client/src/pages/Admin.jsx`

**Interfaces:**
- Consumes: `api` from `../api/api`; `useAuth` from `../context/AuthContext`; `useQuery`, `useMutation` from `@tanstack/react-query`
- Produces: `/admin` page with org table, create-org form, and member management

- [ ] **Step 1: Create `client/src/pages/Admin.jsx`**

```jsx
// client/src/pages/Admin.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import api from '../api/api'

export default function Admin() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [newOrg, setNewOrg] = useState({ name: '', slug: '' })
  const [createError, setCreateError] = useState(null)

  // Guard: only super-admins
  if (!user?.is_super_admin) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1>Access Denied</h1>
        <p>Super-admin access required.</p>
      </div>
    )
  }

  const { data: orgs, isLoading } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => api.get('/orgs').then((r) => r.data.data),
  })

  const createOrgMutation = useMutation({
    mutationFn: (payload) => api.post('/orgs', payload).then((r) => r.data.data),
    onSuccess: (org) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orgs'] })
      setNewOrg({ name: '', slug: '' })
      setCreateError(null)
      navigate(`/org/${org.slug}`)
    },
    onError: (err) => setCreateError(err.message),
  })

  const handleCreate = (e) => {
    e.preventDefault()
    if (!newOrg.name) return
    createOrgMutation.mutate(newOrg)
  }

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '2rem' }}>
        Admin Panel
      </h1>

      {/* Create org */}
      <section style={{ marginBottom: '2rem', padding: '1.5rem', background: '#f9fafb', borderRadius: '0.75rem', border: '1px solid #e5e7eb' }}>
        <h2 style={{ fontWeight: 600, marginBottom: '1rem' }}>Create Organization</h2>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input
            placeholder="Name"
            value={newOrg.name}
            onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
            required
            style={{ flex: 1, minWidth: '160px', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.5rem' }}
          />
          <input
            placeholder="Slug (optional — auto-generated)"
            value={newOrg.slug}
            onChange={(e) => setNewOrg({ ...newOrg, slug: e.target.value })}
            style={{ flex: 1, minWidth: '200px', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.5rem' }}
          />
          <button
            type="submit"
            disabled={createOrgMutation.isPending}
            style={{ padding: '0.5rem 1.25rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}
          >
            {createOrgMutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </form>
        {createError && <p style={{ color: '#dc2626', marginTop: '0.5rem' }}>{createError}</p>}
      </section>

      {/* Org table */}
      <section>
        <h2 style={{ fontWeight: 600, marginBottom: '1rem' }}>Organizations</h2>
        {isLoading ? (
          <p>Loading…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 1rem' }}>Name</th>
                <th style={{ padding: '0.5rem 1rem' }}>Slug</th>
                <th style={{ padding: '0.5rem 1rem' }}>Members</th>
                <th style={{ padding: '0.5rem 1rem' }}>Created</th>
                <th style={{ padding: '0.5rem 1rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {(orgs || []).map((org) => (
                <tr key={org.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{org.name}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#6b7280', fontFamily: 'monospace' }}>{org.slug}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>{org.member_count}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#6b7280' }}>
                    {new Date(org.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <button
                      onClick={() => navigate(`/org/${org.slug}`)}
                      style={{ padding: '0.25rem 0.75rem', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Test in browser**

```bash
npm run dev
```

1. Navigate to `http://localhost:5173/admin`
2. If logged in as super-admin: see the org table showing "Default" org
3. Create a new org: enter a name, submit — should redirect to `/org/<new-slug>`

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Admin.jsx
git commit -m "feat(frontend): add super-admin org management panel at /admin"
```

---

## Self-Review Checklist

Before opening a PR, verify:

- [ ] `GET /api/org/acme/contacts` returns 200 for an org-a member
- [ ] `GET /api/org/acme/contacts` returns 403 for an org-b member
- [ ] `GET /api/org/ghost/contacts` returns 404
- [ ] Super-admin gets 200 on any org slug
- [ ] After login, navigating to `/` redirects to `/org/default`
- [ ] All sidebar links stay within `/org/default/*`
- [ ] `npm test` passes (all existing + isolation tests)
- [ ] No rows have `organization_id IS NULL` in any tenant-scoped table

```bash
# Run this query to verify post-migration backfill completeness:
psql $DATABASE_URL -c "
SELECT 'contacts' AS tbl, COUNT(*) FROM contacts WHERE organization_id IS NULL
UNION ALL SELECT 'deals', COUNT(*) FROM deals WHERE organization_id IS NULL
UNION ALL SELECT 'projects', COUNT(*) FROM projects WHERE organization_id IS NULL
UNION ALL SELECT 'invoices', COUNT(*) FROM invoices WHERE organization_id IS NULL
UNION ALL SELECT 'proposals', COUNT(*) FROM proposals WHERE organization_id IS NULL;
"
# Every count should be 0
```
