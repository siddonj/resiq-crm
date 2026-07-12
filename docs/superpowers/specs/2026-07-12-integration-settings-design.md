# Integration Settings in Settings UI

**Date:** 2026-07-12
**Branch:** feat/multi-tenancy
**Status:** Approved

## Problem

Integration credentials (Twilio, Stripe, SMTP, Hunter.io, OpenAI) are only configurable via `.env`, requiring a server restart and shell/file access to change. Admins have no way to view current configuration state, edit it, or verify a credential actually works without digging through logs after something fails downstream (e.g. an SMS silently not sending because `TWILIO_AUTH_TOKEN` is stale).

## Goals

- Move Twilio, Stripe, SMTP, Hunter.io, and OpenAI credentials into the Settings screen, editable by admins.
- Each provider gets a "Test Connection" button that makes a real API call and surfaces the provider's actual error message.
- DB-stored value wins when present; `.env` remains the fallback default so existing deployments keep working with zero migration effort.
- Changing a credential in the UI takes effect immediately — no server restart.

## Non-Goals

- Per-organization credentials. This is a single global credential set for the whole install (admin-only), consistent with how `.env` config works today. Explicitly deferred: if/when different tenants need different Twilio/Stripe accounts, that's a separate migration.
- Gmail / Google Calendar OAuth client ID & secret — these stay in `.env`. OAuth app registration is a different lifecycle than a rotatable API key and isn't in scope here.
- `JWT_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, `REDIS_URL` — infrastructure secrets, never exposed in any UI.
- Caching of resolved credentials. Each use does one extra DB read; all call sites are already network-bound (SMS send, payment call, email send, AI call), so this is negligible. Add caching later only if profiling shows it matters.

## Data Model

New migration, `integration_credentials` table — mirrors the existing `app_settings` table shape (see `database/migrations/023-app-settings.sql`) but supports encrypted values:

```sql
CREATE TABLE IF NOT EXISTS integration_credentials (
  credential_key   TEXT PRIMARY KEY,
  credential_value TEXT NOT NULL,   -- encrypted (AES-256-GCM) for secret fields, plain text for non-secret fields
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_updated_at ON integration_credentials(updated_at DESC);
```

Encryption reuses the existing `TokenManager` (`server/src/services/oauth.js`) AES-256-GCM implementation already used for OAuth token storage — no new crypto code.

## Credential Definitions

New service `server/src/services/integrationSettings.js`, following the same `SETTING_DEFINITIONS` map pattern as `server/src/services/appSettings.js`:

| Provider | Key | Type | Secret | Env fallback |
|---|---|---|---|---|
| Twilio | `twilio_account_sid` | string | no | `TWILIO_ACCOUNT_SID` |
| Twilio | `twilio_auth_token` | string | **yes** | `TWILIO_AUTH_TOKEN` |
| Twilio | `twilio_phone_number` | string | no | `TWILIO_PHONE_NUMBER` |
| Stripe | `stripe_secret_key` | string | **yes** | `STRIPE_SECRET_KEY` |
| Stripe | `stripe_webhook_secret` | string | **yes** | `STRIPE_WEBHOOK_SECRET` |
| SMTP | `smtp_host` | string | no | `SMTP_HOST` |
| SMTP | `smtp_port` | integer | no | `SMTP_PORT` |
| SMTP | `smtp_user` | string | no | `SMTP_USER` |
| SMTP | `smtp_pass` | string | **yes** | `SMTP_PASS` |
| SMTP | `smtp_from` | string | no | `SMTP_FROM` |
| SMTP | `smtp_secure` | boolean | no | `SMTP_SECURE` |
| Hunter.io | `hunter_api_key` | string | **yes** | `HUNTER_API_KEY` |
| OpenAI | `openai_api_key` | string | **yes** | `OPENAI_API_KEY` |

Resolution order for every field: `integration_credentials` row (decrypted) → `process.env[envName]` → `undefined`.

### Secret masking

- `GET` never returns a decrypted secret. Response shape per field: `{ key, type, secret, label, configured: boolean, maskedValue: string|null, value: <plain value, only when secret === false> }`. `maskedValue` is `••••` + last 4 characters of the resolved value (DB or env), or `null` if unconfigured.
- `PUT` — a secret field is only updated if the request includes a **new** value for that key. The client omits any secret field the user didn't touch (masked display, untouched = not present in payload). Non-secret fields are always sent as-is (current form value).
- There is no way to "unset" a secret back to the env fallback from the UI in this pass — clearing it requires editing `.env` and restarting, same as today. (Deferred: an explicit "reset to default" action.)

## API

New route, `server/src/routes/integrationSettings.js`, mounted at `/api/integration-settings`, gated by `auth` + `requireRole('admin')` (same pattern as `/api/app-settings`).

- `GET /api/integration-settings` → `{ settings: [...] }` grouped list per the table above, using the masking rules.
- `PUT /api/integration-settings` → body `{ settings: { key: value, ... } }`, same validate/normalize/persist shape as `updateManagedSettings` in `appSettings.js`. Writes go through `logAction(...)` for audit trail, same as `app_settings` updates.
- `POST /api/integration-settings/:provider/test` → body `{ overrides: { key: value, ... } }` (only fields the user has edited but not yet saved; anything omitted resolves from DB/env same as runtime). Runs a live check:
  - `twilio` → `client.api.accounts(sid).fetch()`
  - `stripe` → `stripe.balance.retrieve()`
  - `smtp` → `transporter.verify()`
  - `hunter` → `GET https://api.hunter.io/v2/account?api_key=...`
  - `openai` → `openai.models.list()`

  Returns `{ success: true }` or `{ success: false, error: '<message returned by the provider SDK/API>' }`. No credential values are ever included in the response.

## Runtime Refactor

Every module that currently builds a provider client once at `require()` time from `process.env` switches to an async getter that re-resolves credentials on each call:

| File | Before | After |
|---|---|---|
| `server/src/services/twilioService.js` | module-level `twilioClient` built at load | `async function getTwilioClient()` |
| `server/src/routes/stripe.js`, `server/src/services/stripeWebhooks.js` | module-level `stripe` built at load | `async function getStripeClient()` |
| `server/src/services/clientNotifications.js` | module-level nodemailer transporter | `async function getMailTransporter()` |
| `server/src/routes/agents.js`, `server/src/routes/proposals.js`, `server/src/routes/tickets.js`, `server/src/services/agentService.js` | `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` per call site | `async function getOpenAiClient()` shared helper |

Each getter:
1. Calls `integrationSettings.getSetting(key)` for its required fields (DB → env fallback, decrypted server-side only).
2. Returns `null`/throws a clear "not configured" error if required fields are missing — matches current `isConfigured()` behavior in `twilioService.js`.
3. Constructs and returns a fresh client instance. No caching (see Non-Goals).

All call sites that referenced the old module-level consts are updated to `await` the getter instead. This is a mechanical but wide-reaching change — it touches every file in the table above.

## UI

`client/src/pages/Settings.jsx`, "Integrations" tab — currently renders only `<GmailConnect />`. Add a new component `IntegrationCredentials.jsx` rendered above/below it in the same tab, with one card per provider:

- Fields per the table above (masked secret inputs pre-filled with `••••ab12` placeholder, cleared on focus to type a new value; non-secret fields show the real current value).
- "Configured" / "Not configured" badge per provider, driven by whether all required fields for that provider resolve to a value (DB or env).
- "Test Connection" button per provider: disabled while a required field is empty and unconfigured; shows spinner while in flight; green success banner or red error banner with the exact provider error message on completion.
- "Save" button per provider card (not one global save) — saves only that provider's fields, calls `PUT /api/integration-settings`, then reloads via `GET` to refresh masked values/configured badges.
- Same visual language as the existing "system" tab (amber notice box, `inputCls`/`btnCls` conventions already in `Settings.jsx`).

## Security

- Route gated `auth` + `requireRole('admin')`, matching `/api/app-settings`.
- Secrets encrypted at rest via existing `TokenManager` (AES-256-GCM), same as OAuth tokens.
- Secrets never round-trip to the client in plaintext — masked display only, write-only updates.
- Audit log entry on every `PUT`, same as `app_settings` (`logAction(..., 'integration_credentials', ...)`).
- Test Connection responses are scrubbed to ensure provider error messages don't leak the credential value itself (verify SDK error shapes don't embed the input token/key).

## Testing

- Unit tests for `integrationSettings.js`: masking logic, DB-vs-env resolution order, secret encryption round-trip, validation of malformed input.
- Route tests for `/api/integration-settings` (GET/PUT/test): admin-only gate, masking in GET response, partial-update semantics in PUT, test-endpoint success/failure paths (mocked provider SDKs).
- Existing `server/src/tests/isolation/integrations.isolation.test.js` pattern reviewed for whether it needs updates given the new route.
- No new E2E required beyond a smoke check that the Integrations tab renders and Test Connection round-trips against a mocked backend.

## Migration Numbering

Next available migration number per `database/migrations/`: `065-integration-credentials.sql`.
