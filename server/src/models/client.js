const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('./db');

const INVITATION_EXPIRY_HOURS = 48;

/**
 * Find client by ID
 */
async function findById(clientId) {
  const result = await pool.query(
    'SELECT * FROM clients WHERE id = $1',
    [clientId]
  );
  return result.rows[0] || null;
}

/**
 * Find client by email
 */
async function findByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM clients WHERE email = $1',
    [email.toLowerCase()]
  );
  return result.rows[0] || null;
}

/**
 * Find client by slug (for public portal URL)
 */
async function findBySlug(slug) {
  const result = await pool.query(
    'SELECT * FROM clients WHERE slug = $1 AND is_active = true',
    [slug]
  );
  return result.rows[0] || null;
}

/**
 * Create or update client from invitation
 * Called when client verifies their invitation token and sets password
 */
async function createOrUpdateFromInvitation(token, name, passwordHash) {
  const client = await pool.query('BEGIN');

  try {
    // Verify invitation exists and is not expired
    const invResult = await pool.query(
      `SELECT id, email, token FROM client_invitations 
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [token]
    );

    if (!invResult.rows[0]) {
      throw new Error('Invalid or expired invitation token');
    }

    const invitation = invResult.rows[0];
    const email = invitation.email.toLowerCase();

    // Check if client already exists
    let clientResult = await pool.query(
      'SELECT id FROM clients WHERE email = $1',
      [email]
    );

    let clientId;
    if (clientResult.rows[0]) {
      // Update existing client
      clientId = clientResult.rows[0].id;
      await pool.query(
        `UPDATE clients 
         SET name = $1, password_hash = $2, first_login_at = NOW(), updated_at = NOW() 
         WHERE id = $3`,
        [name, passwordHash, clientId]
      );
    } else {
      // Create new client
      const slug = generateSlug(name);
      const createResult = await pool.query(
        `INSERT INTO clients (name, email, slug, password_hash, first_login_at) 
         VALUES ($1, $2, $3, $4, NOW()) 
         RETURNING id`,
        [name, email, slug, passwordHash]
      );
      clientId = createResult.rows[0].id;
    }

    // Mark invitation as used
    await pool.query(
      `UPDATE client_invitations 
       SET used_at = NOW(), used_by = $1 
       WHERE id = $2`,
      [clientId, invitation.id]
    );

    await pool.query('COMMIT');
    return clientId;
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
}

/**
 * Create invitation for a new client (employee invites)
 */
async function createInvitation(email, createdByUserId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + INVITATION_EXPIRY_HOURS);

  const result = await pool.query(
    `INSERT INTO client_invitations (email, token, created_by, expires_at) 
     VALUES ($1, $2, $3, $4) 
     RETURNING id, token, expires_at`,
    [email.toLowerCase(), token, createdByUserId, expiresAt]
  );

  return result.rows[0];
}

/**
 * Verify invitation token (passwordless step 1: email verification)
 */
async function verifyInvitationToken(token) {
  const result = await pool.query(
    `SELECT id, email, token, expires_at FROM client_invitations 
     WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [token]
  );

  if (!result.rows[0]) {
    return null;
  }

  return result.rows[0];
}

/**
 * Verify client password (for login)
 */
async function verifyPassword(clientId, plainPassword) {
  const client = await findById(clientId);
  if (!client || !client.password_hash) {
    return false;
  }

  return bcrypt.compare(plainPassword, client.password_hash);
}

/**
 * Set or update client password
 */
async function setPassword(clientId, plainPassword) {
  const passwordHash = await bcrypt.hash(plainPassword, 12);

  await pool.query(
    'UPDATE clients SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [passwordHash, clientId]
  );
}

/**
 * Grant client access to a deal (for sharing proposals/invoices)
 */
async function grantDealAccess(clientId, dealId, createdByUserId) {
  const result = await pool.query(
    `INSERT INTO client_deal_access (client_id, deal_id, created_by) 
     VALUES ($1, $2, $3) 
     ON CONFLICT (client_id, deal_id) DO NOTHING 
     RETURNING id`,
    [clientId, dealId, createdByUserId]
  );

  return result.rows[0] ? true : false;
}

/**
 * Revoke client access to a deal
 */
async function revokeDealAccess(clientId, dealId) {
  const result = await pool.query(
    'DELETE FROM client_deal_access WHERE client_id = $1 AND deal_id = $2',
    [clientId, dealId]
  );

  return result.rowCount > 0;
}

/**
 * Get all deals accessible to a client
 */
async function getAccessibleDeals(clientId) {
  const result = await pool.query(
    `SELECT d.* FROM deals d 
     INNER JOIN client_deal_access cda ON d.id = cda.deal_id 
     WHERE cda.client_id = $1 
     ORDER BY d.created_at DESC`,
    [clientId]
  );

  return result.rows;
}

/**
 * Share an item (proposal/invoice/file) with client
 */
async function shareItem(clientId, itemType, itemId, sharedByUserId) {
  const result = await pool.query(
    `INSERT INTO client_shared_items (client_id, item_type, item_id, shared_by) 
     VALUES ($1, $2, $3, $4) 
     RETURNING id`,
    [clientId, itemType, itemId, sharedByUserId]
  );

  return result.rows[0] ? true : false;
}

/**
 * Log client activity (for audit trail)
 */
async function logActivity(clientId, action, metadata = {}, ipAddress = null, userAgent = null, dealId = null) {
  const result = await pool.query(
    `INSERT INTO client_activities (client_id, deal_id, action, metadata, ip_address, user_agent) 
     VALUES ($1, $2, $3, $4, $5, $6) 
     RETURNING id`,
    [clientId, dealId, action, JSON.stringify(metadata), ipAddress, userAgent]
  );

  return result.rows[0]?.id || null;
}

/**
 * Update last login time
 */
async function updateLastLogin(clientId) {
  await pool.query(
    'UPDATE clients SET last_login_at = NOW() WHERE id = $1',
    [clientId]
  );
}

/**
 * Generate unique slug from name
 */
function generateSlug(name) {
  let slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');

  // Add random suffix to ensure uniqueness
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${slug}-${suffix}`;
}

/**
 * Check if client has access to a deal
 */
async function hasDealAccess(clientId, dealId) {
  const result = await pool.query(
    'SELECT id FROM client_deal_access WHERE client_id = $1 AND deal_id = $2',
    [clientId, dealId]
  );

  return result.rows.length > 0;
}

/**
 * Deactivate client account
 */
async function deactivate(clientId) {
  await pool.query(
    'UPDATE clients SET is_active = false, updated_at = NOW() WHERE id = $1',
    [clientId]
  );
}

module.exports = {
  findById,
  findByEmail,
  findBySlug,
  createOrUpdateFromInvitation,
  createInvitation,
  verifyInvitationToken,
  verifyPassword,
  setPassword,
  grantDealAccess,
  revokeDealAccess,
  getAccessibleDeals,
  shareItem,
  logActivity,
  updateLastLogin,
  hasDealAccess,
  deactivate,
};
