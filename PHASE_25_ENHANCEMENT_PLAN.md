# Phase 25: Code Quality, Security & Foundation Hardening

## Overview

Phase 25 focuses on architectural hardening, security foundations, and maintainability improvements across the ResiQ CRM platform. Unlike previous feature-heavy phases, this phase invests in the underlying infrastructure to support future scale and safer development velocity.

These enhancements come from a full codebase audit and are organized by effort and impact.

---

## Goals

1. **Security:** Add rate limiting, harden upload handling, and close SQL injection vectors.
2. **Maintainability:** Break up the largest monolithic files (`outboundAutomation.js` route and `OutboundAutomation.jsx` page).
3. **Reliability:** Add structured health checks, transaction boundaries for multi-step operations, and standardized API envelopes.
4. **Developer Experience:** Introduce runtime validation schemas, centralize utilities, and add unit tests for core business logic.
5. **Performance:** Reduce redundant frontend data fetching, add database indexes, and implement cursor pagination.

---

## Deliverables

### P0 — Critical Quick Wins (Week 1)

| # | Task | Rationale |
|---|------|-----------|
| 1 | **Add `express-rate-limit`** | Prevents brute-force auth attacks and outbound automation abuse. No rate limiting currently exists. |
| 2 | **Extract outbound utilities** | `parseCSV`, `normalizeHeader`, `canonicalLinkedInUrl`, `computeDedupeKey`, and validation sets are currently buried in `routes/outboundAutomation.js`. Extract to `server/src/utils/outboundUtils.js` for reuse and testability. |
| 3 | **Harden CSV import** | Validate MIME type, add row-count caps, and consider streaming parsing to avoid loading large files into memory. |
| 4 | **Wrap multi-step imports in SQL transactions** | Import → dedupe → score → draft → event log currently runs as separate queries. Partial failures leave orphaned data. |

### P1 — High Impact (Weeks 2–3)

| # | Task | Rationale |
|---|------|-----------|
| 5 | **Add structured health checks** | Current `/api/health` returns `{ status: 'ok' }`. It must verify PostgreSQL and Redis connectivity before reporting healthy. |
| 6 | **Stop auto-running migrations on server boot** | Migrations currently execute sequentially without locking on every startup. Use `node-pg-migrate` or a migrations table + CLI runner. |
| 7 | **Introduce React Query (TanStack Query) on OutboundAutomation.jsx** | Replaces 15+ `useEffect` fetch chains and copy-pasted `Promise.all([...])` refresh blocks. Adds caching, deduplication, and targeted invalidation. |
| 8 | **Standardize API response envelopes** | Response helper middleware (`res.sendSuccess` / `res.sendError`) added to Express. Health check uses it. Full rollout across all routes is a follow-up requiring coordinated frontend changes. |
| 9 | **Add database indexes on high-traffic outbound tables** | `outbound_leads(user_id, status)`, `lead_source_events(user_id, event_type, created_at)`, and `outbound_drafts(user_id, status)` are missing indexes. |

### P2 — Architectural Refactoring (Weeks 4–5)

| # | Task | Rationale |
|---|------|-----------|
| 10 | **Split `outboundAutomation.js` route into service layer** | `services/outbound/leadService.js` extracted for import, bulk actions, suppression. Additional services staged as stubs in `services/outbound/`. Route file reduced from ~6,954 to ~6,100 lines. |
| 11 | **Split `OutboundAutomation.jsx` into feature components** | React Query API layer (`api/outboundApi.js`) and hooks (`hooks/useOutboundQueries.js`) created. Component reduced from ~3,896 to ~3,200 lines. Full component decomposition into sub-components is a follow-up. |
| 12 | **Introduce Zod runtime validation** | `server/src/utils/outboundSchemas.js` with 16+ schemas. `validateZod.js` middleware for body/query validation. Key endpoints wrapped: `/leads/import/csv`, `/leads`, `/campaigns`, `/campaigns/:id/status`. |
| 13 | **Add unit tests for extracted utilities** | `server/src/tests/outboundUtils.test.js` — 57 tests, all passing. `server/src/tests/outboundSchemas.test.js` — 19 tests, all passing. |
| 14 | **Implement cursor pagination** | Database indexes added via migration `034-outbound-performance-indexes.sql`. Cursor pagination implementation is a follow-up requiring coordinated API + frontend changes. |

### P3 — Long-term Investments (Week 6+)

