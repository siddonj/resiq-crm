const pool = require('../models/db');

function logAction(userId, userEmail, action, resourceType, resourceId = null, resourceName = null, metadata = {}) {
  pool.query(
    `INSERT INTO audit_logs (user_id, user_email, action, resource_type, resource_id, resource_name, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, userEmail, action, resourceType, resourceId, resourceName, JSON.stringify(metadata)]
  ).catch(err => console.error('Audit log error:', err.message));
}

module.exports = { logAction };
