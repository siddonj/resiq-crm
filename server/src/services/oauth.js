const crypto = require('crypto');
const pool = require('../models/db');

class TokenManager {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    if (!process.env.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY env var is required (32 bytes) - no insecure default is allowed');
    }
    this.key = Buffer.from(process.env.ENCRYPTION_KEY, 'utf8'); // Must be 32 bytes for aes-256
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

  async saveTokens(user_id, service_type, accessToken, refreshToken, expiresAt) {
    const encryptedAccess = this.encrypt(accessToken);
    const encryptedRefresh = refreshToken ? this.encrypt(refreshToken) : null;
    await pool.query(
      `INSERT INTO oauth_tokens (user_id, service_type, access_token, refresh_token, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, service_type) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
      [user_id, service_type, encryptedAccess, encryptedRefresh, expiresAt]
    );
  }

  async getTokens(user_id, service_type) {
    const result = await pool.query(
      'SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE user_id = $1 AND service_type = $2',
      [user_id, service_type]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    try {
      return {
        provider: service_type,
        accessToken: row.access_token ? this.decrypt(row.access_token) : null,
        refreshToken: row.refresh_token ? this.decrypt(row.refresh_token) : null,
        expiresAt: row.expires_at,
      };
    } catch (err) {
      console.error('Token decryption failed:', err.message);
      return null;
    }
  }

  isTokenExpired(expiresAt) {
    if (!expiresAt) return true;
    return new Date(expiresAt) < new Date();
  }

  async clearTokens(user_id, service_type) {
    await pool.query(
      'DELETE FROM oauth_tokens WHERE user_id = $1 AND service_type = $2',
      [user_id, service_type]
    );
  }
}

module.exports = new TokenManager();
