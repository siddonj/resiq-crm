# Org-Isolation Inventory (Task 1 deliverable)

Derived from `database/migrations/062-multi-tenancy.sql` + current route-code grep. Schema is
migration-managed, so no live DB query was required for the inventory. Only the index migration
(Task 7) needs a live apply.

## ORG_TABLES (have `organization_id`, per migration 062)

activities, audit_logs, calendar_events, clients, contacts, deals, engagement_tracking, forms,
invoices, outbound_campaigns, outbound_leads, outbound_message_drafts, portfolios, project_tasks,
projects, proposals, reddit_leads, reminders, sequence_steps, sequences, shared_resources,
stage_automation_rules, tags, teams, tickets, time_entries, unified_leads, workflows

Org-infra tables (not tenant data, excluded from filtering): organizations, organization_members,
organization_invites, users (has `is_super_admin`).

## Indexed on organization_id (CREATE INDEX present in 062)

contacts, deals, projects, invoices, outbound_leads, activities  (6)
(plus organization_invites(organization_id), organization_members(user_id) — infra)

## MISSING_INDEX_TABLES (in ORG_TABLES, no organization_id index in 062) → Task 7 target

audit_logs, calendar_events, clients, engagement_tracking, forms, outbound_campaigns,
outbound_message_drafts, portfolios, project_tasks, proposals, reddit_leads, reminders,
sequence_steps, sequences, shared_resources, stage_automation_rules, tags, teams, tickets,
time_entries, unified_leads, workflows  (~22)

Confirm against the live DB before/after with `verify-org-id-indexes.sql` (Task 7) — a later ad-hoc
migration may have added some. Treat this list as the upper bound.

## UNFILTERED_MODULES (route modules that query an org table but apply no org filter)

From grep on current branch (no `req.orgId` / `orgWhere` / `ownershipWhere`), cross-referenced with
the original build's ledger which flagged the raw-SQL files as a known gap:

**Confirmed org-data, unfiltered — Task 6 audit set:**
- `redditLeads` (reddit_leads) — raw `pool.query`, known gap
- `multiSourceLeads` (unified_leads) — raw `pool.query`, known gap
- `compliance` — raw `pool.query`, known gap (Task 5 worked example)
- `sms` — verify tables; likely org-scoped
- `workflows` (workflows, stage_automation_rules) — verify
- `agents` — DONE (Task 6): agents.js has no direct queries, but its /prospect/import route
  delegates to agentProspectService.importProspects, which raw-inserts into `contacts` and
  `deals` (both ORG_TABLES). Confirmed NOT intentionally-global — organization_id now
  stamped on both inserts. See org-isolation-progress.md Task 6 (agents) entry.
- `appSettings` — CONFIRMED intentionally-global (Task 6). Its only table, `app_settings`
  (migration 023: `setting_key` PK, `setting_value`, `updated_by`, `updated_at`), has no
  `organization_id` and is not in ORG_TABLES. Route (`routes/appSettings.js`) and its sole
  service (`services/appSettings.js`) query only this table via `pool.query`, gated behind
  `requireRole('admin')`; no delegation to any service touching ORG_TABLES (traced the way
  `agents` was, to avoid repeating that module's mistake — genuinely no tenant-data path here).
  Rows are admin-managed runtime feature flags / rate limits (e.g. `allow_synthetic_leads`,
  `outbound_daily_email_send_limit`) that apply app-wide by design, not per-tenant. No filtering
  added, no isolation test added (would be a no-op). `/api/app-settings` mount's
  `authMiddleware, resolveOrg` (Task 3) is left as-is — harmless, out of scope to remove.
  Read-side consumers beyond the two files traced: `routes/multiSourceLeads.js`,
  `services/multiSourceLeadService.js` (read `allow_synthetic_leads`), and
  `routes/outboundAutomation.js:getDailySendUsage` (reads the two `outbound_daily_*_limit`
  keys, enforced per-`user_id` app-wide). KNOWN LIMITATION, not a bug: if resiq-crm later needs
  per-org daily send limits (a plausible real SaaS requirement — different orgs may want
  different sending caps by plan/reputation), `app_settings` will need an `organization_id`
  column or a per-org override table at that point. Not added now per YAGNI — no current
  product requirement — but flagged here so it isn't rediscovered as a surprise later.
- `auditLogs` (audit_logs) — Task 6: complete. GET /api/audit-logs read path was
  unfiltered (real gap, not just "verify"); now filters both the SELECT and COUNT
  queries by `organization_id = req.orgId` unconditionally (server-derived, not a
  query param). Write side (`services/auditLogger.js`'s `logAction`, INSERT INTO
  audit_logs) is called from ~20 other route/service files across the codebase and
  does NOT stamp organization_id on any of them — flagged as a separate, likely
  systemic gap for the plan owner; out of scope for this module-scoped task (only
  auditLogs.js's own queries were in scope).
- `deliverability` — CONFIRMED intentionally per-user-scoped, not a gap (Task 6). Traced
  routes/deliverability.js → services/outbound/deliverabilityService.js (its only caller,
  whole-repo grep confirmed no other route/service requires this module or queries
  `outbound_mailboxes` / `outbound_mailbox_daily_stats` directly). Both tables (migration 061)
  key on `user_id` (FK to `users`, NOT NULL), not `organization_id`; neither table is in
  ORG_TABLES nor appears in 062/063. Every query (7 pool.query call sites: list/get/create/
  update/delete mailbox, refreshMailboxAuth, recentStatsByMailbox, todaySentByMailbox,
  recordMailboxEvent) filters or inserts on `req.user.id`, which is server-derived from a
  verified JWT + DB lookup in `middleware/auth.js` (never client-supplied). Because a user's
  `id` is 1:1 with their authenticated identity regardless of which org they're acting in,
  filtering by `user_id` is strictly tighter than org-level isolation — a user in Org A can
  never see Org B's mailboxes without also compromising their own session, since the rows are
  owned by the specific `user_id` that created them, not shared across org teammates. This
  differs from `appSettings` (global across ALL users/orgs by design) — `deliverability` is
  global across orgs but private per-user, which is a stronger isolation guarantee, not a
  weaker one. Client page (`client/src/pages/Deliverability.jsx`) has no team/org-sharing UI,
  consistent with "personal sending identity" as the intended model. No code change, no
  migration, no isolation test added (would be a no-op — there is no org-level filter to
  prove). KNOWN LIMITATION (not a bug, YAGNI): if resiq-crm later wants org-wide shared
  sending mailboxes (teammates rotating through a shared pool), `outbound_mailboxes` will need
  an `organization_id` column and a product decision on visibility — not needed today.
- `integrations` — verify whether integration tokens are org-scoped

**Reclassify to intentionally-global if their tables are NOT in ORG_TABLES** (record reason here
during Task 6): candidates are `integrations`. (`agents` ruled out — see entry above; it does
touch ORG_TABLES via a shared service. `appSettings` CONFIRMED intentionally-global — see entry
above. `deliverability` CONFIRMED intentionally per-user-scoped (stronger than org-level
isolation) — see entry above.)

**Confirmed global (no change):** auth, clientAuth, stripe, webhooks, unsubscribe, orgs,
clientPortal (client-scoped via req.client.id).

## Notes for later tasks

- Task 3 `resolveOrg` mounts: apply to all flat org-data mounts (index.js ~218–250) whose module is
  in the audit/filtered set; NOT to the confirmed-global mounts above.
- Migration 062 already indexed organization_members(user_id) — resolveOrg's membership lookup is
  covered.
