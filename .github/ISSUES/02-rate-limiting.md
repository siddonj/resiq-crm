# Phase 1.2 — Rate Limiting

**Labels:** `security`
**Milestone:** Phase 1: Foundation Hardening
**Status:** ✅ Already implemented

## Description

Rate limiting was already fully implemented in `server/src/index.js`:
- **Global limiter:** 300 requests per 15 minutes per IP
- **Auth limiter:** 20 requests per 15 minutes (applied to `/api/auth/*`)
- **Outbound limiter:** 60 requests per 1 minute (applied to `/api/outbound/*`)
- All use `express-rate-limit` v8 with standard headers
