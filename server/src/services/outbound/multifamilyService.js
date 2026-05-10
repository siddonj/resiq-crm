const pool = require('../../models/db');
const outboundUtils = require('../../utils/outboundUtils');

async function verifyMultifamilyAssociationTarget(userId, entityType, entityId) {
  if (entityType === 'outbound_lead') {
    const result = await pool.query(
      `SELECT id, name, email, company, title
       FROM outbound_leads
       WHERE id = $1
         AND user_id = $2
       LIMIT 1`,
      [entityId, userId]
    );
    return result.rows[0] || null;
  }

  if (entityType === 'contact') {
    const result = await pool.query(
      `SELECT id, name, email, company, NULL::text AS title
       FROM contacts
       WHERE id = $1
         AND user_id = $2
       LIMIT 1`,
      [entityId, userId]
    );
    return result.rows[0] || null;
  }

  if (entityType === 'deal') {
    const result = await pool.query(
      `SELECT d.id, d.title AS name, NULL::text AS email, c.company AS company, d.service_line AS title
       FROM deals d
       LEFT JOIN contacts c ON c.id = d.contact_id
       WHERE d.id = $1
         AND d.user_id = $2
       LIMIT 1`,
      [entityId, userId]
    );
    return result.rows[0] || null;
  }

  return null;
}

async function getAverageClosedWonValue(userId) {
  const result = await pool.query(
    `SELECT
       COALESCE(AVG(value), 0)::numeric(14,2) AS avg_closed_won_value
     FROM deals
     WHERE user_id = $1
       AND stage = 'closed_won'
       AND value IS NOT NULL
       AND value > 0`,
    [userId]
  );
  const value = Number(result.rows[0]?.avg_closed_won_value || 0);
  return value > 0 ? value : 25000;
}

module.exports = { verifyMultifamilyAssociationTarget, getAverageClosedWonValue };
