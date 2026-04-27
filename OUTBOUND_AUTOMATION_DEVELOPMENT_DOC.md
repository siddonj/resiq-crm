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

## Phase 21: HubSpot-Class Optimization Layer (Future)

### Goals

- Add high-leverage CRM automation and intelligence patterns used by mature revenue teams
- Keep execution lean for solo-operator workflows while remaining white-label compatible

### Tasks

- Sequence state machine v2
  - enforce one-active-sequence-per-lead
  - auto-unenroll on reply, hard bounce, or suppression update
  - add pause/resume and per-minute/per-day throughput throttles
- Workflow rules engine
  - trigger/action automation builder with `if/else` branching
  - route leads, assign tasks, and update fields based on behavioral events
- Scoring v2 + explainability
  - split score into `fit_score`, `engagement_score`, and `intent_score`
  - add time decay and score history timeline
  - store top score reasons and expose "why this lead is prioritized"
- Forecast + goals
  - weighted pipeline forecast with `commit`, `best_case`, and `closed` buckets
  - weekly gap-to-goal panel for solo execution planning
- Attribution + source ROI
  - track source -> sequence -> meeting -> opportunity -> revenue lineage
  - report conversion and value by source, persona, and sequence
- Data quality command center
  - duplicate merge queue and field normalization
  - stale-record flags and enrichment freshness checks
  - required-field guardrails before enrollment
- Multifamily custom objects
  - add `portfolio`, `property`, `tech_stack`, and `initiative` objects
  - associate objects with contacts, companies, and deals for segmentation

### Data model additions (Phase 21)

- `sequence_enrollments` (state machine and transitions)
- `workflow_rules` and `workflow_rule_runs`
- `lead_score_history`
- `pipeline_forecasts` and `sales_goals`
- `attribution_touchpoints`
- `data_quality_issues`
- `portfolio`, `property`, `tech_stack`, `initiative` + association tables

### API backlog (Phase 21)

- `POST /api/outbound/sequences/:id/enroll`
- `PATCH /api/outbound/sequences/enrollments/:id/state`
- `POST /api/outbound/workflows/rules`
- `POST /api/outbound/workflows/rules/:id/test`
- `GET /api/outbound/scoring/:leadId/explain`
- `GET /api/outbound/forecast/summary`
- `GET /api/outbound/attribution/summary`
- `GET /api/outbound/data-quality/issues`

### UI backlog (Phase 21)

- Sequence Control Center
- Workflow Builder
- Lead Score Explain panel
- Forecast + Goals dashboard
- Attribution dashboard
- Data Quality queue
- Multifamily object explorer

### Exit criteria

- Sequence automation safely self-governs via lifecycle rules and throttles
- Lead prioritization is transparent and explainable in-app
- Forecast and attribution are accurate enough for weekly operating decisions
- Data hygiene is enforced before leads enter outbound flow
- Multifamily object model supports deeper segmentation without re-architecture

### Progress status (as of April 27, 2026)

- Phase 21 completion: 97%
- Measurement basis (weighted by planned capabilities):
  - Sequence state machine v2: 35%
  - Workflow rules engine: 30%
  - Scoring v2 + explainability: 45%
  - Forecast + goals: 40%
  - Attribution + source ROI: 35%
  - Data quality command center: 68%
  - Multifamily custom objects: 68%

Phase 21 slice delivered now:

- Added explainable scoring baseline:
  - engagement score signal layer (event-driven)
  - score reason payloads (`fit`, `intent`, `engagement`, `summary`)
  - score history timeline table + write path
- Added endpoint:
  - `GET /api/outbound/scoring/:leadId/explain`
  - returns current explanation + recent scoring history

Additional Phase 21 slice delivered now (Slice 2):

- Added outbound sequence state machine tables:
  - `outbound_sequence_enrollments`
  - `outbound_sequence_enrollment_transitions`
- Added one-open-sequence-per-lead guardrail:
  - unique open enrollment constraint for `active`/`paused` states
