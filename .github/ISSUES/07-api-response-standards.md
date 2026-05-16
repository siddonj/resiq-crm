# Phase 2.2 — API Response Standardization

**Labels:** `architecture`, `good-first-issue`
**Milestone:** Phase 2: Code Quality & Test Foundation
**Estimate:** 2 days

## Description

API responses are inconsistent across routes — some return `{ data: ... }`, others return arrays directly, others return `{ rows: ... }` from raw `pool.query`. Error responses vary even more.

A response middleware was started but not rolled out.

## Tasks

1. **Extend `server/src/middleware/responseHelpers.ts`** with:
   - `res.sendSuccess(data, meta?)` — `{ success: true, data, ...meta }`
   - `res.sendError(message, code?)` — `{ success: false, error: { message, code } }`
   - `res.sendPaginated(data, total, page, limit)` — standard pagination envelope

2. **Roll out across all 35 route files** — convert return statements to use helpers
   - Batch 1: Auth, users, teams, contacts
   - Batch 2: Deals, invoices, proposals, projects
   - Batch 3: Outbound automation, analytics, remaining files

## Acceptance Criteria

- [ ] All route files use standardized response helpers
- [ ] Frontend doesn't break (check for response shape assumptions)
- [ ] Paginated responses follow consistent shape
