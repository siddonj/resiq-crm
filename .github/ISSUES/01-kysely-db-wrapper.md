# Phase 1.1 — Create Kysely DB Wrapper & Convert First Routes

**Labels:** `architecture`, `security`
**Milestone:** Phase 1: Foundation Hardening
**Status:** ✅ Completed

## Description

The Kysely CommonJS wrapper (`server/src/db.js`) has been created and three routes have been converted from raw `pool.query()` calls to Kysely/`sql` template queries.

## Completed

1. **`server/src/db.js`** — CommonJS wrapper exporting `{ db, sql, ownershipWhere, pool }`
2. **`auth.js`** — Login uses `db.selectFrom('users')`, registration uses `db.transaction().execute(async (trx) => ...)` with Kysely transaction (replaces manual `pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK`)
3. **`auditLogs.js`** — Dynamic WHERE converted to `sql.join(conditions, ' AND ')` pattern, both data + count queries use `sql` templates
4. **`activities.js`** — GET uses `sql` template with JOINs, POST uses `db.insertInto().values().returningAll().executeTakeFirstOrThrow()`, DELETE uses `db.deleteFrom().where()`

## Results
- **6** `pool.query()` calls eliminated (1 auth + 2 auditLogs + 3 activities)
- **533** remaining across the codebase (down from 539)
- All syntax verified: `node -c` passes on all files
- Module loads successfully: `require('./src/db')` resolves all exports
