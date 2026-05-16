# ResiQ-CRM Improvement Roadmap

A comprehensive plan organized by priority-to-value ratio. Each phase delivers standalone value and can be started independently.

**Legend:** 🛡️ Security | 🏛️ Architecture | 🚀 Feature | ⚡ Performance | 🧪 Testing | 🔧 DevOps

---

## Phase 1: Foundation Hardening 🛡️🏛️ ✅

*All completed May 16, 2026*

### 1.1 Kysely Migration — Database Wrapper + First Routes ✅
- Created `server/src/db.js` (CommonJS Kysely wrapper) with `db`, `sql`, `ownershipWhere`, `pool` exports
- Converted `auth.js`, `auditLogs.js`, `activities.js` — 0 `pool.query` calls remaining across all three
- Used Kysely transactions (`db.transaction().execute(async (trx) => ...)`) to replace manual pool.connect/BEGIN/COMMIT/ROLLBACK pattern

### 1.2 Rate Limiting ✅
- Already implemented — general limiter (300/15min), auth limiter (20/15min), outbound limiter (60/1min)

### 1.3 Health Check Improvement ✅
- Already implemented — checks PostgreSQL (`SELECT 1`) and Redis (ping) with structured response and correct HTTP status codes

### 1.4 Migration Locking ✅
- Added `_schema_version` tracking table with version, description, applied_at, checksum columns
- Added PostgreSQL advisory lock (`pg_advisory_xact_lock(847261004)`) to prevent concurrent migration races
- Updated `run-all-migrations.js` to track applied migrations — skips already-applied migrations
- Updated server `initDatabase()` to auto-apply pending migrations on boot (with tracking)
- Idempotent: re-runs skip already-applied migrations gracefully

### 1.5 Audit Indexes ✅
- Created migration `052-outbound-performance-indexes.sql`:
  - `idx_outbound_leads_user_status` on `outbound_leads(user_id, status)`
  - `idx_lead_source_events_user_event` on `lead_source_events(user_id, event_type, created_at DESC)`
  - `idx_outbound_drafts_user_status` on `outbound_drafts(user_id, status)`
  - `idx_outbound_campaigns_user_status` on `outbound_campaigns(user_id, status)`

---

## Phase 2: Code Quality & Test Foundation 🧪🏛️ ✅

### 2.1 Monolith Extraction ✅
- Already completed before Phase 2 started — `server/src/utils/outboundUtils.js` (874 lines), `server/src/services/outbound/leadService.js`, `draftService.js`, `sequenceService.js`, `campaignService.js` all extracted
- Zod schemas in `server/src/utils/outboundSchemas.js` with 16+ schemas

### 2.2 API Response Standardization ✅
- Middleware exists at `server/src/middleware/responseHelpers.js` and `responseHelpers.ts`
- Wired up in `index.js` (line 88-89)
- Exports: `res.sendSuccess(data, meta)` and `res.sendError(message, code, statusCode)`

### 2.3 Test Foundation ✅
- Jest config created (`server/jest.config.js`) with `npm test` script
- **82 tests passing** across 4 test suites
- Test files: `outboundUtils.test.js` (57 tests), `outboundSchemas.test.js` (19 tests), `leadService.test.js` (3 tests), `agentsRoutes.test.js` (3 tests)

### 2.4 TypeScript — Middleware Layer ✅
- `server/src/middleware/responseHelpers.ts` exists alongside `.js` version
- Full TypeScript conversion of middleware files is scoped as a follow-up

---

## Phase 3: Full Kysely Migration 🏛️🛡️ ✅

*All 35 route files converted. Zero pool.query calls remaining.*

### 3.1 Route Conversion (Batch 1 — Read-Heavy) ✅
- Converted: analytics.js, contacts.js, clients.js, teams.js, users.js

### 3.2 Route Conversion (Batch 2 — Write-Heavy) ✅
- Converted: proposals.js, invoices.js, timeEntries.js, reminders.js, sharing.js, calendar.js

### 3.3 Route Conversion (Batch 3 — Complex Logic) ✅
- Converted: projects.js (119 calls, 2,382 lines), portfolios.js, sequences.js, integrations.js

### 3.4 Route Conversion (Batch 4 — Remaining) ✅
- Converted: outboundAutomation.js (136 calls, 4,900+ lines), track.js, deals.js, forms.js, engagement.js, leads.js, sms.js, clientAuth.js

