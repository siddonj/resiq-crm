const crypto = require('crypto');
const pool = require('../../models/db');

/**
 * Outbound compliance layer (M3).
 *
 * Centralizes do-not-contact enforcement, opt-out handling, CAN-SPAM
 * footer construction, and signed one-click unsubscribe tokens so that
 * suppression is consistent across the draft, sequence, and import paths.
 */

class ComplianceBlockedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ComplianceBlockedError';
    this.statusCode = 403;
    this.complianceBlocked = true;
    this.details = details;
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function domainOf(email) {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  return at === -1 ? '' : normalized.slice(at + 1);
}

function isValidEmail(email) {
  const normalized = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

// ---------------------------------------------------------------------------
// Signed unsubscribe tokens (HMAC over user_id + email, no DB lookup needed)
// ---------------------------------------------------------------------------

function tokenSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required for unsubscribe token signing.');
  }
  return secret;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

function generateUnsubscribeToken(userId, email) {
  const payload = b64url(JSON.stringify({ u: userId, e: normalizeEmail(email) }));
  const sig = b64url(crypto.createHmac('sha256', tokenSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

function verifyUnsubscribeToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', tokenSecret()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(b64urlDecode(payload));
    if (!data.u || !data.e) return null;
    return { userId: data.u, email: normalizeEmail(data.e) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Suppression list
// ---------------------------------------------------------------------------

/**
 * Resolve a user's organization_id when the caller didn't already have
 * req.orgId (e.g. the public unsubscribe route, or send-flow callers that
 * only carry userId). Mirrors the single-membership assumption used by
 * middleware/resolveOrg.js. Callers inside compliance.js's own routes pass
 * req.orgId explicitly and skip this lookup entirely.
 */
async function resolveOrgIdForUser(userId) {
  const res = await pool.query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return res.rows[0]?.organization_id || null;
}

async function ensureOrgId(userId, orgId) {
  return orgId || resolveOrgIdForUser(userId);
}

async function logComplianceEvent({ userId, orgId = null, leadId = null, email = '', eventType, channel = null, details = {} }) {
  try {
    const resolvedOrgId = await ensureOrgId(userId, orgId);
    await pool.query(
      `INSERT INTO outbound_compliance_events (user_id, organization_id, lead_id, email, event_type, channel, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, resolvedOrgId, leadId, normalizeEmail(email), eventType, channel, JSON.stringify(details)]
    );
  } catch (err) {
    // Audit logging must never break the send/opt-out path.
    console.error('Failed to log compliance event:', err.message);
  }
}

/**
 * Returns { suppressed: boolean, entry|null } for an email, matching either an
 * exact email entry or a domain-level block for the same user within the org.
 */
async function isSuppressed(userId, email, orgId = null) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { suppressed: false, entry: null };
  const domain = domainOf(normalized);
  const resolvedOrgId = await ensureOrgId(userId, orgId);

  const res = await pool.query(
    `SELECT * FROM outbound_suppression_entries
     WHERE user_id = $1
       AND organization_id = $2
       AND (
         (match_type = 'email' AND email = $3)
         OR (match_type = 'domain' AND email_domain = $4)
       )
     ORDER BY created_at ASC
     LIMIT 1`,
    [userId, resolvedOrgId, normalized, domain]
  );

  return { suppressed: res.rows.length > 0, entry: res.rows[0] || null };
}

async function addSuppression(userId, { email, reason = '', source = 'manual', matchType = 'email', metadata = {}, orgId = null }) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized) && matchType === 'email') {
    throw new Error(`Invalid email for suppression: ${email}`);
  }
  const domain = domainOf(normalized);
  const resolvedOrgId = await ensureOrgId(userId, orgId);

  const res = await pool.query(
    `INSERT INTO outbound_suppression_entries (user_id, organization_id, email, email_domain, match_type, reason, source, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, email)
     DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source, metadata = EXCLUDED.metadata
     RETURNING *`,
    [userId, resolvedOrgId, normalized, domain, matchType, reason, source, JSON.stringify(metadata)]
  );

  await logComplianceEvent({ userId, orgId: resolvedOrgId, email: normalized, eventType: 'suppressed', details: { source, reason, matchType } });
  return res.rows[0];
}

async function removeSuppression(userId, email, orgId = null) {
  const normalized = normalizeEmail(email);
  const resolvedOrgId = await ensureOrgId(userId, orgId);
  const res = await pool.query(
    `DELETE FROM outbound_suppression_entries WHERE user_id = $1 AND organization_id = $2 AND email = $3 RETURNING id`,
    [userId, resolvedOrgId, normalized]
  );
  if (res.rows.length) {
    await logComplianceEvent({ userId, orgId: resolvedOrgId, email: normalized, eventType: 'suppression_removed', details: {} });
  }
  return res.rows.length > 0;
}

async function listSuppression(userId, { limit = 200, search = '', orgId = null } = {}) {
  const resolvedOrgId = await ensureOrgId(userId, orgId);
  const params = [userId, resolvedOrgId];
  let where = 'user_id = $1 AND organization_id = $2';
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND email LIKE $${params.length}`;
  }
  params.push(Math.min(1000, Math.max(1, Number(limit) || 200)));
  const res = await pool.query(
    `SELECT * FROM outbound_suppression_entries WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return res.rows;
}

async function importSuppression(userId, emails, { source = 'import', reason = 'bulk import', orgId = null } = {}) {
  const resolvedOrgId = await ensureOrgId(userId, orgId);
  const added = [];
  const skipped = [];
  for (const raw of emails) {
    const normalized = normalizeEmail(raw);
    if (!isValidEmail(normalized)) {
      skipped.push(raw);
      continue;
    }
    try {
      await addSuppression(userId, { email: normalized, reason, source, orgId: resolvedOrgId });
      added.push(normalized);
    } catch {
      skipped.push(raw);
    }
  }
  return { added: added.length, skipped: skipped.length, skippedSamples: skipped.slice(0, 10) };
}

/**
 * Record an opt-out: add to suppression list AND flip any matching outbound
 * leads to 'suppressed' so the existing per-lead enforcement also fires.
 */
async function recordOptOut({ userId, email, leadId = null, channel = 'email', source = 'opt_out', orgId = null }) {
  const normalized = normalizeEmail(email);
  const resolvedOrgId = await ensureOrgId(userId, orgId);
  await addSuppression(userId, { email: normalized, reason: 'Recipient opted out', source, orgId: resolvedOrgId });

  await pool.query(
    `UPDATE outbound_leads
     SET status = 'suppressed',
         suppression_reason = COALESCE(NULLIF(suppression_reason, ''), 'opt_out'),
         updated_at = NOW()
     WHERE user_id = $1 AND lower(email) = $2 AND status <> 'suppressed'`,
    [userId, normalized]
  );

  await logComplianceEvent({ userId, orgId: resolvedOrgId, leadId, email: normalized, eventType: 'opt_out_received', channel, details: { source } });
  return { email: normalized };
}

/**
 * Throw ComplianceBlockedError if a send to this lead/email is not permitted.
 * Covers both the legacy per-lead suppression flag and the centralized list.
 */
async function assertSendAllowed(userId, { email, leadStatus, suppressionReason, leadId = null, orgId = null }, channel = 'email') {
  const resolvedOrgId = await ensureOrgId(userId, orgId);
  if (leadStatus === 'suppressed' || suppressionReason) {
    await logComplianceEvent({ userId, orgId: resolvedOrgId, leadId, email, eventType: 'send_blocked', channel, details: { reason: 'lead_suppressed' } });
    throw new ComplianceBlockedError('Lead is suppressed and cannot be contacted.', { reason: 'lead_suppressed' });
  }
  const { suppressed, entry } = await isSuppressed(userId, email, resolvedOrgId);
  if (suppressed) {
    await logComplianceEvent({ userId, orgId: resolvedOrgId, leadId, email, eventType: 'send_blocked', channel, details: { reason: 'suppression_list', matchType: entry?.match_type } });
    throw new ComplianceBlockedError('Recipient is on the do-not-contact list.', { reason: 'suppression_list' });
  }
}

// ---------------------------------------------------------------------------
// CAN-SPAM footer + workspace compliance config
// ---------------------------------------------------------------------------

const COMPLIANCE_CONFIG_DEFAULTS = {
  physical_mailing_address: '',
  compliance_region: 'US',
  unsubscribe_footer_enabled: true,
};

async function getComplianceConfig(userId, orgId = null) {
  const resolvedOrgId = await ensureOrgId(userId, orgId);
  const res = await pool.query(
    `SELECT physical_mailing_address, compliance_region, unsubscribe_footer_enabled
     FROM outbound_workspace_config WHERE user_id = $1 AND organization_id = $2`,
    [userId, resolvedOrgId]
  );
  if (!res.rows.length) return { ...COMPLIANCE_CONFIG_DEFAULTS };
  return res.rows[0];
}

function unsubscribeBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.APP_URL || process.env.CLIENT_URL || '').replace(/\/+$/, '');
}

function unsubscribeUrl(userId, email) {
  const base = unsubscribeBaseUrl();
  return `${base}/api/unsubscribe/${generateUnsubscribeToken(userId, email)}`;
}

/**
 * Build the CAN-SPAM-compliant footer (physical address + unsubscribe link).
 * Returns '' when the footer is disabled or no physical address is configured.
 */
function buildComplianceFooter({ config, url }) {
  if (!config || !config.unsubscribe_footer_enabled) return '';
  const address = (config.physical_mailing_address || '').trim();
  if (!address && !url) return '';
  const lines = ['', '—'];
  if (url) lines.push(`Unsubscribe: ${url}`);
  if (address) lines.push(address);
  return `\n${lines.join('\n')}\n`;
}

/**
 * Append the compliance footer to an email body for a given recipient, unless
 * the body already contains the unsubscribe URL. Returns the body unchanged on
 * any failure so sending is never blocked by footer construction.
 */
async function appendComplianceFooter({ userId, email, body, orgId = null }) {
  try {
    const config = await getComplianceConfig(userId, orgId);
    if (!config.unsubscribe_footer_enabled) return body;
    const url = unsubscribeUrl(userId, email);
    if (body && url && body.includes('/api/unsubscribe/')) return body;
    const footer = buildComplianceFooter({ config, url });
    return footer ? `${body || ''}${footer}` : body;
  } catch (err) {
    console.error('appendComplianceFooter failed:', err.message);
    return body;
  }
}

module.exports = {
  ComplianceBlockedError,
  normalizeEmail,
  domainOf,
  isValidEmail,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  isSuppressed,
  addSuppression,
  removeSuppression,
  listSuppression,
  importSuppression,
  recordOptOut,
  assertSendAllowed,
  logComplianceEvent,
  getComplianceConfig,
  unsubscribeUrl,
  buildComplianceFooter,
  appendComplianceFooter,
  COMPLIANCE_CONFIG_DEFAULTS,
};
