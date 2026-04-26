/**
 * Builds a SQL WHERE clause fragment that restricts a resource query to
 * records the requesting user is permitted to see, based on their role.
 *
 * Rules:
 *  - admin    → sees every record (no ownership restriction)
 *  - manager  → sees own + shared + all records owned by fellow team-members
 *  - others   → sees own + explicitly shared
 *
 * @param {string} alias        - SQL alias for the resource table (e.g. 'c' or 'd')
 * @param {string} resourceType - 'contact' or 'deal'
 * @param {string} role         - The requesting user's role
 * @returns {string} A SQL fragment suitable for use in a WHERE clause
 */
function buildOwnershipClause(alias, resourceType, role) {
  if (role === 'admin') {
    return '1=1';
  }

  const sharedCheck = `EXISTS (
    SELECT 1 FROM shared_resources sr
    WHERE sr.resource_type = '${resourceType}' AND sr.resource_id = ${alias}.id
    AND (sr.shared_with_user_id = $1 OR sr.shared_with_team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
  )`;

  if (role === 'manager') {
    return `(${alias}.user_id = $1
      OR ${sharedCheck}
      OR ${alias}.user_id IN (
        SELECT tm2.user_id FROM team_members tm2
        WHERE tm2.team_id IN (SELECT tm1.team_id FROM team_members tm1 WHERE tm1.user_id = $1)
      ))`;
  }

  return `(${alias}.user_id = $1 OR ${sharedCheck})`;
}

module.exports = { buildOwnershipClause };