- Added sequence lifecycle endpoints:
  - `GET /api/outbound/sequences`
  - `GET /api/outbound/sequences/enrollments`
  - `POST /api/outbound/sequences/:id/enroll`
  - `PATCH /api/outbound/sequences/enrollments/:id/state`
- Added automatic stop triggers for active/paused enrollments on:
  - suppression updates
  - reply outcomes
  - meeting outcomes
  - hard-bounce outcomes
- Added outcome endpoint for lifecycle-triggered state automation:
  - `POST /api/outbound/leads/:id/outcome`
- Added Sequence Control Center UI in `/outbound-automation`:
  - enroll lead into sequence
  - view enrollment status and step progress
  - pause/resume/stop controls
- Expanded smoke test coverage to include:
  - enroll -> pause -> resume -> auto-stop flow

Additional Phase 21 slice delivered now (Slice 3):

- Added workflow rules engine schema:
  - `workflow_rules`
  - `workflow_rule_runs`
- Added outbound workflow rule APIs:
  - `GET /api/outbound/workflows/rules`
  - `POST /api/outbound/workflows/rules`
  - `PATCH /api/outbound/workflows/rules/:id`
  - `GET /api/outbound/workflows/rules/:id/runs`
  - `POST /api/outbound/workflows/rules/:id/test`
