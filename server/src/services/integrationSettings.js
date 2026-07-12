const pool = require('../models/db');
const tokenManager = require('./oauth');

const SETTING_DEFINITIONS = {
  twilio_account_sid: { provider: 'twilio', type: 'string', secret: false, envName: 'TWILIO_ACCOUNT_SID', label: 'Account SID' },
  twilio_auth_token: { provider: 'twilio', type: 'string', secret: true, envName: 'TWILIO_AUTH_TOKEN', label: 'Auth Token' },
  twilio_phone_number: { provider: 'twilio', type: 'string', secret: false, envName: 'TWILIO_PHONE_NUMBER', label: 'Phone Number' },
  stripe_secret_key: { provider: 'stripe', type: 'string', secret: true, envName: 'STRIPE_SECRET_KEY', label: 'Secret Key' },
  stripe_webhook_secret: { provider: 'stripe', type: 'string', secret: true, envName: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook Secret' },
  smtp_host: { provider: 'smtp', type: 'string', secret: false, envName: 'SMTP_HOST', label: 'Host' },
  smtp_port: { provider: 'smtp', type: 'integer', secret: false, envName: 'SMTP_PORT', label: 'Port' },
  smtp_user: { provider: 'smtp', type: 'string', secret: false, envName: 'SMTP_USER', label: 'Username' },
  smtp_pass: { provider: 'smtp', type: 'string', secret: true, envName: 'SMTP_PASS', label: 'Password' },
  smtp_from: { provider: 'smtp', type: 'string', secret: false, envName: 'SMTP_FROM', label: 'From Address' },
  smtp_secure: { provider: 'smtp', type: 'boolean', secret: false, envName: 'SMTP_SECURE', label: 'Use TLS' },
  hunter_api_key: { provider: 'hunter', type: 'string', secret: true, envName: 'HUNTER_API_KEY', label: 'API Key' },
  openai_api_key: { provider: 'openai', type: 'string', secret: true, envName: 'OPENAI_API_KEY', label: 'API Key' },
};

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowered)) return true;
    if (['false', '0', 'no', 'off'].includes(lowered)) return false;
  }
  return fallback;
}

function normalizeValue(definition, raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (definition.type === 'integer') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
  }
  if (definition.type === 'boolean') return normalizeBoolean(raw, false);
  return String(raw);
}

function getDefinition(key) {
  return SETTING_DEFINITIONS[key] || null;
}

function resolveEnvValue(definition) {
  return normalizeValue(definition, process.env[definition.envName]);
}

function maskValue(value) {
  if (!value) return null;
  const str = String(value);
  if (str.length <= 4) return '••••';
  return `••••${str.slice(-4)}`;
}

async function getSettingsRows(keys) {
  if (!keys.length) return [];
  const result = await pool.query(
    `SELECT credential_key, credential_value, updated_at, updated_by
     FROM integration_credentials
     WHERE credential_key = ANY($1)`,
    [keys]
  );
  return result.rows;
}

function decodeRowValue(definition, row) {
  if (!row) return resolveEnvValue(definition);
  if (definition.secret) {
    try {
      return tokenManager.decrypt(row.credential_value);
    } catch (err) {
      console.error(`Failed to decrypt integration credential ${row.credential_key}:`, err.message);
      return resolveEnvValue(definition);
    }
  }
  return normalizeValue(definition, row.credential_value);
}

// Raw resolved value (DB -> env fallback), decrypted. Internal/runtime use only —
// never return this directly over the API for a secret field.
async function getSetting(key) {
  const definition = getDefinition(key);
  if (!definition) return null;
  const rows = await getSettingsRows([key]);
  return decodeRowValue(definition, rows[0] || null);
}

// Resolves every field for one provider at once — used by the lazy client getters.
async function getProviderCredentials(provider) {
  const keys = Object.keys(SETTING_DEFINITIONS).filter((k) => SETTING_DEFINITIONS[k].provider === provider);
  const rows = await getSettingsRows(keys);
  const rowMap = new Map(rows.map((r) => [r.credential_key, r]));
  const result = {};
  keys.forEach((key) => {
    result[key] = decodeRowValue(SETTING_DEFINITIONS[key], rowMap.get(key) || null);
  });
  return result;
}

async function getManagedCredentials() {
  const keys = Object.keys(SETTING_DEFINITIONS);
  const rows = await getSettingsRows(keys);
  const rowMap = new Map(rows.map((r) => [r.credential_key, r]));

  return keys.map((key) => {
    const definition = SETTING_DEFINITIONS[key];
    const row = rowMap.get(key);
    const value = decodeRowValue(definition, row || null);
    const configured = value !== null && value !== undefined && value !== '';

    return {
      key,
      provider: definition.provider,
      type: definition.type,
      secret: definition.secret,
      label: definition.label,
      configured,
      ...(definition.secret ? { maskedValue: maskValue(value) } : { value }),
      updatedAt: row?.updated_at || null,
    };
  });
}

async function updateManagedCredentials(settingsMap, updatedByUserId) {
  const entries = Object.entries(settingsMap || {});
  if (!entries.length) return [];

  const normalized = entries.map(([key, rawValue]) => {
    const definition = getDefinition(key);
    if (!definition) throw new Error(`Unsupported integration credential key: ${key}`);
    const value = normalizeValue(definition, rawValue);
    if (value === null) throw new Error(`${key} cannot be empty`);
    return { key, definition, value };
  });

  for (const item of normalized) {
    const storedValue = item.definition.secret
      ? tokenManager.encrypt(String(item.value))
      : String(item.value);
    await pool.query(
      `INSERT INTO integration_credentials (credential_key, credential_value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (credential_key)
       DO UPDATE SET credential_value = EXCLUDED.credential_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [item.key, storedValue, updatedByUserId || null]
    );
  }

  return getManagedCredentials();
}

// Resolves a value for the test-connection endpoint: an unsaved form override wins,
// otherwise falls back to the saved/env value (same resolution as the runtime getters).
async function resolveWithOverride(key, overrides) {
  const override = overrides ? overrides[key] : undefined;
  if (override !== undefined && override !== null && override !== '') {
    return normalizeValue(getDefinition(key), override);
  }
  return getSetting(key);
}

module.exports = {
  SETTING_DEFINITIONS,
  getSetting,
  getProviderCredentials,
  getManagedCredentials,
  updateManagedCredentials,
  resolveWithOverride,
};
