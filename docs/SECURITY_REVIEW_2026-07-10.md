# Adversarial Review — resiq-crm — 2026-07-10

Four-lane review (security/tenant-isolation, code quality, performance, UX/a11y).
All CRITICAL/HIGH items were read end-to-end in source, not pattern-matched.

## Fixed in this pass (safe, isolated, test-gated — 119/119 tests pass)

- JWT verification pinned to `algorithms: ['HS256']` at all three verify sites
  (`middleware/auth.js`, `wsAuth.js`, `clientAuth.js`) — closes `alg:none`/confusion class.
- `requireOrg` fails closed with 401 if `req.user` is absent (was a latent TypeError → 500).
- Fixed broken `server` dev script (pointed at nonexistent `src/index.ts`; now `nodemon src/index.js`).

## CRITICAL — needs a decision before fixing (high blast-radius on live tenants)

These share ONE root cause: two disconnected authz systems — the global `users.role`
column vs. per-org `organization_members.role`. Patch them together, not piecemeal.

1. **`ownershipWhere('admin')` returns `1=1`** (`db.js:55`). A global `users.role='admin'`
   (which the "first registered user becomes admin" bootstrap, `auth.js:30`, hands out)
   sees EVERY tenant's rows. List routes build WHERE from `ownershipWhere` alone and never
   apply `orgWhere(req.orgId)`. VERIFIED.
2. **Legacy flat mounts** (`index.js:217-250`) mount the same routers with `auth` only —
   no `requireOrg`, `req.orgId` undefined. Read paths leak cross-tenant (no membership gate
   at all); write paths insert `organization_id: undefined` → 500. The client currently
   calls THESE routes (see UX #1), so they're live, not dormant. VERIFIED.
3. **`PUT /api/users/:id/role`** (`users.js:180`) updates any user id in any org, gated only
   by global `requireRole('admin')`. With #1, this is a cross-tenant account-takeover primitive.
   VERIFIED.

**Recommended remediation (one pass):** make org-scoped routes ALWAYS apply `orgWhere(req.orgId)`
regardless of role; delete the legacy flat mounts (client migrates to the org-scoped API client —
see UX #1, which it must do anyway); move role assignment to `organization_members.role`; reserve
global `users.role`/bootstrap for `is_super_admin` platform ops only. Add isolation tests asserting
`organization_id` is present in every list query for every role.

## HIGH

- **Client bypasses the org API entirely** (UX): every `pages/*.jsx` imports raw `axios` and hits
  `/api/contacts` etc.; the org-slug-prepending client (`api/api.js`, `hooks/use*Queries.js`) is
  written but unused. Switching orgs does NOT change displayed data. Fixing CRITICAL #2 forces this
  migration. Before wiring pages to the hooks, fold `orgSlug` into every React Query key
  (`hooks/*.js`) or org-switch will flash the previous org's cached rows.
- **Client IDOR** `GET /api/clients/:clientId` (`clients.js:85`) — no org filter; sibling list route has one.
- **SSRF DNS-rebinding TOCTOU** in `enrichmentWorker.js` — safety check and fetch resolve DNS
  independently; pin the resolved IP.
- **No error UI on any list page** — failed fetches (`.catch(console.error)`) render the empty state,
  indistinguishable from a genuinely empty org; no retry, no 401→login redirect.
- **Unbounded list endpoints** — deals/contacts/invoices/projects/proposals `SELECT ... ORDER BY
  created_at` with no LIMIT/pagination; O(n) payload + unindexed sort + client renders all rows.
- **Missing indexes** — 19 of 27 org-scoped tables have `organization_id NOT NULL` but no index
  (migration 062 indexed only 8); no `(user_id, created_at)` on deals/contacts for the default sort.

## MEDIUM / hygiene

- Per-row correlated `access_permission` subqueries on deals/contacts lists (compounds unbounded lists).
- N+1 write loops in outbound bulk actions (`services/outbound/leadService.js:165`, `sequenceService.js`).
- Public lead-capture endpoint shares the app-wide 300/15min limiter; no per-form cap on `customFields`.
- No focus trap / Escape / `aria-label` on ~90% of modals; standardize one `<Modal>` component.
- `outboundAutomation.js` is 4,939 lines (6× the repo's own 800-line cap); split by the existing
  `services/outbound/*` boundaries.
- 300× duplicated `catch { res.status(500).json({error:'Server error'}) }`; `responseHelpers` exists
  and is registered but adopted in only 2 of 41 route files. Add `asyncHandler` + central error middleware.
- Dead weight: `CLAUDE_1.md` (foreign — it's the Operator's Edge repo's CLAUDE.md), `test-models.js`,
  duplicate `yarn.lock` (repo uses npm), orphaned `.ts` files (abandoned migration), ~30 stale
  root phase/status docs, unused root langchain deps.
