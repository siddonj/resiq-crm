/**
 * CommonJS Kysely query builder wrapper.
 *
 * Exports a ready-to-use Kysely instance backed by the existing pg Pool.
 * Route files import this instead of raw pool.query() calls.
 *
 * Usage (in routes):
 *   const { db, sql, ownershipWhere } = require('../db');
 *   const leads = await db.selectFrom('outbound_leads')
 *     .where('user_id', '=', userId)
 *     .selectAll()
 *     .execute();
 *
 * For complex queries:
 *   const { rows } = await sql`SELECT ... ${sql.join(conditions, ' AND ')}`.execute(db);
 */

const { Kysely, PostgresDialect, sql } = require('kysely');
const pool = require('./models/db');

/**
 * Kysely query builder instance.
 *
 * Methods:
 *   db.selectFrom('table')     — SELECT queries
 *   db.insertInto('table')     — INSERT queries
 *   db.updateTable('table')    — UPDATE queries
 *   db.deleteFrom('table')     — DELETE queries
 *   db.transaction()           — transactions (auto-commit/rollback)
 *
 * Always end chains with .execute() (returns array) or .executeTakeFirst().
 *
 * NOTE: This Kysely instance is NOT type-safe at compile time from CommonJS.
 * For type-safe queries, import from './db/kysely' in TypeScript files.
 * The TypeScript definitions in kysely.ts are kept in sync with this wrapper.
 */
const db = new Kysely({
  dialect: new PostgresDialect({ pool }),
});

/**
 * Build ownership/permission WHERE clause for multi-tenant access control.
 *
 * @param {string} alias      - Table alias (e.g., 'c' for contacts, 'd' for deals)
 * @param {string} resourceType - Resource type identifier (e.g., 'contact', 'deal')
 * @param {string} userId     - Current user's ID
 * @param {string} role       - User role: 'admin' | 'manager' | 'user' | 'viewer'
 * @returns {sql} Kysely sql template for use in .where()
 *
 * Admin:     sees everything    (WHERE 1 = 1)
 * Manager:   own + team + shared
 * User/Viewer: own + shared
 */
function ownershipWhere(alias, resourceType, userId, role) {
  if (role === 'admin') return sql`1 = 1`;

  const sharedCheck = sql`EXISTS (
    SELECT 1 FROM shared_resources sr
    WHERE sr.resource_type = ${resourceType}
      AND sr.resource_id = ${sql.ref(alias + '.id')}
      AND (sr.shared_with_user_id = ${userId}
        OR sr.shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = ${userId}))
  )`;

  if (role === 'manager') {
    return sql`(
      ${sql.ref(alias + '.user_id')} = ${userId}
      OR ${sharedCheck}
      OR ${sql.ref(alias + '.user_id')} IN (
        SELECT tm2.user_id FROM team_members tm2
        WHERE tm2.team_id IN (
          SELECT tm1.team_id FROM team_members tm1 WHERE tm1.user_id = ${userId}
        )
      )
    )`;
  }

  // user or viewer
  return sql`(${sql.ref(alias + '.user_id')} = ${userId} OR ${sharedCheck})`;
}

/**
 * Filters a Kysely query to a specific organization.
 * Use on all tenant-scoped tables.
 * @param {string} orgId
 */
function orgWhere(orgId) {
  return (qb) => qb.where('organization_id', '=', orgId);
}

/**
 * Filters a Kysely query to a specific org AND user.
 * Use for personal records (reminders, time_entries, calendar_events).
 * @param {string} orgId
 * @param {string} userId
 */
function orgUserWhere(orgId, userId) {
  return (qb) => qb
    .where('organization_id', '=', orgId)
    .where('user_id', '=', userId);
}

module.exports = { db, sql, ownershipWhere, orgWhere, orgUserWhere, pool };
