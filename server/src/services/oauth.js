const crypto = require('crypto');
const pool = require('../models/db');

// Token encryption using built-in crypto module
class TokenManager {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.key = Buffer.from(process.env.ENCRYPTION_KEY || 'dev-key-32-chars-pad-pad-pad-pad', 'utf8'); // Must be 32 bytes for aes-256
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be exactly 32 bytes');
    }
  }

  encrypt(token) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    // Format: iv:encrypted:authTag (all hex)
    return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
  }

  decrypt(encryptedData) {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted token format');

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Store tokens in DB (encrypted)
  async saveTokens(user_id, provider, accessToken, refreshToken, expiresAt) {
    const encryptedAccess = this.encrypt(accessToken);
    const encryptedRefresh = refreshToken ? this.encrypt(refreshToken) : null;

    const result = await pool.query(
      `UPDATE users
       SET oauth_provider = $1, oauth_access_token = $2, oauth_refresh_token = $3, oauth_expires_at = $4
       WHERE id = $5
       RETURNING id, oauth_provider`,
      [provider, encryptedAccess, encryptedRefresh, expiresAt, user_id]
    );
    return result.rows[0];
  }

  // Retrieve and decrypt tokens
  async getTokens(user_id) {
    const result = await pool.query(
      'SELECT oauth_access_token, oauth_refresh_token, oauth_expires_at, oauth_provider FROM users WHERE id = $1',
      [user_id]
    );
    if (!result.rows[0]) return null;

    const user = result.rows[0];
    try {
      return {
        provider: user.oauth_provider,
        accessToken: user.oauth_access_token ? this.decrypt(user.oauth_access_token) : null,
        refreshToken: user.oauth_refresh_token ? this.decrypt(user.oauth_refresh_token) : null,
        expiresAt: user.oauth_expires_at,
      };
    } catch (err) {
      console.error('Token decryption failed:', err.message);
      return null;
    }
  }

  // Check if token is expired
  isTokenExpired(expiresAt) {
    if (!expiresAt) return true;
    return new Date(expiresAt) < new Date();
  }

  // Clear tokens (disconnect)
  async clearTokens(user_id) {
    await pool.query(
      `UPDATE users
       SET oauth_provider = NULL, oauth_access_token = NULL, oauth_refresh_token = NULL, oauth_expires_at = NULL
       WHERE id = $1`,
      [user_id]
    );
  }
}

module.exports = new TokenManager();
