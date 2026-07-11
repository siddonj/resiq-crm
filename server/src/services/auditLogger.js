const pool = require('../models/db');

/**
 * Fail-closed org resolution for callers that don't have req.orgId in scope
 * (background jobs, pre-auth routes like login, or service functions several
 * layers removed from the request). Fetches ALL memberships for the user and
 * throws on ambiguity rather than silently picking one — mirrors
 * complianceService.js's resolveOrgIdForUser (Task 5 pattern).
 */
async function resolveOrgIdForUser(userId) {
  const res = await pool.query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1`,
    [userId]
  );
  if (res.rows.length > 1) {
    throw new Error(`logAction: user ${userId} has multiple organization memberships; org id is ambiguous.`);
  }
  return res.rows[0]?.organization_id || null;
}

function logAction(userId, userEmail, action, resourceType, resourceId = null, resourceName = null, metadata = {}, orgId = null) {
  (async () => {
    const resolvedOrgId = orgId || await resolveOrgIdForUser(userId);
    if (!resolvedOrgId) {
      throw new Error(`logAction: could not resolve organization_id for user ${userId}`);
    }
    // audit_logs.organization_id is NOT NULL with no DEFAULT (migration 062) — every
    // INSERT here must stamp it or the write silently fails (see the .catch below).
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_email, action, resource_type, resource_id, resource_name, metadata, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, userEmail, action, resourceType, resourceId, resourceName, JSON.stringify(metadata), resolvedOrgId]
    );
  })().catch(err => console.error('Audit log error:', err.message));
  // NOTE: failures here (including org resolution failures) are swallowed to console.error
  // only, same as before this fix — this is why the pre-fix NOT NULL violations went
  // unnoticed since migration 062. Worth a follow-up: alert/metric on audit-log write
  // failures instead of console.error only (out of scope for this fix).
}

module.exports = { logAction, resolveOrgIdForUser };
