# Integration Settings in Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Twilio, Stripe, SMTP, Hunter.io, and OpenAI credentials out of `.env`-only config and into the Settings UI, with per-provider "Test Connection" buttons that surface the real provider error.

**Architecture:** A new `integration_credentials` DB table (encrypted at rest via the existing `TokenManager`) backs a new `integrationSettings` service that resolves each field DB-first, `.env`-fallback. Every server module that currently builds a provider client once at `require()` time from `process.env` (Twilio, Stripe, SMTP, OpenAI, Hunter.io) is converted to an async lazy getter that re-resolves credentials on each call, so DB edits take effect immediately. A new admin-only route exposes GET/PUT for credentials (secrets always masked in responses) and a POST `.../:provider/test` endpoint that runs a live check. A new `IntegrationCredentials.jsx` component renders one card per provider inside the existing "Integrations" tab of `Settings.jsx`.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), Jest + Supertest, React (Vite), axios, existing `TokenManager` (AES-256-GCM) in `server/src/services/oauth.js`.

## Global Constraints

- Single global credential set — no per-organization scoping (spec: `docs/superpowers/specs/2026-07-12-integration-settings-design.md`, Non-Goals).
- Only these 5 providers in scope: Twilio, Stripe, SMTP, Hunter.io, OpenAI. Gmail/Google Calendar OAuth client ID/secret, `JWT_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, `REDIS_URL` stay in `.env` only — never touched by this plan.
- DB value wins when present; `.env` is the fallback default for every field.
- Secrets are never returned to the client in plaintext — GET responses mask with `••••` + last 4 chars; PUT only overwrites a secret when the client actually sends a new value.
- No caching layer for resolved credentials (YAGNI) — every lazy getter reads the DB directly.
- Route gated `auth` + `requireRole('admin')`, matching `/api/app-settings`.
- Next available migration number is `065` (latest existing is `064-sms-org-scope.sql`).

---

## File Structure

**Create:**
- `database/migrations/065-integration-credentials.sql` — new table
- `server/src/services/integrationSettings.js` — credential definitions, resolution, masking, CRUD
- `server/src/services/stripeClient.js` — lazy Stripe client getter
- `server/src/services/openaiClient.js` — lazy OpenAI client getter (shared across all call sites)
- `server/src/routes/integrationSettings.js` — GET/PUT/`:provider/test` routes
- `server/src/tests/integrationSettings.service.test.js`
- `server/src/tests/integrationSettingsRoutes.test.js`
- `server/src/tests/twilioService.test.js`
- `server/src/tests/stripeClient.test.js`
- `server/src/tests/openaiClient.test.js`
- `server/src/tests/clientNotifications.transporter.test.js`
- `client/src/components/IntegrationCredentials.jsx` — provider cards UI

**Modify:**
- `server/src/index.js` — mount the new route
- `server/src/services/twilioService.js` — lazy Twilio client
- `server/src/services/webhookReceiver.js` — await the now-async Twilio checks
- `server/src/routes/webhooks.js` — await `validateSignature`
- `server/src/routes/stripe.js`, `server/src/services/stripeWebhooks.js` — use `stripeClient.js`
- `server/src/services/clientNotifications.js` — lazy SMTP transporter
- `server/src/routes/agents.js`, `server/src/routes/proposals.js`, `server/src/routes/tickets.js`, `server/src/services/agentService.js`, `server/src/workers/enrichmentWorker.js` — use `openaiClient.js`; `enrichmentWorker.js` also uses `integrationSettings.js` for Hunter.io
- `client/src/pages/Settings.jsx` — render `IntegrationCredentials` in the Integrations tab

---

### Task 1: Migration + `integrationSettings` service

**Files:**
- Create: `database/migrations/065-integration-credentials.sql`
- Create: `server/src/services/integrationSettings.js`
- Test: `server/src/tests/integrationSettings.service.test.js`

**Interfaces:**
- Produces: `SETTING_DEFINITIONS` (object keyed by credential key, each `{ provider, type, secret, envName, label }`), `async getSetting(key): Promise<string|number|boolean|null>`, `async getProviderCredentials(provider): Promise<Record<string,value>>`, `async getManagedCredentials(): Promise<Array<{key,provider,type,secret,label,configured,value?,maskedValue?,updatedAt}>>`, `async updateManagedCredentials(settingsMap, updatedByUserId): Promise<Array<...>>` (throws `Error('Unsupported integration credential key: <key>')` or `Error('<key> cannot be empty')` on bad input), `async resolveWithOverride(key, overrides): Promise<value>`.

- [ ] **Step 1: Write the migration**

```sql
-- database/migrations/065-integration-credentials.sql
-- Migration 065: Integration credentials (admin-managed, encrypted runtime
-- credentials for Twilio, Stripe, SMTP, Hunter.io, and OpenAI)

