# Org-Isolation Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make resiq-crm's multi-tenant org isolation enforced structurally, provable via tests, and indexed for performance — without changing the client.

**Architecture:** Approach B from the design doc. Org is derived server-side from `organization_members` (tamper-proof) via a new `resolveOrg` middleware on the existing flat routes; `ownershipWhere` is hardened so it can never emit an unscoped query and `admin` is org-bound instead of `1=1`; the ~10 unfiltered org-data route modules get org filtering; the operator-side client IDOR is closed; missing `organization_id` indexes are added via a migration Josh runs; and an isolation test suite (extending the existing `src/tests/isolation/` harness) gates "done".

**Tech Stack:** Node, Express, Kysely + `pg`, ioredis, Jest + supertest. Server code is CommonJS under `server/src/`.

## Global Constraints

- Single org (ResiQ), single operator today — no live cutover risk. Do not delete flat mounts. Do not change client code.
- All work on branch `feat/multi-tenancy`.
- Every org-scoped DB query must be constrained by `organization_id = req.orgId`. A helper that would emit an unscoped query must throw (fail closed), never run.
- Org identity comes from server-side membership, never from a token claim or request body.
- Tests are CommonJS Jest under `server/src/tests/`; run with `cd server && CI=true npx jest`. The full server suite (119 tests pre-existing) must stay green.
- JWT verification stays pinned to `{ algorithms: ['HS256'] }` (already done — do not regress).
- Commit after each task. Conventional commit messages. No attribution footer.

---

### Task 1: Inventory gate — org tables, org columns, indexes, unfiltered modules

Discovery task. Produces the authoritative lists every later task consumes. No app code changes.

**Files:**
- Create: `docs/superpowers/plans/org-inventory.md` (checked-in working inventory)

**Interfaces:**
- Produces: `ORG_TABLES` (tables with an `organization_id` column), `MISSING_INDEX_TABLES` (org tables with no index on `organization_id`), `UNFILTERED_MODULES` (route modules that query an org table but apply no org filter). Later tasks reference these by name.

- [ ] **Step 1: Enumerate org tables and their indexes**

Josh runs this against the live DB (read-only) and pastes output back, OR the executor runs it if a read-only `DATABASE_URL` is available:

```sql
-- Tables that have an organization_id column
SELECT table_name
FROM information_schema.columns
WHERE column_name = 'organization_id' AND table_schema = 'public'
ORDER BY table_name;

-- Existing indexes that cover organization_id
SELECT t.relname AS table_name, i.relname AS index_name
FROM pg_index ix
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
WHERE a.attname = 'organization_id' AND t.relkind = 'r'
ORDER BY t.relname;
```

- [ ] **Step 2: Record the three lists in `org-inventory.md`**

Write three explicit lists: `ORG_TABLES`, `MISSING_INDEX_TABLES` (in ORG_TABLES but absent from the index query), and the candidate `UNFILTERED_MODULES` (start from: `agents`, `appSettings`, `auditLogs`, `compliance`, `deliverability`, `integrations`, `multiSourceLeads`, `redditLeads`, `sms`, `workflows`). For each candidate module, note which org table(s) it reads and whether that table is in `ORG_TABLES`. A module whose tables are NOT in `ORG_TABLES` is reclassified "intentionally global" and dropped from the audit set.

- [ ] **Step 3: Confirm the isolation harness runs**

```bash
cd server && CI=true npx jest src/tests/isolation --silent
```
Expected: existing isolation tests (contacts, deals, invoices, projects, outbound) PASS. This confirms `helpers/orgTestHelpers.js` (`makeOrg`, `makeUser`, `makeSuperAdmin`, `buildIsolationApp`) is the harness later tasks extend.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/org-inventory.md
git commit -m "docs: org-isolation inventory (tables, indexes, unfiltered modules)"
```

---

### Task 2: Harden `ownershipWhere` — fail closed + org-bound admin

**Files:**
- Modify: `server/src/db.js` (function `ownershipWhere`, lines ~54–83; export unchanged)
- Modify: `server/src/routes/contacts.js:52` (call site)
- Modify: `server/src/routes/deals.js:14` (call site)
- Create: `server/src/tests/ownershipWhere.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `ownershipWhere(alias, resourceType, userId, role, orgId)` — new required 5th param `orgId`. Throws `Error` if `orgId` is nullish. Every returned predicate is ANDed with `<alias>.organization_id = orgId`. The `admin` branch returns exactly `<alias>.organization_id = orgId` (no `1 = 1`).

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/tests/ownershipWhere.test.js
const { ownershipWhere } = require('../db');

