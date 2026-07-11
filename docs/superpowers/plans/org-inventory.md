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
- `redditLeads` (reddit_leads) — DONE (Task 6): confirmed real gap, not intentionally-global.
  `reddit_leads` IS in ORG_TABLES (migration 062, organization_id NOT NULL). Delegated service
  (`services/redditMCPService.js`) makes zero DB queries (Anthropic API only, same shape as
  multiSourceLeadService); all 8 org-table `db.query` sites live directly in
  `routes/redditLeads.js` and are now organization_id-filtered/stamped. `reddit_search_configs`
  and `reddit_search_results` (also queried by this route file) are NOT in ORG_TABLES — no
  organization_id column since 062 — and were correctly left unfiltered. No background
  worker/cron found for Reddit sync. See org-isolation-progress.md Task 6 (redditLeads) entry.
- `multiSourceLeads` — DONE (Task 6): confirmed real gap, not intentionally-global.
  `unified_leads` IS in ORG_TABLES (migration 062, organization_id NOT NULL). Delegated
  service (`services/multiSourceLeadService.js`) makes zero DB queries (Anthropic API only);
  all 7 org-table `db.query` sites live directly in `routes/multiSourceLeads.js` and are now
  organization_id-filtered/stamped. See org-isolation-progress.md Task 6 (multiSourceLeads)
  entry.
- `compliance` — raw `pool.query`, known gap (Task 5 worked example)
- `sms` — DONE (Task 6): confirmed real gap, not intentionally-global. sms_messages,
  sms_optouts, sms_templates (migration 008) predate migration 062 and had no
  organization_id at all — added via migration 064 (sms_messages/sms_optouts derived
  precisely from their linked contact's org, NOT NULL; sms_templates nullable —
  NULL = platform-wide default template, set = org-owned custom template). All
  routes/sms.js queries + models/SMS.js + models/SMSTemplate.js + services/twilioService.js
  now org-filtered/stamped. Also fixed 5 call sites of a nonexistent `../models/index`
  module (POST /optout, POST /optin, GET /optouts, TwilioService.checkRateLimit,
  TwilioService.isOptedOut) that made those code paths always throw — a prerequisite
  to adding org filtering there at all. Fixed the Task-4-flagged Client.findById(contactId)
  single-arg regression (now org-scoped). See org-isolation-progress.md Task 6 (sms) entry
  and .superpowers/sdd/task-6-sms-report.md for full detail, including two pre-existing
  bugs found but left unfixed (out of scope): sms.js's contact helpers actually query the
  `clients` (client-portal) table/columns rather than `contacts`, and `models/Activity`
  does not exist anywhere in the codebase (SMS activity logging has always silently no-op'd).
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
  ADDENDUM (review follow-up): `deliverabilityRoutes` is mounted TWICE — flat at
  `/api/deliverability` (checked above) AND under the org router at
  `/api/org/:orgSlug/deliverability` (`index.js` orgRouter, behind `requireOrg`, which sets
  `req.orgId`/`req.org`). The service never reads `req.orgId` on either mount, so this is not a
  leak, but it means the `:orgSlug` segment on the org-scoped path is currently decorative — a
  user who belongs to two orgs gets identical mailbox data from both org-slug URLs. Functional
  quirk, not a security gap; note for whoever eventually builds org-wide mailbox visibility,
  since that feature would naturally start by making this existing path respect `req.orgId`.
- `integrations` — RESOLVED (Task 6). Not intentionally-global — was a real gap, fixed. See
  `integrations` entry below.

**Reclassify to intentionally-global if their tables are NOT in ORG_TABLES** (record reason here
during Task 6): (`agents` ruled out — see entry above; it does touch ORG_TABLES via a shared
service. `appSettings` CONFIRMED intentionally-global — see entry above. `deliverability`
CONFIRMED intentionally per-user-scoped (stronger than org-level isolation) — see entry above.
`integrations` ruled out — see entry below; its own direct query touches an ORG_TABLES table.)

- `integrations` (Task 6) — routes/integrations.js's OAuth token storage (`oauth_tokens`,
  migration 054, keyed on `(user_id, service_type)` via `services/oauth.js`) is genuinely
  per-user, not org-scoped — same shape as `deliverability`, no change needed there. But the
  file's own `POST /gcal/sync` route makes a direct Kysely insert into `calendar_events`
  (ORG_TABLES per migration 062, `organization_id` NOT NULL, no default) that omitted
  `organization_id` entirely — a real, previously-undiscovered logAction-class gap: every
  Google Calendar sync since 062 shipped has been throwing a not-null-violation per event,
  silently swallowed by the route's per-item try/catch (zero events have ever synced
  successfully). Fixed: added `organization_id: req.orgId` to the insert (never reassigned on
  conflict, per convention), and added route-level `resolveOrg` (not mount-level — this file
  also has public unauthenticated OAuth callbacks `/gmail/callback` and `/gcal/callback` that
  must keep working, matching the calendar.js/track.js pattern) so `req.orgId` is populated on
  both the flat `/api/integrations` mount and (redundantly/safely) the `/api/org/:orgSlug`
  mount. `gmail.js`/`googleCalendar.js` services make no DB writes at all (external API only).
  Isolation test: `server/src/tests/isolation/integrations.isolation.test.js`.
  KNOWN SEPARATE, DEFERRED FINDING (not fixed in this task, out of scope for the `integrations`
  route file itself): `POST /gmail/sync` queues a job processed by
  `workers/emailSyncWorker.js`, which delegates to `services/emailMatcher.js`. That service's
  `matchEmailToContact` does `INSERT INTO contacts (user_id, name, email, type)` — `contacts`
  is ORG_TABLES with `organization_id` NOT NULL — with no `organization_id` set, and
  `emailSyncWorker.js`'s `pauseActiveSequencesForInboundReplies` does
  `INSERT INTO activities (user_id, contact_id, type, description, occurred_at)` — `activities`
  is also ORG_TABLES NOT NULL — same gap. Both are wrapped in try/catch (contacts: swallowed
  per-contact; activities: unwrapped, would fail the whole sync job and trigger Bull retries).
  This is the same class of bug as the `logAction` finding from the `auditLogs` task (worker
  has no `req` in scope, needs the fail-closed `resolveOrgIdForUser`-style fallback threaded
  through job data). Left unfixed here to keep this task's diff to `integrations.js`'s own
  direct query, matching the precedent set by the `auditLogs` task (found `logAction`'s
  systemic gap, deferred it, it became its own dedicated follow-up task). RECOMMEND: a
  dedicated follow-up task for `emailMatcher.js` + `emailSyncWorker.js`, analogous to the
  `logAction` fix — thread `orgId` through the Bull job payload (`emailSyncQueue.add({ userId,
  labelIds, orgId })`) down through `syncUserEmails` → `processGmailMessage` →
  `matchEmailToContact`, with `resolveOrgIdForUser(userId)` (already exported from
  `services/auditLogger.js`) as the fail-closed fallback for any pre-existing queued jobs
  without `orgId` in their payload.

**Confirmed global (no change):** auth, clientAuth, stripe, webhooks, unsubscribe, orgs,
clientPortal (client-scoped via req.client.id).

## Notes for later tasks

- Task 3 `resolveOrg` mounts: apply to all flat org-data mounts (index.js ~218–250) whose module is
  in the audit/filtered set; NOT to the confirmed-global mounts above.
- Migration 062 already indexed organization_members(user_id) — resolveOrg's membership lookup is
  covered.
