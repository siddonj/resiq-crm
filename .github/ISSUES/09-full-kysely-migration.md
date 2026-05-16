# Phase 3 — Full Kysely Migration

**Labels:** `architecture`, `security`, `refactoring`
**Milestone:** Phase 3: Kysely Migration
**Estimate:** 1-2 weeks
**Depends on:** Phase 1.1 (db.js wrapper)

## Description

539 raw `pool.query()` calls remain across 28 route files. Each one is a SQL injection vector and a maintenance burden. Now that `db.js` exists (Phase 1.1), convert the remaining routes in batches.

## Batch Breakdown

### Batch 1 — Read-Heavy (SELECT only, simple)
- analytics (27 calls)
- contacts (21)
- clients (9)
- teams (9)
- users (12)
- activities (3)

### Batch 2 — Write-Heavy (INSERT/UPDATE)
- invoices (51 calls)
- proposals (11)
- timeEntries (10)
- reminders (4)
- sharing (5)

### Batch 3 — Complex Logic (JOINs, aggregate, dynamic filters)
- projects (119 calls, 2,382 lines)
- portfolios (14)
- sequences (15)
- integrations (3)

### Batch 4 — Remaining (handle carefully)
- outboundAutomation (reduced from 136 — most complex)
- clientPortal (23)
- tickets (18)
- calendar (17)
- deals (8)
- track (8)
- engagement (4)
- forms (4)
- leads (3)
- sms (1)
- clientAuth (1)
- multiSourceLeads (remaining)

## Reference

See `resiq-crm-kysely-migration` skill for full conversion patterns.

## Acceptance Criteria

- [ ] Zero `pool.query()` calls remain in route files
- [ ] Server starts and all endpoints respond correctly
- [ ] No regression in pagination, filtering, or sorting behavior
- [ ] `npx tsc --noEmit` passes
