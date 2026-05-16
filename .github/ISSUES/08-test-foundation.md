# Phase 2.3 — Test Foundation

**Labels:** `testing`
**Milestone:** Phase 2: Code Quality & Test Foundation
**Estimate:** 2 days

## Description

The project has only 5 test files — all server-side. No frontend tests exist at all. This makes refactoring risky and regressions easy to miss.

## Tasks

### Server Tests
1. Port the 57 existing `outboundUtils.test.js` tests (from Phase 25 planning) to the project
2. Port the 19 existing `outboundSchemas.test.js` tests
3. Set up integration test framework:
   - Install `supertest`
   - Create test database configuration
   - Write integration tests for auth flow, contacts CRUD, deals pipeline

### Client Tests
1. Install `vitest` + `@testing-library/react`
2. Set up test configuration
3. Write initial component tests for:
   - `SMSComposeModal.jsx`
   - `SequenceBuilderModal.jsx`
   - `GmailConnect.jsx`

## Acceptance Criteria

- [ ] 80+ total tests passing
- [ ] Integration test scripts documented in `DEV_SETUP.md`
- [ ] Tests run as part of CI pipeline