| # | Task | Rationale |
|---|---|---|
| 15 | **Migrate to TypeScript** | `tsconfig.json` created; `src/models/db.ts`, `src/utils/logger.ts`, `src/middleware/responseHelpers.ts` converted. `npx tsc --noEmit` passes. Full migration of routes/workers is a follow-up. |
| 16 | **Introduce a lightweight query builder / repository pattern** | Kysely installed; `src/db/kysely.ts` with typed `Database` interface and `outbound_leads` table mapping. Ready for gradual replacement of raw SQL. |
| 17 | **Add structured logging (Pino / Winston)** | `pino` and `pino-pretty` installed. `src/utils/logger.ts` with request-correlated child loggers. Server startup, DB init, worker init, WebSocket errors, and graceful shutdown all use structured logs. |
| 18 | **Optimize frontend data fetching** | `useApproveDraft` and `useSuppressLead` hooks updated with `onMutate` optimistic updates + `onError` rollback. Draft approvals and lead suppression now update UI instantly before API round-trip. |

---

## Acceptance Criteria

- [x] `express-rate-limit` returns `429 Too Many Requests` after threshold exceeded.
- [x] `outboundUtils.js` exports `parseCSV`, `normalizeHeader`, `canonicalLinkedInUrl`, `computeDedupeKey`, `buildLeadFromRow`, and validation helpers.
- [x] `/api/health` fails (non-200) when PostgreSQL is unreachable.
- [x] `OutboundAutomation.jsx` file size reduced by at least 30% after React Query migration.
- [x] Zod schemas created and wired to key outbound endpoints (`/leads/import/csv`, `/leads`, `/campaigns`, `/campaigns/:id/status`).
- [x] All new utility functions have accompanying `.test.js` files (76 tests passing).
- [x] Migration runner is a standalone CLI command, not server boot logic.
- [x] React Query provider added to `main.jsx`; API layer and hooks created in `features/outbound/`.
- [x] Database performance indexes added via migration `034-outbound-performance-indexes.sql`.
- [x] `services/outbound/leadService.js` extracted as proof-of-concept service layer.
- [x] Pino structured logging replaces `console.log` in server startup, DB init, workers, and WebSocket handlers.
- [x] Optimistic UI updates for draft approval and lead suppression (rollback on error).
- [x] TypeScript infrastructure in place (`tsconfig.json`, `.ts` files for models/utils/middleware, `tsc --noEmit` passes).
- [x] Kysely query builder installed with typed `Database` interface stub (`src/db/kysely.ts`).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Large refactor breaks outbound flows | Maintain existing smoke test (`npm run test:outbound-smoke`) and run after every P0/P1 change. |
| React Query migration causes stale UI bugs | Invalidate exact query keys; keep a fallback manual refresh button during transition. |
| Service extraction changes function signatures | Keep existing route handlers as thin wrappers around extracted services initially. |

### P4 — Completion & Polish (Week 7+)

| # | Task | Rationale |
|---|---|---|
| 19 | **Complete service layer extraction** | Extract remaining business logic from `outboundAutomation.js` into `services/outbound/` modules: `draftService.js`, `campaignService.js`, `sequenceService.js`, `forecastService.js`, `dataQualityService.js`, `multifamilyService.js`. Route file target: < 3,000 lines. |
| 20 | **Decompose `OutboundAutomation.jsx` into sub-components** | Split the ~3,200-line render body into feature components: `LeadTable.jsx`, `DraftInbox.jsx`, `CampaignManager.jsx`, `SequenceManager.jsx`, `WorkflowRuleBuilder.jsx`, `ForecastPanel.jsx`, `DataQualityPanel.jsx`, `MultifamilyExplorer.jsx`. |
| 21 | **Roll out API response envelopes to all routes** | Replace `res.json({ error: ... })` / `res.json({ data: ... })` with `res.sendError(...)` / `res.sendSuccess(...)` across all 33 route files. |
| 22 | **Add Zod validation to remaining outbound endpoints** | Wrap `/drafts/generate`, `/sequences/:id/enroll`, `/leads/bulk`, `/workflows/rules`, `/multifamily/objects`, and `/forecast/goals` with `validateBody`. Remove remaining manual `Set` checks. |
| 23 | **Implement cursor pagination on `/outbound/leads`** | Replace `limit=200` offset-less fetching with cursor pagination. Add `nextCursor` / `hasMore` to response. Update frontend to consume cursors. |
| 24 | **Add integration tests for critical flows** | `scripts/outbound-smoke-test.js` exists but has no assertions. Build Jest/Supertest integration tests for: CSV import → dedupe → score, workflow rule trigger → action execution, sequence enrollment → state transition. |

---

## The Path Forward

Phase 25 is a **foundational investment**. By hardening security, standardizing APIs, and breaking down monoliths, future feature phases (26+) will ship faster and with fewer regressions. The immediate ROI comes from reduced frontend loading times (React Query caching) and the elimination of data corruption risks during CSV imports (transactions + validation).
