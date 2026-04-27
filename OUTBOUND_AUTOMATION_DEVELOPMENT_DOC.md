# ResiQ CRM Outbound Automation Development Doc

Last updated: April 27, 2026
Owner: SiddonJ / ResiQ CRM

## 1. Purpose

Build an automated outbound engine inside ResiQ CRM that supports:

- Email + LinkedIn outreach
- Solo-operator workflows
- Zero-dollar tooling to start
- Internal-only usage now
- White-label readiness later

This doc is the implementation blueprint for future development.

## 2. Constraints (Locked)

- Budget: $0 monthly tooling at launch
- Channels: Email + LinkedIn
- ICP: Multifamily property tech and related decision-makers
- Deployment mode: Internal use first, potential white-label later

## 3. Core Product Decision

ResiQ CRM remains the single system of record.

- Do not split source-of-truth across third-party CRMs right now.
- Prioritize low-cost automation with human approval checkpoints.
- Avoid risky LinkedIn auto-action behavior; use AI-assisted + manual send flow.

## 4. Current Codebase Assets to Reuse

- Sequence automation worker exists
  - `server/src/workers/sequenceWorker.js`
- Enrichment worker exists (Hunter/OpenAI pattern already present)
  - `server/src/workers/enrichmentWorker.js`
- Multi-source lead finder exists but currently uses synthetic generation and must be replaced
  - `server/src/services/multiSourceLeadService.js`

## 5. Non-Negotiable Fix First

Remove synthetic lead generation logic.

### Problem

Current lead generation logic creates synthetic Reddit/LinkedIn outputs, which is not production lead sourcing.

### Required change

- Deprecate synthetic generation mode in production paths.
- Replace with real lead ingestion paths (manual + import + user-provided source URLs + optional API enrichments).

## 6. Phase Plan

## Phase 0: Foundation Hardening (Week 1)

### Goals

- Eliminate synthetic lead generation behavior
- Add audit-safe event logging for outbound actions

### Tasks

- Add `LEAD_SOURCE_CONFIDENCE` and `is_synthetic` guard checks
- Block sequence enrollment when source quality is unknown
- Add migration for outbound event tracking table

### Exit criteria

- No synthetic leads can enter active outreach sequences
- Every outbound action has an auditable event record

## Phase 1: $0 MVP Lead Pipeline (Week 1-2)

### Goals

- Ingest real leads with zero paid tooling
- Enable repeatable lead scoring and triage

### Tasks

- Build CSV import endpoint + UI mapping
- Add lead dedupe (email + linkedin_url + company + name fuzzy key)
- Add score model v1 based on rules:
  - title fit
  - company type fit
  - geography fit
  - trigger keywords (portfolio growth, hiring, system migration)

### Exit criteria

- User can import leads and see scored queue
- Dedupe rate and invalid import errors visible in UI

## Phase 2: Email + LinkedIn Execution Layer (Week 2-4)

### Goals

- Fully usable outreach workflow
- Human-in-the-loop LinkedIn safety

### Tasks

- Email sequence enrollment from scored queue
- AI message draft generation with approval states:
  - `drafted`
  - `approved`
  - `sent`
  - `replied`
- LinkedIn task queue (manual send):
  - connection request draft
  - follow-up message draft
  - reminder cadence

### Exit criteria

- User can run daily outbound from one queue
- LinkedIn actions are task-driven and manually confirmed

## Phase 3: Insight + Optimization (Week 4-6)

### Goals

- Improve quality and conversion with minimal overhead

### Tasks

- Add funnel metrics:
  - lead imported
  - qualified
  - contacted
  - replied
  - meeting
  - opportunity
- Add sequence/copy performance tracking
- Add weekly “what to do next” recommendation panel

### Exit criteria

- Dashboard shows conversion by source, persona, and sequence
- User gets actionable optimization suggestions

## Phase 4: White-Label Readiness (Future)

### Goals

- Prepare architecture for multi-tenant branding

### Tasks

- Tenant-level branding config:
  - logo
  - colors
  - sender signature defaults
- Workspace-level domain and template segregation
- Per-tenant webhook routing and event namespace

### Exit criteria

- Multi-tenant boundaries validated
- No cross-tenant data leakage in API and reporting

