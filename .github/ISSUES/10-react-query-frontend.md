# Phase 4 — React Query + Frontend Foundation

**Labels:** `frontend`, `performance`
**Milestone:** Phase 4: Frontend Foundation
**Estimate:** 3-4 days

## Description

The frontend has 15+ `useEffect` fetch chains (especially in `OutboundAutomation.jsx`) with manual loading state management, no caching, and no request deduplication. TanStack Query (React Query) solves all of this.

## Tasks

1. **Install TanStack Query** — `@tanstack/react-query`
2. **Create API layer** — `client/src/api/`:
   - `outboundApi.js` — fetch/approve/suppress leads, campaign endpoints
   - `contactsApi.js`, `dealsApi.js`, `invoicesApi.js`
3. **Create hooks** — `client/src/hooks/`:
   - `useOutboundQueries.js`, `useContacts.js`, etc.
4. **Replace OutboundAutomation.jsx fetch chains** — this is the biggest win
5. **Optimistic updates** — Extend existing pattern (partially done):
   - Draft approvals update UI instantly
   - Lead suppression with rollback on error
6. **Frontend test setup** — `vitest` + RTL + MSW

## Acceptance Criteria

- [ ] OutboundAutomation.jsx loads without `useEffect` fetch chains
- [ ] Data persists across component unmounts (cache)
- [ ] Optimistic updates work with rollback on API error
- [ ] Tests pass in CI