### Migration Results
- **539** `pool.query()` calls → **0** across all 35 route files
- **4** `pool.connect()` calls remain in outboundAutomation.js (manual PG transactions — safe, intentional)
- 27 of 35 routes use `kysely` imports (`const { db, sql } = require('../db')`)
- Complex dynamic-WHERE queries converted to `sql.join(conditions, ' AND ')` pattern
- All transactions converted to `db.transaction().execute(async (trx) => ...)` where applicable
- `server/src/db.js` exports: `{ db, sql, ownershipWhere, pool }`

---

## Phase 4: Frontend Foundation ⚡🧪 ✅

### 4.1 React Query Adoption ✅
- React Query already installed (`@tanstack/react-query@^5.100.9`) with QueryClientProvider in `main.jsx` (staleTime: 30s, devtools enabled)
- Outbound feature already had complete React Query setup: `src/features/outbound/api/outboundApi.js` (285 lines) + `src/features/outbound/hooks/useOutboundQueries.js` (668 lines, 30+ hooks with optimistic updates)
- **Created general API layer** — 10 API modules at `src/api/`:
  - `api.js` (base axios instance with auth interceptor)
  - `contactsApi.js`, `dealsApi.js`, `invoicesApi.js`, `proposalsApi.js`
  - `remindersApi.js`, `usersApi.js`, `teamsApi.js`, `projectsApi.js`, `analyticsApi.js`
- **Created React Query hooks** — 10 hook files at `src/hooks/`:
  - `useContactsQueries.js`, `useDealsQueries.js`, `useInvoicesQueries.js`
  - `useProposalsQueries.js`, `useRemindersQueries.js`, `useUsersQueries.js`
  - `useTeamsQueries.js`, `useProjectsQueries.js`, `useAnalyticsQueries.js`
- Each hook file provides `useQuery` for reads and `useMutation` for writes with automatic cache invalidation
- Build verified: `npx vite build` passes in 2.74s

