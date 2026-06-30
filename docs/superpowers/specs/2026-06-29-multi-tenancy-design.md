# Multi-Tenancy Design — resiq-crm
**Date:** 2026-06-29
**Status:** Approved, pending implementation

---

## Context

resiq-crm is currently single-tenant: all data in every table belongs to one implicit account. The goal is to add row-level multi-tenancy so each property-tech consulting client gets a fully isolated workspace, while super-admins (the owner + team) retain cross-org visibility.

This design was informed by a comparison with [ever-co/ever-gauzy](https://github.com/ever-co/ever-gauzy), a multi-org ERP/CRM platform. The key capability gap identified was multi-organization support.

---

## Goals

- Each consulting client gets an isolated org workspace (their own contacts, deals, projects, invoices, etc.)
- Super-admins can access and switch between all orgs
- Client users are locked to their own org only
- URLs carry the org context: `/org/:slug/contacts`
- Existing data migrates cleanly into a "Default" org — no data loss

---

## Non-Goals

- Schema-per-tenant or database-per-tenant (over-engineered at this scale)
- Billing/subscription management per org (out of scope for this phase)
- Custom domains or subdomains per org (path prefix is sufficient)
- White-label theming per org

---

## Approach: Row-Level Tenancy

Every tenant-scoped table gains an `organization_id` FK. An `organizations` table and `organization_members` junction table anchor the multi-tenant model. A `requireOrg` middleware resolves and validates org access on every protected request.

**Why row-level over schema-per-tenant:**
- Fits the existing Kysely ORM setup with minimal friction
- Single DB keeps cross-org super-admin queries simple
- The data-leak risk (missing filter bug) is fully mitigated by an isolation test suite run in CI

---

## Section 1: Data Model

### New tables

```sql
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organization_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'member',
  -- roles: 'owner' | 'admin' | 'member' | 'viewer'
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);
```

### Column addition — all tenant-scoped tables (~40 tables)

```sql
ALTER TABLE contacts       ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE deals          ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE activities     ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE proposals      ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE invoices       ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE time_entries   ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE projects       ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE project_tasks  ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE portfolios     ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE reminders      ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE forms          ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE tickets        ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_leads          ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_campaigns      ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_drafts         ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE outbound_sequence_steps ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE sequences      ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE clients        ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE calendar_events ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE workflows      ADD COLUMN organization_id UUID REFERENCES organizations(id);
-- ... full list enumerated in migration file
```

### Super-admin flag

```sql
ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
```

### Migration: existing data → Default org

```sql
-- 1. Create the default org
INSERT INTO organizations (name, slug) VALUES ('Default', 'default') RETURNING id;

-- 2. Backfill all tenant-scoped tables with the default org id
UPDATE contacts       SET organization_id = '<default_id>';
UPDATE deals          SET organization_id = '<default_id>';
-- ... all tables

-- 3. Mark owner + team as super-admins
UPDATE users SET is_super_admin = TRUE WHERE email IN ('siddonj@gmail.com');

-- 4. Add default org members for existing users
INSERT INTO organization_members (organization_id, user_id, role)
SELECT '<default_id>', id, 'owner' FROM users WHERE is_super_admin = TRUE;
```

### Post-migration validation (runs before server boot)

```sql
-- Must return 0 rows on all tables or migration aborts
SELECT 'contacts' AS tbl, COUNT(*) FROM contacts WHERE organization_id IS NULL
UNION ALL
SELECT 'deals',   COUNT(*) FROM deals   WHERE organization_id IS NULL
-- ... all tenant-scoped tables
```

---

## Section 2: Auth & Middleware

### Route namespace

All tenant-scoped API routes are mounted under `/api/org/:orgSlug`:

```js
// server/src/index.js
const orgRouter = express.Router({ mergeParams: true });
orgRouter.use(authenticate);   // existing JWT middleware
orgRouter.use(requireOrg);     // new — resolves org from :orgSlug param

orgRouter.use('/contacts',  contactsRouter);
orgRouter.use('/deals',     dealsRouter);
orgRouter.use('/projects',  projectsRouter);
orgRouter.use('/invoices',  invoicesRouter);
// ... all 35+ route files

app.use('/api/org/:orgSlug', orgRouter);
```

Non-org routes remain unchanged: `/api/auth`, `/api/health`, `/api/book/:slug`, `/api/orgs`.

### `requireOrg` middleware

**File:** `server/src/middleware/requireOrg.js`

```js
const CACHE_TTL = 300; // 5 minutes

async function requireOrg(req, res, next) {
  const { orgSlug } = req.params;
  const cacheKey = `org:slug:${orgSlug}`;

  // Redis cache to avoid a DB round-trip on every request
  let org = await redis.get(cacheKey).then(v => v && JSON.parse(v));

  if (!org) {
    org = await db.selectFrom('organizations')
      .where('slug', '=', orgSlug)
      .select(['id', 'name', 'slug'])
      .executeTakeFirst();

    if (!org) return res.sendError('Organization not found', 'ORG_NOT_FOUND', 404);
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(org));
  }

  if (!req.user.is_super_admin) {
    const membership = await db.selectFrom('organization_members')
      .where('organization_id', '=', org.id)
      .where('user_id', '=', req.user.id)
      .select('role')
      .executeTakeFirst();

    if (!membership) return res.sendError('Access denied', 'ORG_FORBIDDEN', 403);
    req.orgRole = membership.role;
  }

  req.orgId = org.id;
  req.org   = org;
  next();
}

module.exports = { requireOrg };
```

### Kysely `orgWhere` helper

**File:** `server/src/db.js` (added alongside existing `ownershipWhere`)

```js
// Filters by organization_id — use on all tenant-scoped queries
function orgWhere(orgId) {
  return (qb) => qb.where('organization_id', '=', orgId);
}

// Filters by both org and user — use for personal records (reminders, time entries)
function orgUserWhere(orgId, userId) {
  return (qb) => qb
    .where('organization_id', '=', orgId)
    .where('user_id', '=', userId);
}

module.exports = { db, sql, pool, ownershipWhere, orgWhere, orgUserWhere };
```

Usage in routes:

```js
// Most routes — org-scoped only
const contacts = await db.selectFrom('contacts')
  .$call(orgWhere(req.orgId))
  .selectAll()
  .execute();

// Personal records — org + user scoped
const reminders = await db.selectFrom('reminders')
  .$call(orgUserWhere(req.orgId, req.user.id))
  .selectAll()
  .execute();
```

---

## Section 3: Frontend Routing & Org Context

### React Router structure

```jsx
// src/App.jsx
<Routes>
  {/* Public — unchanged */}
  <Route path="/login"       element={<Login />} />
  <Route path="/book/:slug"  element={<BookingPage />} />

  {/* Org-scoped shell */}
  <Route path="/org/:orgSlug" element={<OrgShell />}>
    <Route path="contacts"         element={<Contacts />} />
    <Route path="deals"            element={<Pipeline />} />
    <Route path="projects"         element={<Projects />} />
    <Route path="projects/:id"     element={<ProjectDetail />} />
    <Route path="portfolios"       element={<Portfolios />} />
    <Route path="invoices"         element={<Invoices />} />
    <Route path="proposals"        element={<Proposals />} />
    <Route path="outbound"         element={<OutboundAutomation />} />
    <Route path="calendar"         element={<Calendar />} />
    <Route path="help"             element={<HelpDesk />} />
    <Route path="settings"         element={<Settings />} />
    {/* ... all existing pages */}
  </Route>

  {/* Post-login landing — resolves to correct org */}
  <Route path="/" element={<OrgRedirect />} />
</Routes>
```

### `OrgShell` and `OrgContext`

**File:** `src/context/OrgContext.jsx`

```jsx
const OrgContext = createContext(null);
let _activeOrgSlug = null; // module-level ref for axios interceptor

export function OrgShell() {
  const { orgSlug } = useParams();
  _activeOrgSlug = orgSlug;

  const { data: org, isLoading } = useQuery({
    queryKey: ['org', orgSlug],
    queryFn: () => apiClient.get(`/api/orgs/${orgSlug}`).then(r => r.data),
  });

  if (isLoading) return <FullPageSpinner />;

  return (
    <OrgContext.Provider value={org}>
      <AppLayout />
      <Outlet />
    </OrgContext.Provider>
  );
}

export const useOrg = () => useContext(OrgContext);
export const getActiveOrgSlug = () => _activeOrgSlug;
```

### Axios interceptor — org slug injected automatically

```js
// src/api/api.js
import { getActiveOrgSlug } from '../context/OrgContext';

const apiClient = axios.create({ baseURL: '/api' });

apiClient.interceptors.request.use((config) => {
  const slug = getActiveOrgSlug();
  if (slug && !config.url.startsWith('/auth') && !config.url.startsWith('/orgs')) {
    config.url = `/org/${slug}${config.url}`;
  }
  config.headers.Authorization = `Bearer ${getToken()}`;
  return config;
});
```

All existing API calls (`apiClient.get('/contacts')`) automatically resolve to
`/api/org/acme/contacts` with zero changes to individual API modules.

### Post-login org redirect

```jsx
// src/pages/OrgRedirect.jsx
export function OrgRedirect() {
  const { data: orgs } = useQuery(['my-orgs'], () =>
    apiClient.get('/api/orgs/mine').then(r => r.data)
  );

  if (!orgs) return <FullPageSpinner />;
  if (orgs.length === 1) return <Navigate to={`/org/${orgs[0].slug}`} replace />;
  return <OrgPicker orgs={orgs} />;  // super-admin or multi-org user
}
```

---

## Section 4: Organization Management

### Global (non-org-scoped) API routes

```
GET    /api/orgs              -- super-admin: list all orgs
POST   /api/orgs              -- super-admin: create org
GET    /api/orgs/mine         -- current user: list my orgs
GET    /api/orgs/:slug        -- resolve org metadata by slug (used by OrgShell)
```

### Org-scoped member management routes

```
GET    /api/org/:orgSlug/members              -- list members
POST   /api/org/:orgSlug/members/invite       -- invite by email
PATCH  /api/org/:orgSlug/members/:userId      -- change role
DELETE /api/org/:orgSlug/members/:userId      -- remove member
```

### Org creation

`POST /api/orgs` (super-admin only):
1. Validate slug uniqueness; auto-generate from name if omitted
2. Insert into `organizations`
3. Insert creator as `role: 'owner'` in `organization_members`
4. Return org object — frontend redirects to `/org/:slug`

### Member invite flow

`POST /api/org/:orgSlug/members/invite`:
- If user exists → insert `organization_members` row immediately
- If user doesn't exist → create a pending invite record; email a signup link scoped to the org (`/signup?invite=<token>`)
- On invite acceptance → create user + insert membership in a single transaction

### Super-admin control panel

Route: `/admin` (only rendered when `user.is_super_admin === true`)

Features:
- Table: all organizations (name, slug, member count, created date)
- Quick-switch button → navigates to `/org/:slug/contacts`
- Create org form (name + slug)
- Per-org member management (inline expand)

No new data model required — thin UI over the routes above.

---

## Section 5: Testing Strategy

### Cross-org isolation tests (CI gate)

One test file per route module. A missing `organization_id` filter on any query is caught before merge.

**Pattern** (`server/tests/isolation/<module>.isolation.test.js`):

```js
describe('<module> — cross-org isolation', () => {
  let orgA, orgB, userA, userB, superAdmin;

  beforeAll(async () => {
    orgA  = await createTestOrg('org-a');
    orgB  = await createTestOrg('org-b');
    userA = await createTestUser({ orgId: orgA.id });
    userB = await createTestUser({ orgId: orgB.id });
    superAdmin = await createTestSuperAdmin();
    await seedOrgData(orgA.id); // create contacts/deals/etc. in org-a
  });

  it('org-b user cannot read org-a data', async () => {
    const res = await request(app)
      .get('/api/org/org-b/<resource>')
      .set('Authorization', `Bearer ${tokenFor(userB)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('super-admin can read org-a data via org-a slug', async () => {
    const res = await request(app)
      .get('/api/org/org-a/<resource>')
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
```

Applied to: contacts, deals, activities, proposals, invoices, projects, portfolios, outbound_leads, outbound_campaigns, sequences, tickets, time_entries, reminders, forms, calendar_events, workflows.

### `requireOrg` middleware unit tests

```js
it('returns 403 when authenticated user is not an org member', ...);
it('returns 404 for a non-existent org slug', ...);
it('super-admin bypasses membership check', ...);
it('caches org lookup in Redis (only one DB call on repeat requests)', ...);
```

### Migration validation

Runs as part of `run-all-migrations.js` before the server starts:

```js
const tables = ['contacts', 'deals', 'activities', ...];
for (const tbl of tables) {
  const { count } = await db
    .selectFrom(tbl)
    .where('organization_id', 'is', null)
    .select(db.fn.count('id').as('count'))
    .executeTakeFirstOrThrow();

  if (Number(count) > 0) {
    throw new Error(`Migration incomplete: ${count} rows in ${tbl} have null organization_id`);
  }
}
```

---

## Build Order

1. **Migration** — `organizations`, `organization_members` tables; `organization_id` columns on all tables; `is_super_admin` on users; default-org backfill
2. **Backend middleware** — `requireOrg`, `orgWhere`/`orgUserWhere` helpers, org management routes
3. **Route updates** — add `orgWhere(req.orgId)` filter to every route (mechanical, ~35 files)
4. **Isolation tests** — write + pass CI gate before any frontend work
5. **Frontend routing** — `OrgShell`, `OrgContext`, axios interceptor, `OrgRedirect`
6. **Org management UI** — org picker, member invite, super-admin panel

---

## Key Invariants

- Every query against a tenant-scoped table must include `organization_id = req.orgId`
- `requireOrg` must run before any route handler that touches tenant data
- Super-admin access (`is_super_admin = true`) bypasses membership checks but still scopes to a specific org via the URL slug
- The default org (`slug: 'default'`) is the migration target for all pre-existing data
- Org slugs are immutable after creation (URLs would break on rename)
