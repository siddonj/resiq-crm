# Phase 1.4 — Migration Locking

**Labels:** `security`, `architecture`
**Milestone:** Phase 1: Foundation Hardening
**Status:** ✅ Completed

## Description

Added migration tracking and locking to both the server boot (`initDatabase()`) and the migration runner (`run-all-migrations.js`).

## Completed

1. **`_schema_version` tracking table** — Created on boot (via `CREATE TABLE IF NOT EXISTS`) with columns: `version` (TEXT PK), `description`, `applied_at` (TIMESTAMPTZ), `checksum` (TEXT)
2. **PostgreSQL advisory lock** — `pg_advisory_xact_lock(847261004)` acquired at start of migration to prevent concurrent race conditions
3. **`run-all-migrations.js`** — Updated to check `_schema_version` before running each migration; records applied migrations with version tracking
4. **`index.js` `initDatabase()`** — Auto-applies pending migrations on boot with the same tracking mechanism (previously skipped all auto-migrations)
5. **Idempotent** — Already-applied migrations are skipped gracefully; re-runs safe