- Added rule condition evaluation support:
  - `AND`/`OR` rule groups
  - field-path operators (`equals`, `not_equals`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`, `exists`)
- Added if/else action branching:
  - `true_actions` and `false_actions`
- Added initial action handlers:
  - `update_lead_status`
  - `set_next_recommended_action`
  - `create_reminder`
  - `suppress_lead`
  - `log_event`
  - `enroll_sequence`
- Added automatic runtime integration:
  - enabled rules execute on outbound event log writes
  - run history recorded in `workflow_rule_runs`
- Added Workflow Rules UI in `/outbound-automation`:
  - create rule
  - enable/disable rule
  - dry-run and live test against selected lead

Additional Phase 21 slice delivered now (Slice 4):

- Added forecast/goals data model:
  - `sales_goals`
  - `pipeline_forecasts`
- Added forecast APIs:
  - `GET /api/outbound/forecast/summary`
  - `PUT /api/outbound/forecast/goals`
- Added forecast logic:
  - current-period windows for `weekly` and `monthly`
  - commit/best-case/closed bucket counts and values
  - projected end-of-period meetings/opportunities/revenue
  - gap-to-goal calculations
  - daily forecast snapshot upsert into `pipeline_forecasts`
- Added Forecast + Goals UI section in `/outbound-automation`:
  - weekly/monthly toggle
  - live bucket values
  - period goal form
  - projected vs target gap panel
- Expanded smoke test coverage:
  - upsert forecast goals
  - fetch forecast summary
  - validate target + projection fields

Additional Phase 21 slice delivered now (Slice 5):

- Added attribution lineage data model:
  - `attribution_touchpoints`
- Added touchpoint write path:
  - outbound lead events now persist source/sequence/campaign lineage snapshots
  - opportunity events persist attributed value with closed-won fallback estimates
- Added attribution API:
  - `GET /api/outbound/attribution/summary`
- Added attribution reporting logic:
  - period-window summary (`weekly`/`monthly`)
  - conversion/value rollups by source
  - conversion/value rollups by sequence
  - conversion/value rollups by persona
  - source -> sequence lineage table for meeting/opportunity/revenue
- Added Attribution + Source ROI UI section in `/outbound-automation`:
  - period-aware KPI cards
  - source conversion table
  - top sequence and persona performance blocks
- Expanded smoke test coverage:
  - lead outcome -> opportunity trigger
  - attribution summary fetch + response validation
  - attribution table readiness check

Additional Phase 21 slice delivered now (Slice 6):

- Added data quality command center data model:
  - `data_quality_issues`
- Added data quality issue detection and sync logic:
  - missing contact channel
  - missing company/title
  - low source confidence
  - stale lead record flags
  - potential duplicate groups by normalized name + company
- Added data quality APIs:
  - `GET /api/outbound/data-quality/issues`
  - `PATCH /api/outbound/data-quality/issues/:id/status`
- Added enrollment guardrails:
  - sequence enrollment now blocks when required contact channel data is missing
  - blocking responses include `code: data_quality_block` and blocker details
- Added lead-level issue visibility:
  - outbound leads payload now includes open issue and open blocking issue counts
- Added Data Quality Command Center UI section in `/outbound-automation`:
  - open/blocking/resolved counters
  - issue queue filter (open/resolved/dismissed)
  - resolve/dismiss/reopen controls
  - enrollment button states reflect blocking data quality issues
- Expanded smoke test coverage:
  - data quality table readiness check
  - low-quality lead import and queue validation
  - enrollment guardrail conflict validation for missing contact channel

Additional Phase 21 slice delivered now (Slice 7):

- Added multifamily custom object data model:
  - `multifamily_objects`
  - `multifamily_object_associations`
- Added object types:
  - `portfolio`
  - `property`
  - `tech_stack`
  - `initiative`
- Added multifamily object APIs:
  - `GET /api/outbound/multifamily/summary`
  - `GET /api/outbound/multifamily/objects`
  - `POST /api/outbound/multifamily/objects`
  - `PATCH /api/outbound/multifamily/objects/:id`
  - `DELETE /api/outbound/multifamily/objects/:id`
  - `GET /api/outbound/multifamily/objects/:id/associations`
  - `POST /api/outbound/multifamily/objects/:id/associations`
  - `DELETE /api/outbound/multifamily/objects/:id/associations/:associationId`
- Added association target support for:
  - outbound leads
  - contacts
  - deals
  - company names
- Added outbound lead segmentation support:
  - `/api/outbound/leads` now supports object filters (`objectType` + `objectId` and typed ids)
- Added Multifamily Object Explorer UI section in `/outbound-automation`:
  - create/list objects
  - object and association counters
  - lead tagging controls from the lead grid
  - lead filter controls by object type + object
- Expanded smoke test coverage:
  - multifamily object table readiness check
  - create object + associate to lead
  - verify lead segmentation filter by multifamily object

Additional Phase 21 slice delivered now (Slice 8):

- Added data quality merge operations model:
  - `data_quality_merge_operations`
- Added duplicate merge APIs:
  - `GET /api/outbound/data-quality/merge-operations`
  - `POST /api/outbound/data-quality/issues/:id/merge`
- Added merge behavior for duplicate lead groups:
  - re-parents lead-linked records (campaign members, sequence enrollments, drafts, events, attribution, score history)
  - resolves duplicate issues and records merge field updates/history
- Added advanced multifamily explorer APIs:
  - `GET /api/outbound/multifamily/entities` (contacts/deals/companies)
  - `POST /api/outbound/multifamily/objects/:id/associations/bulk`
- Expanded smoke test coverage:
  - duplicate lead issue detection + merge execution + merge history validation
  - multifamily explorer entity search for contacts/deals/companies
  - bulk association workflows for contacts/deals/companies

Additional Phase 21 slice delivered now (Slice 9):

- Added persistent Draft Inbox APIs:
  - `GET /api/outbound/drafts/inbox`
- Added LinkedIn Task Board APIs:
  - `GET /api/outbound/linkedin/tasks/board`
  - `POST /api/outbound/linkedin/tasks/rebalance`
- Added workload balancing logic:
  - status-aware + score-aware task priority calculation
  - queue rebalance into daily execution windows
  - open/overdue/ready workload summary and clearance horizon estimates
- Added outbound UI enhancements in `/outbound-automation`:
  - persistent Draft Inbox replacing session-only visibility
  - LinkedIn Task Board with approved/drafted/pending/completed swimlanes
  - one-click queue rebalance controls
- Expanded smoke test coverage:
  - persistent inbox retrieval and draft lifecycle assertions
  - LinkedIn board bucket checks across drafted/approved/completed
  - workload rebalance execution validation

Additional Phase 21 slice delivered now (Slice 10):

- Added operator productivity APIs:
  - `GET /api/outbound/saved-views`
  - `POST /api/outbound/saved-views`
  - `PATCH /api/outbound/saved-views/:id`
  - `DELETE /api/outbound/saved-views/:id`
  - `POST /api/outbound/leads/bulk`
  - `GET /api/outbound/sla/alerts`
- Added productivity data model:
  - `outbound_saved_views`
- Added bulk lead operations:
  - set status
  - suppress (with reason and enrollment auto-stop)
  - unsuppress
  - rescore with history/event tracking
- Added SLA signal coverage:
  - overdue LinkedIn tasks
  - stale approved email drafts
  - stale paused sequence enrollments
  - high-score not-contacted lead alerts
- Added outbound UI enhancements in `/outbound-automation`:
  - Saved Views manager (save/apply/delete filter presets)
  - lead table bulk selection + bulk action runner
  - SLA Alerts panel with issue counters and top alert feed
- Added CI workflow coverage:
  - `.github/workflows/outbound-workflow-ci.yml`
  - installs dependencies, builds client, and runs outbound smoke test against Postgres + Redis services
- Expanded smoke test coverage:
  - saved view creation/list validation
  - bulk status/suppress/unsuppress action checks
  - SLA alerts validation path for forced overdue LinkedIn task

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
  - suppression hard blocks before draft generation and send/completion
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

Additional Phase 21 slice delivered now (Slice 11):

- Added workspace configuration data model:
  - `outbound_workspace_config` (per-user sender identity, daily limits, SLA thresholds)
- Added workspace config APIs:
  - `GET /api/outbound/workspace/config`
  - `PUT /api/outbound/workspace/config`
- Added SLA escalation automation data model:
  - `outbound_sla_escalations` (per-user rules with type, threshold override, action)
  - `outbound_notifications` (notification queue for escalation triggers)
- Added SLA escalation APIs:
  - `GET /api/outbound/sla/escalations`
  - `POST /api/outbound/sla/escalations`
  - `PATCH /api/outbound/sla/escalations/:id`
  - `POST /api/outbound/sla/escalations/run`
- Added notifications APIs:
  - `GET /api/outbound/notifications`
  - `PATCH /api/outbound/notifications/:id/read`
  - `POST /api/outbound/notifications/read-all`
- Added advanced bulk action APIs:
  - `POST /api/outbound/bulk/sequence-enroll` (with data quality guard)
  - `POST /api/outbound/bulk/sequence-unenroll`
  - `POST /api/outbound/bulk/multifamily-tag`
  - `POST /api/outbound/bulk/campaign-transition`
- Added Workspace Configuration UI panel in `/outbound-automation`:
  - sender name and email signature fields
  - daily email and LinkedIn limit controls
  - SLA threshold overrides (draft stale hours, LinkedIn overdue hours, paused stale days, high-score not-contacted days)
- Added SLA Escalation Rules UI panel:
  - add/enable/disable escalation rules per SLA type
  - one-click run escalation check
  - last-run timestamp per rule
- Added Notifications UI panel:
  - unread badge on section header
  - notification feed with read/unread state
  - mark individual or all as read
- Extended Bulk Actions in lead table:
  - bulk sequence enroll (select sequence from list)
  - bulk sequence unenroll
  - bulk multifamily tag (select object from list)
- Expanded smoke test coverage:
  - workspace config get + put validation
  - escalation rule create/toggle/run lifecycle
  - notification list and mark-all-read
  - bulk sequence enroll/unenroll with enrollment count assertions
  - bulk multifamily tag with tagged count assertion

Recommended next build steps:

- Ship Phases 0–4 MVP gap: replace synthetic lead service with real CSV-to-import pipeline validation
- Add per-tenant branding screens for white-label packaging
- Add campaign-transition bulk action UI (member ID selection surface)
- Integrate workspace config sender name/signature into draft generation payload