## 7. Data Model Additions

Recommended new tables:

- `lead_import_jobs`
- `lead_source_events`
- `linkedin_outreach_tasks`
- `outbound_message_drafts`
- `outbound_performance_daily`

Recommended fields to add to leads:

- `source_type` (`csv`, `manual`, `api`, `other`)
- `source_reference`
- `fit_score` (0-100)
- `intent_score` (0-100)
- `last_outreach_channel`
- `next_recommended_action`

## 8. API Backlog (Proposed)

- `POST /api/leads/import/csv`
- `GET /api/leads/import/:jobId/status`
- `POST /api/leads/:id/score`
- `POST /api/outbound/drafts/generate`
- `PATCH /api/outbound/drafts/:id/approve`
- `POST /api/linkedin/tasks/:id/complete`
- `GET /api/outbound/analytics/summary`

## 9. UI Backlog (Proposed)

- Lead Import Wizard
- Qualification Queue
- Outreach Workbench
- LinkedIn Task Board
- Outbound Analytics Dashboard

## 10. ICP Starter Rules (Multifamily Property Tech)

Priority titles:

- VP Operations
- Director of Property Management
- Head of Asset Management
- COO
- Regional Property Manager

Priority triggers:

- “portfolio expansion”
- “new regional manager”
- “system migration”
- “new PMS rollout”
- “operational efficiency”
- “resident experience platform”

## 11. Safety and Compliance

- Keep LinkedIn execution manual-confirmed to reduce policy risk.
- Respect unsubscribe and contact preferences across all channels.
- Log consent and suppression status in contact record.
- Add hard blocks for outreach when suppression flags are present.

## 12. Testing Strategy

Automated:

- Import parser unit tests
- Scoring engine tests
- Sequence enrollment guard tests
- Draft state transition tests

Integration:

- End-to-end import -> score -> draft -> send -> reply state updates

Manual QA:

- LinkedIn task flow
- Edge-case dedupe collisions
- Analytics correctness checks

## 13. Definition of Done (MVP)

- No synthetic leads enter active outreach
- Real lead ingestion works end-to-end
- Email + LinkedIn workflow usable daily by a solo operator
- Outreach results visible in one dashboard
- System can be expanded to white-label without re-architecture

## 14. Future Paid Upgrades (When Budget Allows)

- Smartlead or Instantly for higher-volume sending
- Additional enrichment providers (Seamless, A-Leads, ListKit)
- Intent data add-ons
- Advanced deliverability and inbox placement tooling

Do not build hard dependencies on these in MVP.

## 15. Current Implementation Status (April 27, 2026)

Implemented now:

- Migration `021-outbound-automation-phase0-1.sql` is live.
- Synthetic lead generation is blocked by `ALLOW_SYNTHETIC_LEADS=true` guard.
- Outbound API endpoints are implemented under `/api/outbound`.
- Scoring service is implemented in `server/src/services/outboundScoring.js`.
- Internal UI page is available at `/outbound-automation`.
- Sidebar navigation now includes `Outbound`.
- Safety rails implemented:
  - daily per-user send limits (email + LinkedIn)
  - required draft approval before send/completion
  - outbound event export and outbound audit export (CSV/JSON)
- Phase 4 campaign foundation implemented:
  - `outbound_campaigns` table
  - `outbound_campaign_members` table
  - campaign APIs: create, list, get, add members, status transitions, member status updates
  - campaign controls surfaced on `/outbound-automation`

New smoke tooling:

- `npm run test:outbound-smoke`
  - Registers a test user
  - Imports the same CSV twice (verifies dedupe)
  - Scores a lead
  - Generates email and LinkedIn drafts
  - Approves draft
  - Completes LinkedIn task
  - Verifies analytics summary

Local prerequisites:

- PostgreSQL running with working `DATABASE_URL` in `.env`
- `ENCRYPTION_KEY` set to exactly 32 bytes
- Root + server + client dependencies installed

Recommended next build steps:

- Add persistent Draft Inbox and LinkedIn Task Board endpoints/UI
- Add suppression and unsubscribe hard blocks before send
- Add outbound workflow tests in CI
- Add tenant branding/profile screens for white-label packaging