CREATE TABLE IF NOT EXISTS integration_credentials (
  credential_key   TEXT PRIMARY KEY,
  credential_value TEXT NOT NULL,
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_updated_at ON integration_credentials(updated_at DESC);
```

- [ ] **Step 2: Apply the migration**

Run: `node run-all-migrations.js`
Expected: output includes `Applying migration: 065-integration-credentials.sql` and exits 0.

- [ ] **Step 3: Write the failing service tests**

```javascript
// server/src/tests/integrationSettings.service.test.js
process.env.ENCRYPTION_KEY = 'a'.repeat(32);

jest.mock('../models/db', () => ({ query: jest.fn() }));

const pool = require('../models/db');
const {
  getSetting,
  getManagedCredentials,
  updateManagedCredentials,
  resolveWithOverride,
} = require('../services/integrationSettings');

describe('integrationSettings service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.OPENAI_API_KEY;
  });

  test('getSetting falls back to the env var when no DB row exists', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    process.env.TWILIO_ACCOUNT_SID = 'ACenvvalue';

    const value = await getSetting('twilio_account_sid');

    expect(value).toBe('ACenvvalue');
  });

  test('getSetting returns null when neither DB nor env is set', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const value = await getSetting('openai_api_key');

    expect(value).toBeNull();
  });

  test('updateManagedCredentials encrypts secret fields before persisting', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // INSERT ... ON CONFLICT
    pool.query.mockResolvedValueOnce({ rows: [] }); // refresh read in getManagedCredentials

    await updateManagedCredentials({ openai_api_key: 'sk-test-12345' }, 'user-1');

    const insertCall = pool.query.mock.calls[0];
    expect(insertCall[0]).toMatch(/INSERT INTO integration_credentials/);
    const storedValue = insertCall[1][1];
    expect(storedValue).not.toBe('sk-test-12345');
    expect(storedValue.split(':')).toHaveLength(3); // iv:encrypted:authTag
  });

  test('updateManagedCredentials rejects unknown keys', async () => {
    await expect(updateManagedCredentials({ bogus_key: 'x' }, 'user-1')).rejects.toThrow(
      'Unsupported integration credential key: bogus_key'
    );
  });

  test('getManagedCredentials masks secret values and never returns the raw value', async () => {
    const tokenManager = require('../services/oauth');
    pool.query.mockResolvedValue({
      rows: [
        {
          credential_key: 'stripe_secret_key',
          credential_value: tokenManager.encrypt('sk_live_abcd1234'),
          updated_at: null,
          updated_by: null,
        },
      ],
    });

    const settings = await getManagedCredentials();
    const stripeKey = settings.find((s) => s.key === 'stripe_secret_key');

    expect(stripeKey.value).toBeUndefined();
    expect(stripeKey.configured).toBe(true);
    expect(stripeKey.maskedValue).toBe('••••1234');
  });

  test('resolveWithOverride prefers the override value over the saved value', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    process.env.OPENAI_API_KEY = 'sk-env-value';

    const value = await resolveWithOverride('openai_api_key', { openai_api_key: 'sk-draft-value' });

    expect(value).toBe('sk-draft-value');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd server && npx jest src/tests/integrationSettings.service.test.js`
Expected: FAIL — `Cannot find module '../services/integrationSettings'`

- [ ] **Step 5: Implement the service**

```javascript
// server/src/services/integrationSettings.js
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && npx jest src/tests/integrationSettings.service.test.js`
Expected: PASS — 6 tests

- [ ] **Step 7: Commit**

```bash
git add database/migrations/065-integration-credentials.sql server/src/services/integrationSettings.js server/src/tests/integrationSettings.service.test.js
git commit -m "feat: add integration_credentials table and settings service"
```

---

### Task 2: GET/PUT `/api/integration-settings` route

**Files:**
- Create: `server/src/routes/integrationSettings.js`
- Modify: `server/src/index.js` (mount the route)
- Test: `server/src/tests/integrationSettingsRoutes.test.js`

**Interfaces:**
- Consumes: `getManagedCredentials`, `updateManagedCredentials` from Task 1 (`server/src/services/integrationSettings.js`); `logAction(userId, userEmail, action, resourceType, resourceId, resourceName, metadata, orgId)` from `server/src/services/auditLogger.js`; `requireRole(...roles)` from `server/src/middleware/requireRole.js`.
- Produces: Express router exported as `module.exports`, mounted at `/api/integration-settings`. `GET /` → `{ settings: [...] }`. `PUT /` (body `{ settings: {...} }`) → `{ settings: [...] }` or `400` on bad input.

- [ ] **Step 1: Write the failing route tests**

```javascript
// server/src/tests/integrationSettingsRoutes.test.js
const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => (req, res, next) => {
  req.user = { id: 'user-1', email: 'admin@example.com', role: 'admin' };
  req.orgId = 'org-1';
  next();
});

jest.mock('../services/integrationSettings', () => ({
  getManagedCredentials: jest.fn(),
  updateManagedCredentials: jest.fn(),
  resolveWithOverride: jest.fn(),
}));

jest.mock('../services/auditLogger', () => ({ logAction: jest.fn() }));

const {
  getManagedCredentials,
  updateManagedCredentials,
} = require('../services/integrationSettings');
const { logAction } = require('../services/auditLogger');
const router = require('../routes/integrationSettings');

