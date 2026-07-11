# Org-Isolation Remediation — Design

**Date:** 2026-07-10
**Branch:** `feat/multi-tenancy`
**Decision:** Keep multi-tenancy (do not strip). Make org isolation correct, provable, and fast, without churning the client. Approach **B** (server-derived org + structural enforcement).

## Context

resiq-crm has a half-wired multi-tenant layer. Ground truth as of this design:

- Route modules self-apply `auth` per handler, then are mounted **twice** in `server/src/index.js`:
  flat (`/api/contacts`, lines ~218–250) and org-scoped (`/api/org/:orgSlug/contacts` via `orgRouter`, lines ~253–292). Same handlers, two contexts.
- Flat mounts are authenticated but never run `requireOrg`, so `req.orgId` is `undefined` there.
- Authorization is by `user_id`/role via `ownershipWhere` in `server/src/db.js`. The `admin`
  branch returns `sql\`1 = 1\`` — full visibility across **all** orgs. `orgWhere(orgId)` is applied
  inconsistently on top.
- `ownershipWhere` is *called* in only 2 modules: `routes/contacts.js`, `routes/deals.js`.
- ~10 org-data route modules apply **no** org filter at all: `agents`, `appSettings`, `auditLogs`,
  `compliance`, `deliverability`, `integrations`, `multiSourceLeads`, `redditLeads`, `sms`, `workflows`.
- Client portal routes (`routes/clientPortal.js`) already scope by `req.client.id` — correct. The
  IDOR is operator-side: `routes/clients.js` `GET /:clientId` via `models/client.js` `findById`
  (raw `SELECT ... WHERE id = $1`, no org filter).
- Client: 27 pages call raw axios against flat routes; only 2 use a shared api client.
- DB schema + indexes live in the live Postgres DB (created via ad-hoc `run-migration.js` scripts),
  not in repo.

**Tenant reality (confirmed):** one org (ResiQ), one operator (Josh). No live cross-tenant leak
today — the exposure is latent and only materializes when org #2 is added. Josh runs DB migrations.

This lets us pick the simplest correct path and defer the expensive client migration (YAGNI until a
real second tenant exists).

## Goals

1. Org isolation is **enforced structurally**, not per-handler, so it cannot silently drift.
2. Cross-org access is **provable** via an automated isolation test that gates "done".
3. Org-scoped queries are **indexed** so isolation costs no measurable performance.
4. **Zero client churn** — the existing flat routes stay and become org-safe.

## Non-Goals (deferred to tenant-#2 onboarding)

- Migrating the 27 client pages to URL-based `/api/org/:slug/...` routes.
- Folding `orgSlug` into React Query keys.
- Deleting the flat mounts.

Flat mounts stay and are secured server-side by `resolveOrg` (below). URL-based org slugs become a
clean follow-up when a second customer is actually onboarded.

## Design

### 1. Enforcement mechanism — structural org scoping

**`resolveOrg` middleware (new, `server/src/middleware/resolveOrg.js`).**
Applied to the flat mounts. Behavior:

- If `req.params.orgSlug` is present, defer to existing `requireOrg` (no double work — flat mounts
  have no slug, so this branch is for safety/reuse only).
- Else derive org from the caller: look up `organization_members` for `req.user.id`.
  - Exactly one membership → set `req.orgId`, `req.orgRole` from it.
  - `req.user.is_super_admin` with no membership → documented rule: fail closed (403) on
    org-scoped flat routes; super-admin uses the explicit org-slug routes. (Single-operator today
    means this branch is not exercised; the rule prevents an unscoped super-admin query.)
  - Zero memberships (non-super-admin) → fail closed (403).
- Must run **after** `auth`. Fails closed (401) if `req.user` is absent.

Org is derived from server-side membership, not from the URL or token claims — tamper-proof.

**`ownershipWhere` change (`server/src/db.js`).**
New signature: `ownershipWhere(alias, resourceType, userId, role, orgId)`.

- Every returned predicate is ANDed with `${sql.ref(alias + '.organization_id')} = ${orgId}`.
- The `admin` branch returns `organization_id = orgId` (org-wide within the tenant) instead of `1 = 1`.
- Manager / user / viewer branches keep their existing user/team/shared logic, additionally
  constrained to the org.
- `orgId` is required; callers must pass `req.orgId`. If `orgId` is nullish the helper throws
  (fail-closed) rather than emitting an unscoped query.

Update the 2 call sites (`contacts.js`, `deals.js`) to pass `req.orgId`.

### 2. Scope audit — close unfiltered org-data routes

For each of the ~10 org-data modules with no filter:

1. Confirm the underlying table(s) actually have an `organization_id` column via one
   `information_schema.columns` introspection query (implementation step 1).
2. For tables **with** `organization_id`: add `orgWhere(req.orgId)` / `.where('organization_id','=',req.orgId)`
   to every read, update, and delete; set `organization_id` on every insert.
3. For tables **without** an org column: document as intentionally global (e.g. system/config tables)
   in the implementation notes; leave unchanged.

Modules confirmed global and left unchanged: `auth`, `clientAuth`, `stripe`, `webhooks`,
`unsubscribe`, `orgs`, `clientPortal` (client-scoped).

### 3. Client-portal boundary

- Fix `routes/clients.js` `GET /:clientId` to scope by `req.orgId` (and any other `findById`-based
  operator path that returns client rows). Add `organization_id = req.orgId` to `models/client.js`
  `findById`, or filter at the route — implementation picks the tighter option.
- Portal routes (`clientPortal.js`) already scope by `req.client.id`; leave them.

### 4. Indexes

A reviewed migration script (`server/migrations/2026-07-10-org-id-indexes.js` or `.sql`) that:

- Adds `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_<table>_organization_id ON <table>(organization_id)`
  for every org-scoped table missing one (list derived from the step-1 introspection).
- Ships with a verification query listing each org-scoped table and whether an `organization_id`
  index exists.

Josh applies it against the live DB. `CONCURRENTLY` avoids table locks on a live database.

### 5. Isolation test gate

New integration suite (`server/src/tests/orgIsolation.test.js` or similar):

- Seed org A and org B, each with one operator user.
- For **every** org-scoped resource, assert that org A's token cannot read, list, update, or delete
  a single org B row (expect 403 / 404 / empty result — never org B data).
- Include the operator-side client IDOR case.

This suite is the gate: the remediation is not "done" until it is green. Requires the integration
test DB harness — confirming that harness exists (or standing up a minimal one) is implementation
step 1, before any code changes.

## Success criteria

- [ ] `ownershipWhere` cannot emit an unscoped query (throws on nullish `orgId`); admin is org-bound.
- [ ] Every flat org-data route resolves `req.orgId` via `resolveOrg` and filters by it.
- [ ] Operator-side client IDOR closed.
- [ ] `organization_id` index present on every org-scoped table (verification query clean).
- [ ] Isolation test suite green; existing `server` jest suite (119 tests) still green.
- [ ] No client-side changes.

## Rollout

All work on `feat/multi-tenancy`. Code lands first (middleware, ownershipWhere, audits, IDOR, tests).
The index migration is delivered as a script Josh runs against the live DB, with the verification
query to confirm before/after. Because there is one tenant today, there is no live cutover risk.
