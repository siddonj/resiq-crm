const pool = require('../models/db');

const SETTING_DEFINITIONS = {
  allow_synthetic_leads: {
    type: 'boolean',
    envName: 'ALLOW_SYNTHETIC_LEADS',
    fallback: false,
    label: 'Allow Synthetic Leads',
    description:
      'Enable synthetic lead generation endpoints for testing only. Keep disabled in production.',
  },
  outbound_daily_email_send_limit: {
    type: 'integer',
    envName: 'OUTBOUND_DAILY_EMAIL_SEND_LIMIT',
    fallback: 40,
    min: 1,
    max: 5000,
    label: 'Daily Email Send Limit',
    description: 'Maximum outbound email sends allowed per user per day.',
  },
  outbound_daily_linkedin_send_limit: {
    type: 'integer',
    envName: 'OUTBOUND_DAILY_LINKEDIN_SEND_LIMIT',
    fallback: 50,
    min: 1,
    max: 5000,
    label: 'Daily LinkedIn Send Limit',
    description: 'Maximum outbound LinkedIn task completions allowed per user per day.',
  },
};

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowered)) return true;
    if (['false', '0', 'no', 'off'].includes(lowered)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function getDefinition(settingKey) {
  return SETTING_DEFINITIONS[settingKey] || null;
}

function resolveDefaultValue(definition) {
  const envValue = process.env[definition.envName];
  if (definition.type === 'boolean') {
    return normalizeBoolean(envValue, definition.fallback);
  }
  if (definition.type === 'integer') {
    return normalizeInteger(
      envValue,
      definition.fallback,
      Number(definition.min || Number.MIN_SAFE_INTEGER),
      Number(definition.max || Number.MAX_SAFE_INTEGER)
    );
  }
  return definition.fallback;
}

function parseStoredValue(definition, storedValue) {
  const fallback = resolveDefaultValue(definition);
  if (definition.type === 'boolean') return normalizeBoolean(storedValue, fallback);
  if (definition.type === 'integer') {
    return normalizeInteger(
      storedValue,
      fallback,
      Number(definition.min || Number.MIN_SAFE_INTEGER),
      Number(definition.max || Number.MAX_SAFE_INTEGER)
    );
  }
  return fallback;
}

function serializeValue(definition, value) {
  if (definition.type === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function validateIncomingValue(settingKey, rawValue) {
  const definition = getDefinition(settingKey);
  if (!definition) {
    throw new Error(`Unsupported setting key: ${settingKey}`);
  }

  if (definition.type === 'boolean') {
    return normalizeBoolean(rawValue, resolveDefaultValue(definition));
  }

  if (definition.type === 'integer') {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${settingKey} must be a number`);
    }
    const rounded = Math.floor(parsed);
    if (rounded < definition.min || rounded > definition.max) {
      throw new Error(`${settingKey} must be between ${definition.min} and ${definition.max}`);
    }
    return rounded;
  }

  throw new Error(`Unsupported setting type for ${settingKey}`);
}

async function getSettingsRows(settingKeys) {
  if (!settingKeys.length) return [];
  const result = await pool.query(
    `SELECT setting_key, setting_value, updated_at, updated_by
     FROM app_settings
     WHERE setting_key = ANY($1)`,
    [settingKeys]
  );
  return result.rows;
}

async function getSetting(settingKey) {
  const definition = getDefinition(settingKey);
  if (!definition) return null;

  const rows = await getSettingsRows([settingKey]);
  if (!rows.length) return resolveDefaultValue(definition);

  return parseStoredValue(definition, rows[0].setting_value);
}

async function getManagedSettings() {
  const keys = Object.keys(SETTING_DEFINITIONS);
  const rows = await getSettingsRows(keys);
  const rowMap = new Map(rows.map((row) => [row.setting_key, row]));

  return keys.map((key) => {
    const definition = SETTING_DEFINITIONS[key];
    const row = rowMap.get(key);
    const value = row
      ? parseStoredValue(definition, row.setting_value)
      : resolveDefaultValue(definition);

    return {
      key,
      type: definition.type,
      label: definition.label,
      description: definition.description,
      value,
      defaultValue: resolveDefaultValue(definition),
      min: definition.min ?? null,
      max: definition.max ?? null,
      updatedAt: row?.updated_at || null,
    };
  });
}

async function updateManagedSettings(settingsMap, updatedByUserId) {
  const entries = Object.entries(settingsMap || {});
  if (!entries.length) return [];

  const normalized = entries.map(([key, rawValue]) => {
    const definition = getDefinition(key);
    if (!definition) throw new Error(`Unsupported setting key: ${key}`);
    const value = validateIncomingValue(key, rawValue);
    return { key, definition, value };
  });

  for (const item of normalized) {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [item.key, serializeValue(item.definition, item.value), updatedByUserId || null]
    );
  }

  const updatedKeys = normalized.map((item) => item.key);
  return getSettingsRows(updatedKeys);
}

module.exports = {
  SETTING_DEFINITIONS,
  getSetting,
  getManagedSettings,
  updateManagedSettings,
  validateIncomingValue,
};