describe('integration settings routes (GET/PUT)', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/integration-settings', router);

  beforeEach(() => jest.clearAllMocks());

  test('GET returns the managed credential list', async () => {
    getManagedCredentials.mockResolvedValue([{ key: 'openai_api_key', configured: false }]);

    const res = await request(app).get('/api/integration-settings');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ settings: [{ key: 'openai_api_key', configured: false }] });
  });

  test('PUT rejects a missing settings object', async () => {
    const res = await request(app).put('/api/integration-settings').send({});

    expect(res.status).toBe(400);
    expect(updateManagedCredentials).not.toHaveBeenCalled();
  });

  test('PUT saves credentials, logs the action, and returns the refreshed list', async () => {
    updateManagedCredentials.mockResolvedValue();
    getManagedCredentials.mockResolvedValue([{ key: 'openai_api_key', configured: true }]);

    const res = await request(app)
      .put('/api/integration-settings')
      .send({ settings: { openai_api_key: 'sk-new' } });

    expect(res.status).toBe(200);
    expect(updateManagedCredentials).toHaveBeenCalledWith({ openai_api_key: 'sk-new' }, 'user-1');
    expect(logAction).toHaveBeenCalledWith(
      'user-1',
      'admin@example.com',
      'update',
      'integration_credentials',
      null,
      'integration_settings',
      { updated_keys: ['openai_api_key'] },
      'org-1'
    );
    expect(res.body).toEqual({ settings: [{ key: 'openai_api_key', configured: true }] });
  });

  test('PUT returns 400 for an unsupported key', async () => {
    updateManagedCredentials.mockRejectedValue(new Error('Unsupported integration credential key: bogus'));

    const res = await request(app)
      .put('/api/integration-settings')
      .send({ settings: { bogus: 'x' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported integration credential key/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest src/tests/integrationSettingsRoutes.test.js`
Expected: FAIL — `Cannot find module '../routes/integrationSettings'`

- [ ] **Step 3: Implement the route (GET/PUT only — test-connection is Task 3)**

```javascript
// server/src/routes/integrationSettings.js
const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  getManagedCredentials,
  updateManagedCredentials,
} = require('../services/integrationSettings');
const { logAction } = require('../services/auditLogger');

const router = express.Router();

router.use(auth, requireRole('admin'));

/**
 * GET /api/integration-settings
 * Admin: list managed integration credentials (secrets masked).
 */
router.get('/', async (req, res) => {
  try {
    const settings = await getManagedCredentials();
    res.json({ settings });
  } catch (err) {
    console.error('Error loading integration settings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/integration-settings
 * Admin: update one or more integration credentials.
 * Body: { settings: { key: value, ... } }
 */
router.put('/', async (req, res) => {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return res.status(400).json({ error: 'settings object is required' });
  }

  try {
    await updateManagedCredentials(settings, req.user.id);
    const refreshed = await getManagedCredentials();

    logAction(
      req.user.id,
      req.user.email,
      'update',
      'integration_credentials',
      null,
      'integration_settings',
      { updated_keys: Object.keys(settings) },
      req.orgId
    );

    res.json({ settings: refreshed });
  } catch (err) {
    if (err.message && (err.message.includes('Unsupported integration credential key') || err.message.includes('cannot be empty'))) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error updating integration settings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest src/tests/integrationSettingsRoutes.test.js`
Expected: PASS — 4 tests

- [ ] **Step 5: Mount the route in `server/src/index.js`**

Add the require near the existing `appSettingsRoutes` require (`server/src/index.js:54`):

```javascript
const appSettingsRoutes = require('./routes/appSettings');
const integrationSettingsRoutes = require('./routes/integrationSettings');
```

Add the mount immediately after the existing `/api/app-settings` line (`server/src/index.js:261`):

```javascript
app.use('/api/app-settings', authMiddleware, resolveOrg, appSettingsRoutes);
app.use('/api/integration-settings', authMiddleware, resolveOrg, integrationSettingsRoutes);
```

Add the org-scoped mount immediately after the existing `orgRouter.use('/app-settings', ...)` line (`server/src/index.js:303`):

```javascript
orgRouter.use('/app-settings',       appSettingsRoutes);
orgRouter.use('/integration-settings', integrationSettingsRoutes);
```

- [ ] **Step 6: Run the full server test suite to check for regressions**

Run: `cd server && npx jest`
Expected: PASS — no new failures

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/integrationSettings.js server/src/tests/integrationSettingsRoutes.test.js server/src/index.js
git commit -m "feat: add GET/PUT /api/integration-settings route"
```

---

### Task 3: `POST /api/integration-settings/:provider/test`

**Files:**
- Modify: `server/src/routes/integrationSettings.js`
- Test: `server/src/tests/integrationSettingsRoutes.test.js` (append)

**Interfaces:**
- Consumes: `resolveWithOverride(key, overrides)` from Task 1.
- Produces: `POST /api/integration-settings/:provider/test` (body `{ overrides: { key: value, ... } }`) → `{ success: true }` or `{ success: false, error: '<message>' }`; `400` for an unknown `:provider`.

- [ ] **Step 1: Append the failing tests**

Append to `server/src/tests/integrationSettingsRoutes.test.js`, after the existing `describe` block, adding a top-level mock for `openai` (it must be declared before any `require` calls, so add it next to the other `jest.mock` calls near the top of the file):

```javascript
// Add near the top of the file, alongside the other jest.mock(...) calls:
jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    models: { list: jest.fn().mockResolvedValue({ data: [] }) },
  }))
);
```

```javascript
// Add as a new describe block at the bottom of the file:
describe('integration settings routes (test-connection)', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/integration-settings', router);

  beforeEach(() => jest.clearAllMocks());

  test('returns 400 for an unknown provider', async () => {
    const res = await request(app).post('/api/integration-settings/unknown/test').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown provider/);
  });

  test('twilio: returns a validation error when credentials are missing', async () => {
    resolveWithOverride.mockResolvedValue(null);

    const res = await request(app).post('/api/integration-settings/twilio/test').send({ overrides: {} });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: 'Account SID and Auth Token are required' });
  });

  test('openai: succeeds when the resolved key works', async () => {
    resolveWithOverride.mockResolvedValue('sk-test');

    const res = await request(app)
      .post('/api/integration-settings/openai/test')
      .send({ overrides: { openai_api_key: 'sk-draft' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
```

Also add `resolveWithOverride` to the imported destructure from `../services/integrationSettings` at the top of the file (it's already in the `jest.mock` factory from Task 2, just add it to the `const { ... } = require(...)` line):

```javascript
const {
  getManagedCredentials,
  updateManagedCredentials,
  resolveWithOverride,
} = require('../services/integrationSettings');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest src/tests/integrationSettingsRoutes.test.js`
Expected: FAIL — `POST /api/integration-settings/unknown/test` returns 404 (route doesn't exist yet)

- [ ] **Step 3: Implement the test-connection endpoint**

Add to `server/src/routes/integrationSettings.js`, replacing the existing `const {...} = require('../services/integrationSettings');` import with:

```javascript
const {
  getManagedCredentials,
  updateManagedCredentials,
  resolveWithOverride,
} = require('../services/integrationSettings');
```

Then add this block after the `PUT /` route and before `module.exports = router;`:

```javascript
const PROVIDER_TESTERS = {
  twilio: async (overrides) => {
    const [accountSid, authToken] = await Promise.all([
      resolveWithOverride('twilio_account_sid', overrides),
      resolveWithOverride('twilio_auth_token', overrides),
    ]);
    if (!accountSid || !authToken) throw new Error('Account SID and Auth Token are required');
    const twilio = require('twilio');
    const client = twilio(accountSid, authToken);
    await client.api.accounts(accountSid).fetch();
  },
  stripe: async (overrides) => {
    const secretKey = await resolveWithOverride('stripe_secret_key', overrides);
    if (!secretKey) throw new Error('Secret Key is required');
    const Stripe = require('stripe');
    const stripe = Stripe(secretKey);
    await stripe.balance.retrieve();
  },
  smtp: async (overrides) => {
    const [host, port, user, pass, secure] = await Promise.all([
      resolveWithOverride('smtp_host', overrides),
      resolveWithOverride('smtp_port', overrides),
      resolveWithOverride('smtp_user', overrides),
      resolveWithOverride('smtp_pass', overrides),
      resolveWithOverride('smtp_secure', overrides),
    ]);
    if (!host || !user || !pass) throw new Error('Host, Username, and Password are required');
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host,
      port: port || 587,
      secure: !!secure,
      auth: { user, pass },
    });
    await transporter.verify();
  },
  hunter: async (overrides) => {
    const apiKey = await resolveWithOverride('hunter_api_key', overrides);
    if (!apiKey) throw new Error('API Key is required');
    const axios = require('axios');
    const res = await axios.get('https://api.hunter.io/v2/account', {
      params: { api_key: apiKey },
      timeout: 10000,
    });
    if (!res.data?.data) throw new Error('Unexpected response from Hunter.io');
  },
  openai: async (overrides) => {
    const apiKey = await resolveWithOverride('openai_api_key', overrides);
    if (!apiKey) throw new Error('API Key is required');
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey });
    await openai.models.list();
  },
};

/**
 * POST /api/integration-settings/:provider/test
 * Admin: run a live check against the given provider using the current form
 * values (overrides) or, for any field not overridden, the saved/env value.
 */
router.post('/:provider/test', async (req, res) => {
  const { provider } = req.params;
  const tester = PROVIDER_TESTERS[provider];
  if (!tester) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  const overrides = req.body?.overrides && typeof req.body.overrides === 'object' ? req.body.overrides : {};

  try {
    await tester(overrides);
    res.json({ success: true });
  } catch (err) {
    const message =
      err.response?.data?.errors?.[0]?.details ||
      err.response?.data?.error?.message ||
      err.message ||
      'Connection test failed';
    res.json({ success: false, error: message });
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest src/tests/integrationSettingsRoutes.test.js`
Expected: PASS — 7 tests total

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/integrationSettings.js server/src/tests/integrationSettingsRoutes.test.js
git commit -m "feat: add integration test-connection endpoint"
```

---

### Task 4: Lazy Twilio client

**Files:**
- Modify: `server/src/services/twilioService.js`
- Modify: `server/src/services/webhookReceiver.js`
- Modify: `server/src/routes/webhooks.js`
- Test: `server/src/tests/twilioService.test.js`

**Interfaces:**
- Consumes: `getSetting(key)` from `server/src/services/integrationSettings.js`.
- Produces: `TwilioService.isConfigured()` and `TwilioService.verifyWebhookSignature(...)` are now `async` (were sync) — both existing external callers (`webhookReceiver.js`) are updated in this task.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/tests/twilioService.test.js
jest.mock('../services/integrationSettings', () => ({
  getSetting: jest.fn(),
}));

jest.mock('twilio', () => {
  const twilioFn = jest.fn(() => ({
    messages: { create: jest.fn().mockResolvedValue({ sid: 'SM123', status: 'queued' }) },
  }));
  twilioFn.webhook = { validateRequest: jest.fn().mockReturnValue(true) };
  return twilioFn;
});

const { getSetting } = require('../services/integrationSettings');
const twilio = require('twilio');
const TwilioService = require('../services/twilioService');

describe('TwilioService lazy client', () => {
  beforeEach(() => jest.clearAllMocks());

  test('isConfigured is false when credentials are not resolved', async () => {
    getSetting.mockResolvedValue(null);

    await expect(TwilioService.isConfigured()).resolves.toBe(false);
  });

  test('isConfigured is true and builds the client from resolved DB/env credentials', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'twilio_account_sid') return Promise.resolve('AC123');
      if (key === 'twilio_auth_token') return Promise.resolve('token123');
      return Promise.resolve(null);
    });

    await expect(TwilioService.isConfigured()).resolves.toBe(true);
    expect(twilio).toHaveBeenCalledWith('AC123', 'token123');
  });

  test('sendSMS returns "not configured" without calling the Twilio API', async () => {
    getSetting.mockResolvedValue(null);

    const result = await TwilioService.sendSMS({ to: '+15550001111', content: 'hi' });

    expect(result).toEqual({ success: false, error: 'Twilio not configured' });
  });

  test('sendSMS uses the resolved phone number as the "from" field', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'twilio_account_sid') return Promise.resolve('AC123');
      if (key === 'twilio_auth_token') return Promise.resolve('token123');
      if (key === 'twilio_phone_number') return Promise.resolve('+15559998888');
      return Promise.resolve(null);
    });

    const result = await TwilioService.sendSMS({ to: '+15550001111', content: 'hi' });

    expect(result.success).toBe(true);
    const clientInstance = twilio.mock.results[0].value;
    expect(clientInstance.messages.create).toHaveBeenCalledWith({
      body: 'hi',
      from: '+15559998888',
      to: '+15550001111',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/tests/twilioService.test.js`
Expected: FAIL — `isConfigured` is still synchronous / `twilio` mock not called with resolved credentials

- [ ] **Step 3: Refactor `twilioService.js` to a lazy client**

Replace lines 1–26 (the module-level client setup) with:

```javascript
/**
 * Twilio Service Wrapper
 * Handles SMS sending, webhook verification, phone validation, and STOP keyword handling
 */

const twilio = require('twilio');
const libphonenumber = require('libphonenumber-js');
const SMS = require('../models/SMS');
const pool = require('../models/db');
const integrationSettings = require('./integrationSettings');

async function buildTwilioClient() {
  const [accountSid, authToken] = await Promise.all([
    integrationSettings.getSetting('twilio_account_sid'),
    integrationSettings.getSetting('twilio_auth_token'),
  ]);
  if (!accountSid || !authToken) return null;
  try {
    return twilio(accountSid, authToken);
  } catch (error) {
    console.warn('⚠️  Twilio not configured - SMS features will be unavailable');
    return null;
  }
}

async function getTwilioPhoneNumber() {
  return (await integrationSettings.getSetting('twilio_phone_number')) || '+1-555-RESIQ-1';
}

const RATE_LIMIT_PER_HOUR = parseInt(process.env.SMS_RATE_LIMIT_PER_HOUR || '10', 10);
```

Replace the `isConfigured`, `sendSMS`, `verifyWebhookSignature`, and `getMessageStatus` methods with:

```javascript
  static async isConfigured() {
    return (await buildTwilioClient()) !== null;
  }
```

```javascript
  static async sendSMS(options) {
    const { to, content, messageId } = options;

    const client = await buildTwilioClient();
    if (!client) {
      return {
        success: false,
        error: 'Twilio not configured'
      };
    }

    if (!to || !content) {
      throw new Error('Missing required fields: to, content');
    }

    if (content.length > 160) {
      console.warn(`⚠️  SMS content exceeds 160 characters (${content.length}). Will be split into multiple messages.`);
    }

    try {
      const fromNumber = await getTwilioPhoneNumber();
      const message = await client.messages.create({
        body: content,
        from: fromNumber,
        to
      });

      if (messageId) {
        await SMS.updateTwilioSid(messageId, message.sid);
      }

      return {
        success: true,
        twilio_message_sid: message.sid,
        status: message.status
      };
    } catch (error) {
      console.error('❌ Twilio SMS send error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
```

```javascript
  static async verifyWebhookSignature(twilioSignature, requestUrl, data) {
    const authToken = await integrationSettings.getSetting('twilio_auth_token');
    if (!authToken) {
      console.warn('⚠️  Cannot verify Twilio webhook - Twilio not configured');
      return false;
    }

    try {
      return twilio.webhook.validateRequest(authToken, twilioSignature, requestUrl, data);
    } catch (error) {
      console.error('❌ Webhook signature verification error:', error.message);
      return false;
    }
  }
```

```javascript
  static async getMessageStatus(messageSid) {
    const client = await buildTwilioClient();
    if (!client) {
      return null;
    }

    try {
      const message = await client.messages(messageSid).fetch();
      return message;
    } catch (error) {
      console.error('❌ Error fetching message status:', error.message);
      return null;
    }
  }
```

Leave every other method (`validatePhoneNumber`, `handleInboundSMS`, `handleDeliveryStatus`, `isSTOPKeyword`, `handleSTOPKeyword`, `checkRateLimit`, `isOptedOut`) unchanged.

- [ ] **Step 4: Update `webhookReceiver.js` to await the now-async Twilio checks**

In `server/src/services/webhookReceiver.js`, change `validateSignature` from `static validateSignature(req) {` to `static async validateSignature(req) {`, and update its body:

```javascript
  static async validateSignature(req) {
    const twilioSignature = req.get('X-Twilio-Signature');
    const requestUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const data = req.body;

    if (!twilioSignature) {
      console.warn('⚠️  Missing Twilio signature header');
      if (!(await TwilioService.isConfigured())) {
        console.warn('⚠️  Skipping signature verification - Twilio not configured');
        return true;
      }
      return false;
    }

    return TwilioService.verifyWebhookSignature(twilioSignature, requestUrl, data);
  }
```

Update `getHealthStatus`:

```javascript
  static async getHealthStatus() {
    return {
      twilioConfigured: await TwilioService.isConfigured(),
      timestamp: new Date().toISOString()
    };
  }
```

- [ ] **Step 5: Update `server/src/routes/webhooks.js` to await `validateSignature`**

Change line 23:

```javascript
    const isValid = WebhookReceiverService.validateSignature(req);
```

to:

```javascript
    const isValid = await WebhookReceiverService.validateSignature(req);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && npx jest src/tests/twilioService.test.js`
Expected: PASS — 4 tests

Run: `cd server && npx jest`
Expected: PASS — no regressions elsewhere

- [ ] **Step 7: Commit**

```bash
git add server/src/services/twilioService.js server/src/services/webhookReceiver.js server/src/routes/webhooks.js server/src/tests/twilioService.test.js
git commit -m "refactor: resolve Twilio credentials lazily from integration_credentials"
```

---

### Task 5: Lazy Stripe client

**Files:**
- Create: `server/src/services/stripeClient.js`
- Modify: `server/src/routes/stripe.js`
- Modify: `server/src/services/stripeWebhooks.js`
- Test: `server/src/tests/stripeClient.test.js`

**Interfaces:**
- Consumes: `getSetting(key)` from `server/src/services/integrationSettings.js`.
- Produces: `async getStripeClient(): Promise<StripeClient|null>`, `async getStripeWebhookSecret(): Promise<string|null>`.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/tests/stripeClient.test.js
jest.mock('../services/integrationSettings', () => ({
  getSetting: jest.fn(),
}));

jest.mock('stripe', () => jest.fn((key) => ({ __secretKey: key })));

const { getSetting } = require('../services/integrationSettings');
const Stripe = require('stripe');
const { getStripeClient, getStripeWebhookSecret } = require('../services/stripeClient');

describe('stripeClient', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getStripeClient returns null when no secret key is resolved', async () => {
    getSetting.mockResolvedValue(null);

    await expect(getStripeClient()).resolves.toBeNull();
    expect(Stripe).not.toHaveBeenCalled();
  });

  test('getStripeClient builds a client from the resolved secret key', async () => {
    getSetting.mockResolvedValue('sk_test_123');

    const client = await getStripeClient();

    expect(Stripe).toHaveBeenCalledWith('sk_test_123');
    expect(client).toEqual({ __secretKey: 'sk_test_123' });
  });

  test('getStripeWebhookSecret resolves via integrationSettings', async () => {
    getSetting.mockResolvedValue('whsec_abc');

    await expect(getStripeWebhookSecret()).resolves.toBe('whsec_abc');
    expect(getSetting).toHaveBeenCalledWith('stripe_webhook_secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/tests/stripeClient.test.js`
Expected: FAIL — `Cannot find module '../services/stripeClient'`

- [ ] **Step 3: Implement `stripeClient.js`**

```javascript
// server/src/services/stripeClient.js
const integrationSettings = require('./integrationSettings');

async function getStripeClient() {
  const secretKey = await integrationSettings.getSetting('stripe_secret_key');
  if (!secretKey) return null;
  const Stripe = require('stripe');
  return Stripe(secretKey);
}

async function getStripeWebhookSecret() {
  return integrationSettings.getSetting('stripe_webhook_secret');
}

module.exports = { getStripeClient, getStripeWebhookSecret };
```

- [ ] **Step 4: Update `server/src/routes/stripe.js`**

Replace the top of the file (lines 1–30) with:

```javascript
const express = require('express');
const { handlePaymentIntentSucceeded, handlePaymentIntentFailed, generateStripePaymentLink } = require('../services/stripeWebhooks');
const { getStripeClient, getStripeWebhookSecret } = require('../services/stripeClient');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/stripe/webhook
 * Webhook handler for Stripe events
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = await getStripeClient();
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = await getStripeWebhookSecret();

  if (!sig || !webhookSecret) {
    return res.status(400).json({ error: 'Missing webhook signature or secret' });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      webhookSecret
    );
```

Leave the rest of the file (the `switch (event.type)` block through `module.exports = router;`) unchanged.

- [ ] **Step 5: Update `server/src/services/stripeWebhooks.js`**

Replace line 5 (`const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;`) with:

```javascript
const { getStripeClient } = require('./stripeClient');
```

Replace the start of `generateStripePaymentLink` (lines 95–98):

```javascript
async function generateStripePaymentLink(invoiceId, invoiceNumber, amount, description) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }
```

with:

```javascript
async function generateStripePaymentLink(invoiceId, invoiceNumber, amount, description) {
  const stripe = await getStripeClient();
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }
```

The rest of the function (which already references the local `stripe` variable via `stripe.paymentLinks.create(...)`) is unchanged.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && npx jest src/tests/stripeClient.test.js`
Expected: PASS — 3 tests

Run: `cd server && npx jest`
Expected: PASS — no regressions

- [ ] **Step 7: Commit**

```bash
git add server/src/services/stripeClient.js server/src/routes/stripe.js server/src/services/stripeWebhooks.js server/src/tests/stripeClient.test.js
git commit -m "refactor: resolve Stripe credentials lazily from integration_credentials"
```

---

### Task 6: Lazy SMTP transporter

**Files:**
- Modify: `server/src/services/clientNotifications.js`
- Test: `server/src/tests/clientNotifications.transporter.test.js`

**Interfaces:**
- Consumes: `getSetting(key)` from `server/src/services/integrationSettings.js`.
- Produces: `async getMailTransporter(): Promise<Transporter>` (newly exported).

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/tests/clientNotifications.transporter.test.js
jest.mock('../services/integrationSettings', () => ({
  getSetting: jest.fn(),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn() }),
}));

const { getSetting } = require('../services/integrationSettings');
const nodemailer = require('nodemailer');
const { getMailTransporter } = require('../services/clientNotifications');

describe('getMailTransporter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
  });

  test('builds an SMTP transporter from resolved DB/env credentials', async () => {
    getSetting.mockImplementation((key) => {
      const values = {
        smtp_host: 'smtp.example.com',
        smtp_user: 'user@example.com',
        smtp_pass: 'secret',
        smtp_port: 465,
        smtp_secure: true,
      };
      return Promise.resolve(values[key] ?? null);
    });

    await getMailTransporter();

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'user@example.com', pass: 'secret' },
    });
  });

  test('falls back to Gmail when SMTP is not configured', async () => {
    getSetting.mockResolvedValue(null);
    process.env.GMAIL_USER = 'gmail-user@example.com';
    process.env.GMAIL_APP_PASSWORD = 'app-password';

    await getMailTransporter();

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      service: 'gmail',
      auth: { user: 'gmail-user@example.com', pass: 'app-password' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/tests/clientNotifications.transporter.test.js`
Expected: FAIL — `getMailTransporter is not a function`

- [ ] **Step 3: Implement the lazy transporter**

Replace lines 1–30 of `server/src/services/clientNotifications.js`:

```javascript
const nodemailer = require('nodemailer')
const pool = require('../models/db')
const trackingService = require('./trackingService')
const integrationSettings = require('./integrationSettings')

/**
 * Build a fresh email transporter, resolving SMTP credentials from the DB
 * (falls back to env vars), or Gmail app-password auth as a last resort.
 */
async function getMailTransporter() {
  const [host, user, pass, port, secure] = await Promise.all([
    integrationSettings.getSetting('smtp_host'),
    integrationSettings.getSetting('smtp_user'),
    integrationSettings.getSetting('smtp_pass'),
    integrationSettings.getSetting('smtp_port'),
    integrationSettings.getSetting('smtp_secure'),
  ])

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port: port || 587,
      secure: !!secure,
      auth: { user, pass },
    })
  }

  // Fallback to Gmail (requires app password)
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}
```

Delete the old module-level `const transporter = getTransporter()` line (was line 32).

Replace every occurrence of `await transporter.sendMail({` (7 occurrences) with `await (await getMailTransporter()).sendMail({`:

```bash
cd server && sed -i '' 's/await transporter\.sendMail({/await (await getMailTransporter()).sendMail({/g' src/services/clientNotifications.js
```

Add `getMailTransporter` to the `module.exports` block at the bottom of the file:

```javascript
module.exports = {
  sendClientInvitationEmail,
  sendProposalSentEmail,
  sendInvoiceSentEmail,
  sendProposalSignedConfirmation,
  sendInvoicePaidConfirmation,
  sendTicketAssignedNotification,
  sendTicketReplyNotification,
  getMailTransporter,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest src/tests/clientNotifications.transporter.test.js`
Expected: PASS — 2 tests

Run: `cd server && npx jest`
Expected: PASS — no regressions (confirms all 7 `sendMail` call sites still compile and existing tests that touch `clientNotifications.js`, if any, still pass)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/clientNotifications.js server/src/tests/clientNotifications.transporter.test.js
git commit -m "refactor: resolve SMTP credentials lazily from integration_credentials"
```

---

### Task 7: Shared lazy OpenAI client

**Files:**
- Create: `server/src/services/openaiClient.js`
- Modify: `server/src/services/agentService.js`
- Modify: `server/src/routes/agents.js`
- Modify: `server/src/routes/proposals.js`
- Modify: `server/src/routes/tickets.js`
- Test: `server/src/tests/openaiClient.test.js`

**Interfaces:**
- Consumes: `getSetting(key)` from `server/src/services/integrationSettings.js`.
- Produces: `async getOpenAiClient(): Promise<OpenAIClient|null>`, `async isOpenAiConfigured(): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/tests/openaiClient.test.js
jest.mock('../services/integrationSettings', () => ({
  getSetting: jest.fn(),
}));

jest.mock('openai', () => jest.fn((opts) => ({ __apiKey: opts.apiKey })));

const { getSetting } = require('../services/integrationSettings');
const OpenAI = require('openai');
const { getOpenAiClient, isOpenAiConfigured } = require('../services/openaiClient');

describe('openaiClient', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getOpenAiClient returns null when no key is resolved', async () => {
    getSetting.mockResolvedValue(null);

    await expect(getOpenAiClient()).resolves.toBeNull();
    expect(OpenAI).not.toHaveBeenCalled();
  });

  test('getOpenAiClient builds a client from the resolved key', async () => {
    getSetting.mockResolvedValue('sk-test');

    const client = await getOpenAiClient();

    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
    expect(client).toEqual({ __apiKey: 'sk-test' });
  });

  test('isOpenAiConfigured reflects whether a client could be built', async () => {
    getSetting.mockResolvedValueOnce(null);
    await expect(isOpenAiConfigured()).resolves.toBe(false);

    getSetting.mockResolvedValueOnce('sk-test');
    await expect(isOpenAiConfigured()).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest src/tests/openaiClient.test.js`
Expected: FAIL — `Cannot find module '../services/openaiClient'`

- [ ] **Step 3: Implement `openaiClient.js`**

```javascript
// server/src/services/openaiClient.js
const integrationSettings = require('./integrationSettings');

async function getOpenAiClient() {
  const apiKey = await integrationSettings.getSetting('openai_api_key');
  if (!apiKey) return null;
  const OpenAI = require('openai');
  return new OpenAI({ apiKey });
}

async function isOpenAiConfigured() {
  return (await getOpenAiClient()) !== null;
}

module.exports = { getOpenAiClient, isOpenAiConfigured };
```

- [ ] **Step 4: Update `server/src/services/agentService.js`**

Replace lines 1–12:

```javascript
const { getOpenAiClient } = require('./openaiClient');
```

Replace the start of `generateProspects` (was line 16, `const openai = getOpenAIClient();`):

```javascript
async function generateProspects(prompt) {
  try {
    const openai = await getOpenAiClient();
    if (!openai) {
      throw new Error('OPENAI_API_KEY is not set. AI prospecting is unavailable.');
    }
```

The rest of the function is unchanged.

- [ ] **Step 5: Update `server/src/routes/agents.js`**

Replace lines 1–16 (imports + `isOpenAIConfigured`/`aiConfigMissingResponse`):

```javascript
const express = require('express');
const auth = require('../middleware/auth');
const { generateProspects } = require('../services/agentService');
const { importProspects } = require('../services/agentProspectService');
const { getOpenAiClient, isOpenAiConfigured } = require('../services/openaiClient');

const router = express.Router();

function aiConfigMissingResponse(res) {
  return res.status(503).json({
    error: 'AI is not configured. Set OPENAI_API_KEY on the server to enable this endpoint.'
  });
}
```

Replace all three `if (!isOpenAIConfigured()) {` checks (lines 25, 70, 111) with:

```javascript
  if (!(await isOpenAiConfigured())) {
```

Replace both client-construction blocks (lines 75–76 and 116–117):

```javascript
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

with:

```javascript
    const openai = await getOpenAiClient();
```

- [ ] **Step 6: Update `server/src/routes/proposals.js`**

Replace line 5 (`const OpenAI = require('openai');`) with:

```javascript
const { getOpenAiClient, isOpenAiConfigured } = require('../services/openaiClient');
```

Replace lines 46–48:

```javascript
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return res.status(503).json({ error: 'AI is not configured. Set OPENAI_API_KEY on the server to enable this feature.' });
    }
```

with:

```javascript
    if (!(await isOpenAiConfigured())) {
      return res.status(503).json({ error: 'AI is not configured. Set OPENAI_API_KEY on the server to enable this feature.' });
    }
```

Replace line 67 (`const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });`) with:

```javascript
      const openai = await getOpenAiClient();
```

- [ ] **Step 7: Update `server/src/routes/tickets.js`**

Add the import near the top of the file (after the existing `require('../services/clientNotifications')` line):

```javascript
const { getOpenAiClient } = require('../services/openaiClient');
```

Replace lines 492–496:

```javascript
    // Call OpenAI
    const OpenAI = require('openai');
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
```

with:

```javascript
    // Call OpenAI
    const openai = await getOpenAiClient();
    if (!openai) {
      return res.status(503).json({ error: 'AI is not configured. Set OPENAI_API_KEY on the server to enable this feature.' });
    }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd server && npx jest src/tests/openaiClient.test.js`
Expected: PASS — 3 tests

Run: `cd server && npx jest`
Expected: PASS — including `src/tests/agentsRoutes.test.js` (it sets `process.env.OPENAI_API_KEY = 'test-key'` in `beforeEach`, which `isOpenAiConfigured`/`getOpenAiClient` still pick up via the `.env`-fallback path in `integrationSettings.getSetting`, since no `integration_credentials` row exists in that test's mocked DB — confirm this test still passes unmodified)

- [ ] **Step 9: Commit**

```bash
git add server/src/services/openaiClient.js server/src/services/agentService.js server/src/routes/agents.js server/src/routes/proposals.js server/src/routes/tickets.js server/src/tests/openaiClient.test.js
git commit -m "refactor: resolve OpenAI credentials lazily from integration_credentials"
```

---

### Task 8: Hunter.io + OpenAI in `enrichmentWorker.js`

**Files:**
- Modify: `server/src/workers/enrichmentWorker.js`

**Interfaces:**
- Consumes: `getSetting(key)` from `server/src/services/integrationSettings.js`, `getOpenAiClient()` from Task 7's `server/src/services/openaiClient.js`.

- [ ] **Step 1: Add the imports**

Add near the top of `server/src/workers/enrichmentWorker.js` (after the existing `require('../services/auditLogger')` line):

```javascript
const integrationSettings = require('../services/integrationSettings');
const { getOpenAiClient } = require('../services/openaiClient');
```

- [ ] **Step 2: Resolve the Hunter.io key from `integrationSettings` in all three helper functions**

In `hunterVerifyEmail`, replace:

```javascript
async function hunterVerifyEmail(email) {
  const apiKey = process.env.HUNTER_API_KEY;
```

with:

```javascript
async function hunterVerifyEmail(email) {
  const apiKey = await integrationSettings.getSetting('hunter_api_key');
```

In `hunterFindPerson`, replace:

```javascript
async function hunterFindPerson(domain, firstName, lastName) {
  const apiKey = process.env.HUNTER_API_KEY;
```

with:

```javascript
async function hunterFindPerson(domain, firstName, lastName) {
  const apiKey = await integrationSettings.getSetting('hunter_api_key');
```

In `hunterDomainSearch`, replace:

```javascript
async function hunterDomainSearch(domain) {
  const apiKey = process.env.HUNTER_API_KEY;
```

with:

```javascript
async function hunterDomainSearch(domain) {
  const apiKey = await integrationSettings.getSetting('hunter_api_key');
```

(All three functions are already `async` and already awaited by their callers — no other changes needed in those functions.)

- [ ] **Step 3: Resolve the OpenAI client lazily**

Replace (originally line 184):

```javascript
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

with:

```javascript
    const openai = await getOpenAiClient();
```

The top-of-file `const OpenAI = require('openai');` (line 3) is no longer used directly in this file and can be removed — confirm with a search first:

```bash
grep -n "OpenAI" server/src/workers/enrichmentWorker.js
```

Expected: only the `getOpenAiClient` import and the `const openai = await getOpenAiClient();` line remain — delete the now-unused `const OpenAI = require('openai');` line.

- [ ] **Step 4: Manual verification (no queue-processing test harness exists for this worker; do not add one in this task — out of scope)**

Run: `cd server && node -e "require('./src/workers/enrichmentWorker.js'); console.log('enrichmentWorker loads cleanly')"`
Expected: prints `enrichmentWorker loads cleanly` with no thrown errors (confirms the module's requires/syntax are valid — this worker's queue-processing logic has no existing test harness to extend, and building one is out of scope for this plan).

Run: `cd server && npx jest`
Expected: PASS — no regressions in any other suite

- [ ] **Step 5: Commit**

```bash
git add server/src/workers/enrichmentWorker.js
git commit -m "refactor: resolve Hunter.io and OpenAI credentials lazily in enrichment worker"
```

---

### Task 9: `IntegrationCredentials.jsx` UI

**Files:**
- Create: `client/src/components/IntegrationCredentials.jsx`
- Modify: `client/src/pages/Settings.jsx`

**Interfaces:**
- Consumes: `GET /api/integration-settings`, `PUT /api/integration-settings`, `POST /api/integration-settings/:provider/test` from Task 2/3. `useAuth()` from `client/src/context/AuthContext`.
- Produces: default-exported `IntegrationCredentials` component, rendered inside the existing "Integrations" tab of `Settings.jsx`.

- [ ] **Step 1: Implement `IntegrationCredentials.jsx`**

```jsx
import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const PROVIDERS = [
  {
    key: 'twilio',
    label: 'Twilio (SMS)',
    fields: [
      { key: 'twilio_account_sid', label: 'Account SID' },
      { key: 'twilio_auth_token', label: 'Auth Token' },
      { key: 'twilio_phone_number', label: 'Phone Number' },
    ],
  },
  {
    key: 'stripe',
    label: 'Stripe (Payments)',
    fields: [
      { key: 'stripe_secret_key', label: 'Secret Key' },
      { key: 'stripe_webhook_secret', label: 'Webhook Secret' },
    ],
  },
  {
    key: 'smtp',
    label: 'SMTP (Email)',
    fields: [
      { key: 'smtp_host', label: 'Host' },
      { key: 'smtp_port', label: 'Port' },
      { key: 'smtp_user', label: 'Username' },
      { key: 'smtp_pass', label: 'Password' },
      { key: 'smtp_from', label: 'From Address' },
      { key: 'smtp_secure', label: 'Use TLS', type: 'boolean' },
    ],
  },
  {
    key: 'hunter',
    label: 'Hunter.io (Enrichment)',
    fields: [{ key: 'hunter_api_key', label: 'API Key' }],
  },
  {
    key: 'openai',
    label: 'OpenAI (AI Features)',
    fields: [{ key: 'openai_api_key', label: 'API Key' }],
  },
]

export default function IntegrationCredentials() {
  const { token } = useAuth()
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  const [settingsByKey, setSettingsByKey] = useState({})
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingProvider, setSavingProvider] = useState(null)
  const [testingProvider, setTestingProvider] = useState(null)
  const [messages, setMessages] = useState({})

  useEffect(() => { loadSettings() }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/integration-settings', authHeaders)
      const map = {}
      ;(res.data?.settings || []).forEach((item) => { map[item.key] = item })
      setSettingsByKey(map)
    } catch (err) {
      console.error('Failed to load integration settings', err)
    } finally {
      setLoading(false)
    }
  }

  const textFieldValue = (field) => {
    if (drafts[field.key] !== undefined) return drafts[field.key]
    const item = settingsByKey[field.key]
    if (!item || item.secret) return ''
    return item.value ?? ''
  }

  const booleanFieldValue = (field) => {
    if (drafts[field.key] !== undefined) return !!drafts[field.key]
    return !!settingsByKey[field.key]?.value
  }

  const fieldPlaceholder = (field) => {
    const item = settingsByKey[field.key]
    if (item?.secret) return item.configured ? item.maskedValue : 'Not set'
    return ''
  }

  const handleFieldChange = (fieldKey, value) => {
    setDrafts((prev) => ({ ...prev, [fieldKey]: value }))
  }

  const draftPayload = (provider) => {
    const payload = {}
    provider.fields.forEach((field) => {
      if (drafts[field.key] !== undefined && drafts[field.key] !== '') {
        payload[field.key] = drafts[field.key]
      }
    })
    return payload
  }

  const handleSave = async (provider) => {
    setMessages((prev) => ({ ...prev, [provider.key]: null }))
    setSavingProvider(provider.key)
    try {
      await axios.put('/api/integration-settings', { settings: draftPayload(provider) }, authHeaders)
      setMessages((prev) => ({ ...prev, [provider.key]: { type: 'success', text: 'Saved.' } }))
      setDrafts((prev) => {
        const next = { ...prev }
        provider.fields.forEach((field) => delete next[field.key])
        return next
      })
      await loadSettings()
    } catch (err) {
      setMessages((prev) => ({
        ...prev,
        [provider.key]: { type: 'error', text: err.response?.data?.error || 'Failed to save.' },
      }))
    } finally {
      setSavingProvider(null)
    }
  }

  const handleTest = async (provider) => {
    setMessages((prev) => ({ ...prev, [provider.key]: null }))
    setTestingProvider(provider.key)
    try {
      const res = await axios.post(
        `/api/integration-settings/${provider.key}/test`,
        { overrides: draftPayload(provider) },
        authHeaders
      )
      setMessages((prev) => ({
        ...prev,
        [provider.key]: res.data.success
          ? { type: 'success', text: 'Connection successful.' }
          : { type: 'error', text: res.data.error || 'Connection failed.' },
      }))
    } catch (err) {
      setMessages((prev) => ({
        ...prev,
        [provider.key]: { type: 'error', text: err.response?.data?.error || 'Connection test failed.' },
      }))
    } finally {
      setTestingProvider(null)
    }
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal'
  const btnCls = 'px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors'
  const secondaryBtnCls = 'px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors'

  const isConfigured = (provider) => provider.fields.every((field) => settingsByKey[field.key]?.configured)

  if (loading) return <p className="text-sm text-gray-500">Loading integration settings...</p>

  return (
    <div className="space-y-6">
      {PROVIDERS.map((provider) => (
        <div key={provider.key} className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-navy">{provider.label}</h3>
            <span
              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                isConfigured(provider) ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {isConfigured(provider) ? 'Configured' : 'Not configured'}
            </span>
          </div>

          {messages[provider.key] && (
            <p className={`text-sm mb-3 ${messages[provider.key].type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {messages[provider.key].text}
            </p>
          )}

          <div className="space-y-3">
            {provider.fields.map((field) =>
              field.type === 'boolean' ? (
                <label key={field.key} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={booleanFieldValue(field)}
                    onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  {field.label}
                </label>
              ) : (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>
                  <input
                    type={settingsByKey[field.key]?.secret ? 'password' : 'text'}
                    value={textFieldValue(field)}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    placeholder={fieldPlaceholder(field)}
                    className={inputCls}
                  />
                </div>
              )
            )}
          </div>

          <div className="flex gap-3 mt-4">
            <button onClick={() => handleSave(provider)} disabled={savingProvider === provider.key} className={btnCls}>
              {savingProvider === provider.key ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => handleTest(provider)} disabled={testingProvider === provider.key} className={secondaryBtnCls}>
              {testingProvider === provider.key ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `Settings.jsx`**

Add the import near the other component imports (`client/src/pages/Settings.jsx:4`):

```javascript
import GmailConnect from '../components/GmailConnect'
import IntegrationCredentials from '../components/IntegrationCredentials'
```

Replace the "integrations" tab body (`client/src/pages/Settings.jsx:292`):

```jsx
        {activeTab === 'integrations' && <GmailConnect />}
```

with:

```jsx
        {activeTab === 'integrations' && (
          <div className="space-y-8">
            <GmailConnect />
            <div>
              <h3 className="font-syne text-lg font-semibold text-navy mb-4">API Keys &amp; Integrations</h3>
              <IntegrationCredentials />
            </div>
          </div>
        )}
```

- [ ] **Step 3: Manual verification in the browser**

Run: `npm run dev` (from repo root, per `CLAUDE.md`)
Then:
1. Log in as an admin user, go to Settings → Integrations.
2. Confirm 5 provider cards render (Twilio, Stripe, SMTP, Hunter.io, OpenAI), each showing "Not configured" (assuming no `.env` values are set locally) or "Configured" (if `.env` values are set — they should surface via the fallback).
3. Type a value into a non-secret field (e.g. Twilio Phone Number), click "Save" — confirm the "Saved." message appears and the field's badge updates on reload.
4. Type an invalid value into a secret field (e.g. OpenAI API Key = `sk-invalid`), click "Test Connection" — confirm a red error banner appears with the real OpenAI error message (e.g. "Incorrect API key provided").
5. Confirm a non-admin user does not see fields populate (the route returns 403) — check the browser network tab for `GET /api/integration-settings`.

Expected: all 5 checks pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/IntegrationCredentials.jsx client/src/pages/Settings.jsx
git commit -m "feat: add integration credentials UI to Settings"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), credential definitions/masking (Task 1), API GET/PUT (Task 2), test-connection (Task 3), runtime refactor for all 5 providers (Tasks 4–8), UI (Task 9), security (masking in Task 1/2, admin gate in Task 2, audit log in Task 2, encryption via existing `TokenManager` in Task 1) — all spec sections have a corresponding task.
- **Placeholder scan:** no TBD/TODO; Task 8 Step 4 explicitly documents *why* no automated test is added (no existing queue-processing harness) rather than silently skipping it — that is a scoping decision, not a placeholder.
- **Type consistency:** `getSetting`, `getManagedCredentials`, `updateManagedCredentials`, `resolveWithOverride` (Task 1) are called with identical names/signatures in Tasks 2–8. `getOpenAiClient`/`isOpenAiConfigured` (Task 7) are used with identical names in Task 8. `getStripeClient`/`getStripeWebhookSecret` (Task 5) match their only call sites (Task 5 itself). `getMailTransporter` (Task 6) matches its export and its 7 call-site replacements.