### 4.2 Frontend Test Setup ✅
- Installed: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`
- Vitest configured in `vite.config.js` with jsdom environment
- Test setup at `src/test/setup.js` with jest-dom matchers
- `npm test` / `npm run test:watch` scripts added to `package.json`
- **3 API tests passing** — verifies all API module exports are correct

### 4.3 Optimistic Updates 🟡
- Outbound feature already has optimistic updates (`useSuppressLead`, `useApproveDraft` with `onMutate`/`onError` rollback)
- The new hook files include `onMutate`/`onError` patterns ready for use
- Page-by-page migration from `useEffect` → React Query hooks is the next step

---

## Phase 5: Business Features — AI & Automation 🚀 ✅

*All components were already built before the improvement roadmap was created.*

### 5.1 AI Auto-Enrichment ✅
- Bull worker (`server/src/workers/enrichmentWorker.js` — 250 lines) triggered on new Contact creation
- **Hunter.io API** for email verification, person lookup, and domain data (org, industry, company size)
- **OpenAI GPT-4o-mini** for company intelligence (description, size, competitors, recommended service line)
- **Web scraping** via cheerio for additional context
- Auto-updates Contact: notes, service_line, custom_fields, industry, company_size, company_website, linkedin_url, job_title, email_verified
- Also updates Deal service_line if blank
- Wired up on server start (index.js line 315-321), queued from leads.js web-to-lead endpoint

### 5.2 Web-to-Lead Forms ✅
- Public API endpoint `POST /api/leads/:formId` in `routes/leads.js`
- Full Form Builder UI at `client/src/pages/Forms.jsx` (297 lines)
- Form CRUD at `routes/forms.js` with `forms` DB table
- Auto-routing: submission → Contact + Deal (Lead stage) + enrichment queue
- Redirect URL support for HTML form submissions
- JSON API support for AJAX form submissions

### 5.3 Drip Campaigns & Sequences ✅
- **Sequence schema** — tables for `sequences`, `sequence_steps`, `sequence_enrollments`
- **Sequence service** (`services/outbound/sequenceService.js` — 444 lines) — enrollment management, state machine
- **Sequence route** (`routes/sequences.js` — 205 lines) — CRUD + enrollment API
- **Bull worker** (`workers/sequenceWorker.js` — 167 lines) — processes due steps (tag replacement, email via Gmail API, SMS via Twilio)
- **Email sync worker** (`workers/emailSyncWorker.js` — 238 lines) — detects inbound replies → auto-pauses sequences
- **Frontend** — `Sequences.jsx` page, `SequenceBuilderModal.jsx` (281 lines), `EnrollSequenceModal.jsx` (136 lines)

### 5.4 Engagement Tracking ✅
- **Tracking pixel** — `GET /api/track/:trackingId.png` in `routes/track.js` with transparent 1×1 GIF
- **Link tracking** — `GET /api/track/link` with redirect + activity logging
- **Tracking service** (`services/trackingService.js` — 87 lines) — injects tracking pixels into HTML emails
- **Engagement API** (`routes/engagement.js` — 133 lines) — contact timeline, asset stats, create tracking records
- **Frontend** — `EngagementTimeline.jsx` component (121 lines) for contact detail views

---

## Phase 6: Client Portal & Help Desk 🚀 ✅

### 6.1 Help Desk / Ticketing ✅
- Help Desk fully built: `routes/tickets.js` (365 lines), `HelpDesk.jsx` page with Kanban-style status board
- Client Portal ticket submission at `pages/client/Tickets.jsx`
- **AI Auto-Draft Reply** — new `POST /api/tickets/:ticketId/ai-suggest` endpoint:
  - Gathers context from ticket, contact notes, activities, deals, proposals, invoices, previous tickets
  - Feeds to OpenAI GPT-4o-mini to generate context-aware suggested reply
  - Uses existing openai SDK

### 6.2 Client Portal Enhancement ✅
- Full client portal: `ClientApp.jsx` with routes for Dashboard, Proposals, Invoices, Files, Activity, Tickets
- All pages verified existing: Dashboard, Proposals, Invoices, Files, Activity, Tickets, Help

---

## Phase 7: Performance & Scale ⚡ ✅

### 7.1 Cursor Pagination ✅
- Already implemented on outbound leads endpoint — base64 cursor with `{score, id}` format

### 7.2 Frontend Code Splitting ✅
- Converted `App.jsx` to `React.lazy()` + `Suspense` with `PageLoader` spinner
- **Main bundle reduced from 909KB → 247KB** (shared deps only)
- Individual lazy-loaded chunks:
  - OutboundAutomation: 137KB | ProjectDetail: 103KB | Invoices: 69KB
  - Proposals: 25KB | Calendar: 22KB | Analytics: 22KB | Contacts: 30KB
  - All other pages: 5-17KB each
- Build time: 4.52s

### 7.3 Database Query Optimization 🟡
- Indexes added in Phase 1.5 (migration 052)
- Further optimization scoped as follow-up

---

## Phase 8: Proptech Integrations 🚀 (Blocked)

*Requires external API credentials and account setup. Scoped for future work:*
- Yardi / Entrata / RealPage API sync
- SmartRent / IoT platform integration
- Automated client PDF reports

---

## Phase 9: DevOps & Monitoring 🔧 ✅

### 9.1 Error Tracking ✅
- Installed `@sentry/node@^10.53.1` in server/
- Added `Sentry.init()` to `index.js` — activates only when `SENTRY_DSN` env var is set
- `Sentry.Handlers.errorHandler()` middleware after all API routes
- Zero overhead when DSN not configured

### 9.2 Structured Logging ✅
- Pino logger already installed and used in `index.js` — structured JSON logging with `pino-pretty` in dev
- `responseHelpers.ts` TypeScript version exists alongside .js

### 9.3 CI/CD Improvement ✅
- Updated `Jenkinsfile` with full pipeline:
  - Install (server + client) via `npm ci`
  - Server tests: `cd server && npm test`
  - Client build: `cd client && npm run build`
  - Success/failure post handlers

### 9.4 Production Monitoring ✅
- Docker HEALTHCHECK added to `Dockerfile` — pings `/api/health` every 30s (checks DB + Redis)
- `start-period: 40s` for initial boot

---

## Priority Matrix

| Phase | Effort | Impact | Risk Reduction | Business Value |
|-------|--------|--------|---------------|----------------|
| 1: Foundation | Low | High | 🛡️🛡️🛡️ | Medium |
| 2: Code Quality | Low-Med | High | 🧪🛡️ | Medium |
| 3: Kysely Full | Med-High | Very High | 🛡️🛡️🛡️🛡️ | Medium |
| 4: Frontend | Medium | High | ⚡🧪 | Medium |
| 5: AI/Features | Med-High | Very High | — | 🚀🚀🚀🚀 |
| 6: Client Portal | Medium | High | — | 🚀🚀🚀 |
| 7: Performance | Medium | Medium | ⚡ | Medium |
| 8: Integrations | High | Very High | — | 🚀🚀🚀🚀🚀 |
| 9: DevOps | Low | Medium | 🔧 | Low-Med |

---

## How to Work This Plan

1. **Each phase is standalone** — start anywhere, skip anything
2. **Smaller items within phases** can be cherry-picked independently
3. **Phases 1-4 are prerequisites** for clean, safe feature development in Phases 5-8
4. **Update this doc** as priorities shift or new ideas come up

*Last updated: May 16, 2026*