describe('ownershipWhere — fail closed on missing org', () => {
  it.each(['admin', 'manager', 'user', 'viewer'])(
    'throws when orgId is missing for role %s',
    (role) => {
      expect(() => ownershipWhere('d', 'deal', 'user-1', role, null)).toThrow(
        /organization/i
      );
      expect(() => ownershipWhere('d', 'deal', 'user-1', role, undefined)).toThrow(
        /organization/i
      );
    }
  );

  it('admin path does not throw and returns a predicate when orgId is present', () => {
    expect(() => ownershipWhere('d', 'deal', 'user-1', 'admin', 'org-1')).not.toThrow();
    expect(ownershipWhere('d', 'deal', 'user-1', 'admin', 'org-1')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && CI=true npx jest src/tests/ownershipWhere.test.js -v`
Expected: FAIL — current signature has 4 params, no throw on missing orgId.

- [ ] **Step 3: Implement the hardened helper**

In `server/src/db.js`, replace the `ownershipWhere` body. Reference the current shape (admin → `sql\`1 = 1\``; manager → owner/team/shared; user/viewer → owner/shared). New version:

```javascript
function ownershipWhere(alias, resourceType, userId, role, orgId) {
  if (orgId === null || orgId === undefined) {
    throw new Error(
      `ownershipWhere: orgId is required (organization scoping) for ${resourceType}`
    );
  }

  const orgScope = sql`${sql.ref(alias + '.organization_id')} = ${orgId}`;

  if (role === 'admin') {
    // Org-wide within the tenant — NOT cross-org.
    return orgScope;
  }

  const sharedCheck = sql`EXISTS (
    SELECT 1 FROM shared_resources sr
    WHERE sr.resource_type = ${resourceType}
      AND sr.resource_id = ${sql.ref(alias + '.id')}
      AND (sr.shared_with_user_id = ${userId}
        OR sr.shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = ${userId}))
  )`;

  if (role === 'manager') {
    return sql`(${orgScope} AND (
      ${sql.ref(alias + '.user_id')} = ${userId}
      OR ${sharedCheck}
      OR ${sql.ref(alias + '.user_id')} IN (
        SELECT tm2.user_id FROM team_members tm2
        WHERE tm2.team_id IN (
          SELECT tm1.team_id FROM team_members tm1 WHERE tm1.user_id = ${userId}
        )
      )
    ))`;
  }

  // user or viewer
  return sql`(${orgScope} AND (${sql.ref(alias + '.user_id')} = ${userId} OR ${sharedCheck}))`;
}
```

- [ ] **Step 4: Update the two call sites to pass `req.orgId`**

`server/src/routes/contacts.js:52`:
```javascript
  const conditions = [ownershipWhere('c', 'contact', userId, req.user.role, req.orgId)];
```
`server/src/routes/deals.js:14`:
```javascript
  const conditions = [ownershipWhere('d', 'deal', req.user.id, req.user.role, req.orgId)];
```

- [ ] **Step 5: Run tests**

Run: `cd server && CI=true npx jest src/tests/ownershipWhere.test.js src/tests/isolation -v`
Expected: PASS. (Isolation tests still green — they mock `ownershipWhere`, so the signature change is transparent to them.)

- [ ] **Step 6: Commit**

```bash
git add server/src/db.js server/src/routes/contacts.js server/src/routes/deals.js server/src/tests/ownershipWhere.test.js
git commit -m "fix(security): ownershipWhere fails closed on missing org; admin is org-bound"
```

---

### Task 3: `resolveOrg` middleware + wire onto flat org-data mounts

**Files:**
- Create: `server/src/middleware/resolveOrg.js`
- Modify: `server/src/index.js` (flat org-data mounts, lines ~218–250)
- Create: `server/src/tests/resolveOrg.test.js`

**Interfaces:**
- Consumes: `req.user` (set by `auth`), `db` from `../db`.
- Produces: `resolveOrg(req, res, next)` — sets `req.orgId`, `req.orgRole`, `req.org` from the caller's single `organization_members` row when no `orgSlug` param is present. Fails closed: 401 if `!req.user`; 403 (`ORG_REQUIRED`) if the user has no membership; 403 (`ORG_AMBIGUOUS`) if a non-super-admin has multiple memberships and no slug.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/tests/resolveOrg.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && CI=true npx jest src/tests/resolveOrg.test.js -v`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `resolveOrg`**

```javascript
// server/src/middleware/resolveOrg.js
const { db } = require('../db');

// Derives req.orgId from the caller's server-side membership when the route
// has no :orgSlug param. Org identity never comes from the URL or token here.
// Fails closed on every ambiguous or missing case.
async function resolveOrg(req, res, next) {
  if (!req.user) {
    return res.sendError('Unauthorized', 'UNAUTHENTICATED', 401);
  }

  // Slug-based routes are handled by requireOrg, not here.
  if (req.params && req.params.orgSlug) return next();

  try {
    const memberships = await db
      .selectFrom('organization_members as om')
      .innerJoin('organizations as o', 'o.id', 'om.organization_id')
      .where('om.user_id', '=', req.user.id)
      .select(['om.organization_id as organization_id', 'om.role as role', 'o.slug as slug', 'o.name as name'])
      .execute();

    if (!memberships.length) {
      return res.sendError('Organization membership required', 'ORG_REQUIRED', 403);
    }
    if (memberships.length > 1 && !req.user.is_super_admin) {
      return res.sendError('Organization is ambiguous; use an org-scoped route', 'ORG_AMBIGUOUS', 403);
    }

    const m = memberships[0];
    req.orgId = m.organization_id;
    req.orgRole = m.role;
    req.org = { id: m.organization_id, slug: m.slug, name: m.name };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { resolveOrg };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && CI=true npx jest src/tests/resolveOrg.test.js -v`
Expected: PASS.

- [ ] **Step 5: Wire `resolveOrg` onto the flat org-data mounts**

In `server/src/index.js`, add the imports near the other middleware imports:
```javascript
const authMiddleware = require('./middleware/auth');       // if not already imported here
const { resolveOrg } = require('./middleware/resolveOrg');
```
For **each** flat org-data mount in lines ~218–250 whose module is in `ORG_TABLES` scope (from Task 1 inventory — i.e. all except the intentionally-global ones), insert `authMiddleware, resolveOrg` before the router. Example for the contacts mount:
```javascript
app.use('/api/contacts', authMiddleware, resolveOrg, contactsRoutes);
```
Do NOT add it to the global mounts: `/api/auth`, `/api/client`, `/api/clients` (operator client mgmt is handled in Task 4), `/api/stripe`, `/api/orgs`, `/api/unsubscribe`, `/api/webhooks`. (Per-handler `auth` inside each route still runs; the extra mount-level `authMiddleware` sets `req.user` before `resolveOrg` reads it — this is intentional and cheap.)

- [ ] **Step 6: Run the full server suite**

Run: `cd server && CI=true npx jest --silent`
Expected: all green (119 pre-existing + new). If a route now throws because a handler used `ownershipWhere` without org before, that surfaces here — fix by ensuring the mount has `resolveOrg`.

- [ ] **Step 7: Commit**

```bash
git add server/src/middleware/resolveOrg.js server/src/tests/resolveOrg.test.js server/src/index.js
git commit -m "feat(security): resolveOrg derives org from membership; wire onto flat org routes"
```

---

### Task 4: Close the operator-side client IDOR

**Files:**
- Modify: `server/src/models/client.js` (`findById`, lines ~10–17)
- Modify: `server/src/routes/clients.js` (the `GET /:clientId` handler, ~line 145; add `authMiddleware, resolveOrg` mount in index.js line 208)
- Modify: `server/src/index.js:208` (`/api/clients` mount)
- Create: `server/src/tests/clientIdor.test.js`

**Interfaces:**
- Consumes: `resolveOrg` (Task 3), `req.orgId`.
- Produces: `Client.findById(clientId, orgId)` — org-scoped; returns `null` if the client is not in `orgId`.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/tests/clientIdor.test.js
const pool = require('../models/db');
jest.mock('../models/db', () => ({ query: jest.fn() }));

const Client = require('../models/client');

describe('Client.findById — org scoped', () => {
  it('includes organization_id in the query and passes orgId param', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await Client.findById('client-1', 'org-1');
    const [sqlText, params] = pool.query.mock.calls[0];
    expect(sqlText).toMatch(/organization_id\s*=\s*\$2/i);
    expect(params).toEqual(['client-1', 'org-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && CI=true npx jest src/tests/clientIdor.test.js -v`
Expected: FAIL — current `findById` takes one param and has no org filter.

- [ ] **Step 3: Org-scope `findById`**

`server/src/models/client.js`:
```javascript
async function findById(clientId, orgId) {
  if (orgId === null || orgId === undefined) {
    throw new Error('Client.findById: orgId is required');
  }
  const result = await pool.query(
    'SELECT * FROM clients WHERE id = $1 AND organization_id = $2',
    [clientId, orgId]
  );
  return result.rows[0] || null;
}
```

- [ ] **Step 4: Update operator-side callers to pass `req.orgId`**

In `server/src/routes/clients.js`, the `GET /:clientId` handler (~line 145) — change `findById(clientId)` to `findById(clientId, req.orgId)`. Update any other operator-side `findById(...)` call in this file the same way. (The client-portal `clientAuth` path in `middleware/clientAuth.js` uses `Client.findById(decoded.clientId)` for the logged-in client itself — that lookup is the client authenticating as themselves, not an operator reading a client; leave it, but pass the client's own `organization_id` if the token carries it, otherwise leave the single-arg self-lookup and note it in the inventory doc as reviewed-safe.)

- [ ] **Step 5: Add `resolveOrg` to the `/api/clients` mount**

`server/src/index.js:208`:
```javascript
app.use('/api/clients', authMiddleware, resolveOrg, clientsRoutes);
```

- [ ] **Step 6: Run tests**

Run: `cd server && CI=true npx jest src/tests/clientIdor.test.js --silent && cd . && cd server && CI=true npx jest --silent`
Expected: PASS across the suite.

- [ ] **Step 7: Commit**

```bash
git add server/src/models/client.js server/src/routes/clients.js server/src/index.js server/src/tests/clientIdor.test.js
git commit -m "fix(security): org-scope operator-side Client.findById (close IDOR)"
```

---

### Task 5: Audit and filter one unfiltered module (worked example: `compliance`)

This is the fully-worked template. Task 6 repeats this exact loop for every remaining module in `UNFILTERED_MODULES`.

**Files:**
- Modify: `server/src/routes/compliance.js` (every query touching an org table)
- Create: `server/src/tests/isolation/compliance.isolation.test.js`

**Interfaces:**
- Consumes: `req.orgId` (guaranteed by `resolveOrg` / `requireOrg`), `orgWhere` from `../db`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Read the module and list its org-table queries**

```bash
cd server && grep -n "selectFrom\|insertInto\|updateTable\|deleteFrom\|sql\`" src/routes/compliance.js
```
For each query on a table in `ORG_TABLES`, it must be constrained by `req.orgId` (reads/updates/deletes) and set `organization_id` on inserts.

- [ ] **Step 2: Write the failing isolation test (copy the existing pattern)**

Copy `src/tests/isolation/contacts.isolation.test.js` to `src/tests/isolation/compliance.isolation.test.js`, change `routerFactory` to `require('../../routes/compliance')`, and adjust the mocked dependencies to match compliance's imports (mock only what the module `require`s). Keep the three assertions: org-b user → 403 on org-a; org-a user → not 403; super-admin → not 403. Add one assertion that a GET reaching the route pushes `req.orgId` into `capturedFilters` (proving `orgWhere` is applied):
```javascript
  it('applies orgWhere with the org id on list', async () => {
    const app = buildIsolationApp(express, routerFactory, orgMap);
    await request(app).get('/api/org/org-a/').set('x-test-user', JSON.stringify(userA));
    expect(capturedFilters).toContain(orgA.id);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && CI=true npx jest src/tests/isolation/compliance.isolation.test.js -v`
Expected: FAIL — `capturedFilters` empty because the route does not call `orgWhere` yet.

- [ ] **Step 4: Add org filtering to every org-table query**

For each Kysely query, add `.where('organization_id', '=', req.orgId)` (or `.modifyWhere(orgWhere(req.orgId))` where the codebase already uses `orgWhere`). For raw `sql` queries, add `AND organization_id = ${req.orgId}`. For inserts, add `organization_id: req.orgId` to the values object. Ensure `orgWhere` is imported: `const { db, sql, orgWhere } = require('../db');`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && CI=true npx jest src/tests/isolation/compliance.isolation.test.js -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/compliance.js server/src/tests/isolation/compliance.isolation.test.js
git commit -m "fix(security): org-scope compliance routes + isolation test"
```

---

### Task 6: Repeat Task 5 for every remaining unfiltered module

Run the Task 5 loop (steps 1–6) once per module, one commit each. Modules (from Task 1 `UNFILTERED_MODULES`, minus any reclassified intentionally-global): `agents`, `appSettings`, `auditLogs`, `deliverability`, `integrations`, `multiSourceLeads`, `redditLeads`, `sms`, `workflows`.

- [ ] `agents` — filter queries, add `src/tests/isolation/agents.isolation.test.js`, commit
- [ ] `appSettings` — filter queries, add isolation test, commit
- [ ] `auditLogs` — filter queries, add isolation test, commit
- [ ] `deliverability` — filter queries, add isolation test, commit
- [ ] `integrations` — filter queries, add isolation test, commit
- [ ] `multiSourceLeads` — filter queries, add isolation test, commit
- [ ] `redditLeads` — filter queries, add isolation test, commit
- [ ] `sms` — filter queries, add isolation test, commit
- [ ] `workflows` — filter queries, add isolation test, commit

For any module whose tables turn out NOT to be in `ORG_TABLES`, record it as intentionally-global in `org-inventory.md` (with the reason) and skip it — do not add empty filtering.

- [ ] **Final step: full isolation suite green**

Run: `cd server && CI=true npx jest src/tests/isolation --silent`
Expected: every module's isolation test passes.

---

### Task 7: Index migration (Josh applies)

**Files:**
- Create: `server/migrations/2026-07-10-org-id-indexes.sql`
- Create: `server/migrations/verify-org-id-indexes.sql`

**Interfaces:**
- Consumes: `MISSING_INDEX_TABLES` from Task 1.
- Produces: SQL Josh runs against the live DB.

- [ ] **Step 1: Write the index migration**

One `CREATE INDEX CONCURRENTLY` per table in `MISSING_INDEX_TABLES`. `CONCURRENTLY` avoids locking a live table. Example (fill the real list from Task 1):
```sql
-- server/migrations/2026-07-10-org-id-indexes.sql
-- Run each statement individually; CONCURRENTLY cannot run inside a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_organization_id ON contacts (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_organization_id ON deals (organization_id);
-- ...one line per table in MISSING_INDEX_TABLES...
```

- [ ] **Step 2: Write the verification query**

```sql
-- server/migrations/verify-org-id-indexes.sql
-- Lists every org table and whether an organization_id index now exists.
SELECT c.table_name,
       EXISTS (
         SELECT 1 FROM pg_index ix
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
         WHERE t.relname = c.table_name AND a.attname = 'organization_id'
       ) AS has_org_index
FROM information_schema.columns c
WHERE c.column_name = 'organization_id' AND c.table_schema = 'public'
ORDER BY has_org_index, c.table_name;
```

- [ ] **Step 3: Commit (do not run)**

```bash
git add server/migrations/2026-07-10-org-id-indexes.sql server/migrations/verify-org-id-indexes.sql
git commit -m "chore(db): org_id index migration + verification query (apply manually)"
```

- [ ] **Step 4: Hand off to Josh**

Report: "Run `2026-07-10-org-id-indexes.sql` statement-by-statement against the live DB (CONCURRENTLY can't run in a transaction), then run `verify-org-id-indexes.sql` — every row should show `has_org_index = true`." Append a dated entry to `references/pending-approvals.md` in the ais-os repo noting the migration awaits Josh's manual apply.

---

### Task 8: Final gate

- [ ] **Step 1: Full server suite green**

Run: `cd server && CI=true npx jest --silent`
Expected: all green — pre-existing 119 + `ownershipWhere` + `resolveOrg` + `clientIdor` + every module isolation test.

- [ ] **Step 2: Verify success criteria against the design doc**

Check each box in the design doc's "Success criteria" section. The index box is satisfied by Josh's verification-query output (Task 7), not by the test suite.

- [ ] **Step 3: Summary commit / branch status**

Confirm the branch `feat/multi-tenancy` holds all task commits and report the diff stat. Do not push unless Josh asks.

---

## Self-Review

- **Spec coverage:** §1 enforcement → Tasks 2, 3. §2 scope audit → Tasks 1, 5, 6. §3 client-portal boundary → Task 4. §4 indexes → Task 7. §5 isolation test gate → Tasks 3–6, 8. Non-goals (client migration) → excluded. All spec sections map to tasks.
- **Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Task 6 is an explicit per-module checklist that references the fully-worked Task 5 loop (not "similar to" — same documented steps). Real code in every code step. The only intentionally-deferred concrete values are the exact table lists, which are genuine discovery outputs of Task 1 (gated, not hand-wavy).
- **Type consistency:** `ownershipWhere(alias, resourceType, userId, role, orgId)` used consistently (Tasks 2 call sites). `resolveOrg(req,res,next)` and `Client.findById(clientId, orgId)` signatures match across tasks. Error codes `ORG_REQUIRED` / `ORG_AMBIGUOUS` / `UNAUTHENTICATED` consistent between impl and tests.
