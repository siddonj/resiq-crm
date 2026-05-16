# Phase 2.1 — Extract Outbound Utilities & Service Layer

**Labels:** `architecture`, `refactoring`
**Milestone:** Phase 2: Code Quality & Test Foundation
**Estimate:** 2 days

## Description

`server/src/routes/outboundAutomation.js` is **5,200 lines** — the largest file in the codebase. It contains inline utility functions, validation logic, and business logic mixed with request handling.

## Tasks

1. **Extract utilities** → `server/src/utils/outboundUtils.js`:
   - `parseCSV()`, `normalizeHeader()`, `canonicalLinkedInUrl()`
   - `computeDedupeKey()`, validation sets, column mapping

2. **Extract lead service** → `server/src/services/outbound/leadService.js`:
   - Import, bulk actions, suppression logic

3. **Extract Zod validation schemas** → `server/src/services/outbound/outboundSchemas.js`:
   - Move existing 16+ schemas from inline definitions

4. **Wire up** — Route file imports from extracted modules instead of inline definitions

## Acceptance Criteria

- [ ] Route file reduced from 5,200 → ~4,800 lines (main goal: extract, not full decomposition)
- [ ] All existing functionality preserved
- [ ] Extracted utilities have unit tests (see Phase 2.3)
