const dns = require('dns').promises;
const pool = require('../../models/db');

/**
 * Outbound deliverability layer (M2).
 *
 * Adds the domain/auth/warmup/rotation layer the outbound product was missing:
 *  - a mailbox registry (sending identities with provider + domain auth posture),
 *  - SPF/DKIM/DMARC verification via DNS,
 *  - a warmup ramp so new mailboxes don't burn (start small, climb to a safe cap),
 *  - engagement-aware throttling (bounce/complaint rate pulls the daily cap down),
 *  - weighted rotation so volume spreads across mailboxes.
 *
 * The cap/throttle/auth math is split into pure helpers so it is unit-testable
 * without a database or live DNS.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Deliverability-safe ceilings. Modern inbox providers reject volume senders that
// exceed these per-mailbox/day, especially on cold domains.
const MAX_SAFE_DAILY_CAP = 50;
const HEALTH_WINDOW_DAYS = 7;

// Bounce/complaint thresholds (industry rule-of-thumb red lines).
const BOUNCE_PAUSE_RATE = 0.10; // >=10% bounces => stop sending
const BOUNCE_THROTTLE_RATE = 0.05; // >=5% bounces => halve volume
const COMPLAINT_PAUSE_RATE = 0.005; // >=0.5% complaints => stop sending
const COMPLAINT_THROTTLE_RATE = 0.001; // >=0.1% complaints => halve volume

// ---------------------------------------------------------------------------
// Pure helpers (no DB / no DNS) — unit tested directly
// ---------------------------------------------------------------------------

function domainOf(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  return at === -1 ? '' : normalized.slice(at + 1);
}

function clampCap(n) {
  const v = Math.floor(Number(n) || 0);
  if (v < 0) return 0;
  if (v > MAX_SAFE_DAILY_CAP) return MAX_SAFE_DAILY_CAP;
  return v;
}

/**
 * Days a mailbox has been warming (0 on the first day). Returns 0 if no start.
 */
function warmupDaysElapsed(warmupStartedAt, now) {
  if (!warmupStartedAt) return 0;
  const start = new Date(warmupStartedAt).getTime();
  const ref = new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(ref) || ref < start) return 0;
  return Math.floor((ref - start) / DAY_MS);
}

/**
 * The warmup cap for a mailbox on a given day: ramp from initial cap upward by
 * increment/day, ceilinged at the configured target (and the safe max).
 * Warmup disabled => straight to target.
 */
function warmupCap({
  warmupEnabled,
  warmupStartedAt,
  warmupInitialCap = 5,
  warmupIncrement = 5,
  dailyCapTarget = 40,
  now = new Date(),
}) {
  const target = clampCap(dailyCapTarget);
  if (!warmupEnabled) return target;
  const days = warmupDaysElapsed(warmupStartedAt, now);
  const ramped = Number(warmupInitialCap) + Number(warmupIncrement) * days;
  return clampCap(Math.min(target, ramped));
}

/**
 * Engagement-aware throttle multiplier in [0,1] from recent-window stats.
 * High bounce or complaint rates throttle (0.5) or fully pause (0) the mailbox.
 */
function engagementThrottleFactor({ sent = 0, bounced = 0, complained = 0 }) {
  const total = Number(sent) || 0;
  if (total < 20) return 1; // too little signal to act on
  const bounceRate = (Number(bounced) || 0) / total;
  const complaintRate = (Number(complained) || 0) / total;
  if (bounceRate >= BOUNCE_PAUSE_RATE || complaintRate >= COMPLAINT_PAUSE_RATE) return 0;
  if (bounceRate >= BOUNCE_THROTTLE_RATE || complaintRate >= COMPLAINT_THROTTLE_RATE) return 0.5;
  return 1;
}

/**
 * 0-100 deliverability health from recent-window stats. 100 = clean.
 * Bounces cost up to 60 points, complaints up to 40.
 */
function healthScore({ sent = 0, bounced = 0, complained = 0 }) {
  const total = Number(sent) || 0;
  if (total < 20) return 100;
  const bounceRate = (Number(bounced) || 0) / total;
  const complaintRate = (Number(complained) || 0) / total;
  const bouncePenalty = Math.min(60, Math.round((bounceRate / BOUNCE_PAUSE_RATE) * 60));
  const complaintPenalty = Math.min(40, Math.round((complaintRate / COMPLAINT_PAUSE_RATE) * 40));
  return Math.max(0, 100 - bouncePenalty - complaintPenalty);
}

/**
 * Effective daily cap = warmup cap * throttle factor, never above the safe max.
 * `recent` is the trailing-window engagement (for throttling).
 */
function effectiveDailyCap(mailbox, recent = {}, now = new Date()) {
  if (mailbox.status === 'paused' || mailbox.status === 'disabled') return 0;
  const ramp = warmupCap({
    warmupEnabled: mailbox.warmup_enabled,
    warmupStartedAt: mailbox.warmup_started_at,
    warmupInitialCap: mailbox.warmup_initial_cap,
    warmupIncrement: mailbox.warmup_increment,
    dailyCapTarget: mailbox.daily_cap_target,
    now,
  });
  const factor = engagementThrottleFactor(recent);
  return clampCap(Math.round(ramp * factor));
}

/**
 * Weighted rotation pick. Candidates: [{ id, remaining, weight }]. Only mailboxes
 * with remaining > 0 are eligible; among those, choose the highest
 * remaining*weight (spreads load, favors fresh capacity and higher-weight boxes).
 * `seed` (e.g. a counter) breaks ties deterministically without Math.random.
 * Returns the chosen candidate or null when none have capacity.
 */
function selectMailbox(candidates, seed = 0) {
  const eligible = (candidates || []).filter((c) => (c.remaining || 0) > 0);
  if (eligible.length === 0) return null;
  let best = null;
  let bestScore = -1;
  eligible.forEach((c, i) => {
    const score = (c.remaining || 0) * (c.weight || 1);
    const tieBreak = (i + seed) % eligible.length;
    if (score > bestScore || (score === bestScore && tieBreak === 0)) {
      bestScore = score;
      best = c;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// DNS auth parsing (pure) + lookup (impure)
// ---------------------------------------------------------------------------

function flattenTxt(records) {
  // dns.resolveTxt returns string[][]; join each chunked record.
  return (records || []).map((r) => (Array.isArray(r) ? r.join('') : String(r)));
}

function parseSpf(records) {
  const txts = flattenTxt(records);
  const spf = txts.find((t) => /^v=spf1\b/i.test(t.trim()));
  return spf ? 'pass' : 'missing';
}

function parseDmarc(records) {
  const txts = flattenTxt(records);
  const dmarc = txts.find((t) => /^v=dmarc1\b/i.test(t.trim()));
  if (!dmarc) return 'missing';
  const policy = (dmarc.match(/\bp=(none|quarantine|reject)\b/i) || [])[1];
  // p=none publishes DMARC but doesn't enforce; still counts as present.
  return policy ? 'pass' : 'fail';
}

function parseDkim(records) {
  const txts = flattenTxt(records);
  const dkim = txts.find((t) => /(^|;)\s*v=dkim1\b/i.test(t) || /\bp=[A-Za-z0-9+/]+/.test(t));
  if (!dkim) return 'missing';
  // p= with empty value means the key was revoked.
  const pub = (dkim.match(/\bp=([A-Za-z0-9+/=]*)/) || [])[1];
  return pub === '' ? 'fail' : 'pass';
}

async function resolveTxtSafe(name) {
  try {
    return await dns.resolveTxt(name);
  } catch {
    return [];
  }
}

/**
 * Run live DNS lookups for a domain and return SPF/DKIM/DMARC status plus the
 * raw records. DKIM requires a selector; without one it stays 'unknown'.
 */
async function checkDomainAuth(domain, dkimSelector = null) {
  const d = String(domain || '').trim().toLowerCase();
  if (!d) return { spf: 'unknown', dkim: 'unknown', dmarc: 'unknown', details: {} };

  const [spfRecords, dmarcRecords] = await Promise.all([
    resolveTxtSafe(d),
    resolveTxtSafe(`_dmarc.${d}`),
  ]);

  let dkim = 'unknown';
  let dkimRecords = [];
  if (dkimSelector) {
    dkimRecords = await resolveTxtSafe(`${dkimSelector}._domainkey.${d}`);
    dkim = parseDkim(dkimRecords);
  }

  return {
    spf: parseSpf(spfRecords),
    dkim,
    dmarc: parseDmarc(dmarcRecords),
    details: {
      spf: flattenTxt(spfRecords),
      dmarc: flattenTxt(dmarcRecords),
      dkim: flattenTxt(dkimRecords),
      checkedSelector: dkimSelector || null,
    },
  };
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

async function listMailboxes(userId) {
  const res = await pool.query(
    `SELECT * FROM outbound_mailboxes WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId]
  );
  return res.rows;
}

async function getMailbox(userId, id) {
  const res = await pool.query(
    `SELECT * FROM outbound_mailboxes WHERE user_id = $1 AND id = $2`,
    [userId, id]
  );
  return res.rows[0] || null;
}

async function createMailbox(userId, { email, provider = 'gmail', dailyCapTarget = 40, warmupEnabled = true, rotationWeight = 1, dkimSelector = null }) {
  const normalized = String(email || '').trim().toLowerCase();
  const domain = domainOf(normalized);
  if (!domain) throw new Error(`Invalid mailbox email: ${email}`);
  const res = await pool.query(
    `INSERT INTO outbound_mailboxes
       (user_id, email, domain, provider, daily_cap_target, warmup_enabled, warmup_started_at, rotation_weight, dkim_selector, status)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9)
     ON CONFLICT (user_id, lower(email)) DO UPDATE SET
       provider = EXCLUDED.provider,
       daily_cap_target = EXCLUDED.daily_cap_target,
       warmup_enabled = EXCLUDED.warmup_enabled,
       rotation_weight = EXCLUDED.rotation_weight,
       dkim_selector = EXCLUDED.dkim_selector,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      normalized,
      domain,
      provider,
      clampCap(dailyCapTarget),
      !!warmupEnabled,
      Math.max(1, Number(rotationWeight) || 1),
      dkimSelector,
      warmupEnabled ? 'warming' : 'active',
    ]
  );
  return res.rows[0];
}

async function updateMailbox(userId, id, fields = {}) {
  const allowed = {
    daily_cap_target: (v) => clampCap(v),
    warmup_enabled: (v) => !!v,
    rotation_weight: (v) => Math.max(1, Number(v) || 1),
    status: (v) => v,
    provider: (v) => v,
    dkim_selector: (v) => v,
  };
  const sets = [];
  const params = [userId, id];
  for (const [key, transform] of Object.entries(allowed)) {
    if (key in fields) {
      params.push(transform(fields[key]));
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (sets.length === 0) return getMailbox(userId, id);
  const res = await pool.query(
    `UPDATE outbound_mailboxes SET ${sets.join(', ')}, updated_at = NOW()
     WHERE user_id = $1 AND id = $2 RETURNING *`,
    params
  );
  return res.rows[0] || null;
}

async function deleteMailbox(userId, id) {
  const res = await pool.query(
    `DELETE FROM outbound_mailboxes WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id]
  );
  return res.rows.length > 0;
}

/**
 * Run a DNS auth check for a mailbox's domain and persist the result.
 */
async function refreshMailboxAuth(userId, id) {
  const mailbox = await getMailbox(userId, id);
  if (!mailbox) return null;
  const result = await checkDomainAuth(mailbox.domain, mailbox.dkim_selector);
  const res = await pool.query(
    `UPDATE outbound_mailboxes
     SET spf_status = $3, dkim_status = $4, dmarc_status = $5,
         auth_checked_at = NOW(), auth_details = $6, updated_at = NOW()
     WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, id, result.spf, result.dkim, result.dmarc, JSON.stringify(result.details)]
  );
  return res.rows[0] || null;
}

/**
 * Trailing-window engagement totals per mailbox for the user.
 * Returns Map<mailbox_id, {sent,bounced,complained,replied}>.
 */
async function recentStatsByMailbox(userId, windowDays = HEALTH_WINDOW_DAYS) {
  const res = await pool.query(
    `SELECT mailbox_id,
            COALESCE(SUM(sent),0)::int AS sent,
            COALESCE(SUM(bounced),0)::int AS bounced,
            COALESCE(SUM(complained),0)::int AS complained,
            COALESCE(SUM(replied),0)::int AS replied
     FROM outbound_mailbox_daily_stats
     WHERE user_id = $1 AND stat_date >= (CURRENT_DATE - ($2::int - 1))
     GROUP BY mailbox_id`,
    [userId, windowDays]
  );
  const map = new Map();
  for (const row of res.rows) map.set(row.mailbox_id, row);
  return map;
}

async function todaySentByMailbox(userId) {
  const res = await pool.query(
    `SELECT mailbox_id, COALESCE(sent,0)::int AS sent
     FROM outbound_mailbox_daily_stats
     WHERE user_id = $1 AND stat_date = CURRENT_DATE`,
    [userId]
  );
  const map = new Map();
  for (const row of res.rows) map.set(row.mailbox_id, row.sent);
  return map;
}

/**
 * Mailboxes annotated with effective cap, today's send count, remaining
 * capacity, and recomputed health. Used by the UI and by selection.
 */
async function mailboxStatus(userId, now = new Date()) {
  const [mailboxes, recent, today] = await Promise.all([
    listMailboxes(userId),
    recentStatsByMailbox(userId),
    todaySentByMailbox(userId),
  ]);
  return mailboxes.map((m) => {
    const r = recent.get(m.id) || { sent: 0, bounced: 0, complained: 0, replied: 0 };
    const sentToday = today.get(m.id) || 0;
    const cap = effectiveDailyCap(m, r, now);
    return {
      ...m,
      effective_daily_cap: cap,
      sent_today: sentToday,
      remaining_today: Math.max(0, cap - sentToday),
      health_score: healthScore(r),
      window_stats: r,
    };
  });
}

/**
 * Pick the next mailbox to send from, honoring warmup + throttle + remaining
 * capacity + rotation weight. Returns the annotated mailbox or null.
 */
async function pickSendingMailbox(userId, seed = 0, now = new Date()) {
  const statuses = await mailboxStatus(userId, now);
  const eligible = statuses.filter((m) => m.status === 'active' || m.status === 'warming');
  const choice = selectMailbox(
    eligible.map((m) => ({ id: m.id, remaining: m.remaining_today, weight: m.rotation_weight })),
    seed
  );
  if (!choice) return null;
  return eligible.find((m) => m.id === choice.id) || null;
}

/**
 * Increment a daily engagement counter for a mailbox (upsert on the day row).
 * `kind` is one of: sent | bounced | complained | replied | opened.
 */
async function recordMailboxEvent(userId, mailboxId, kind, amount = 1) {
  const columns = ['sent', 'bounced', 'complained', 'replied', 'opened'];
  if (!columns.includes(kind)) throw new Error(`Invalid mailbox event: ${kind}`);
  await pool.query(
    `INSERT INTO outbound_mailbox_daily_stats (mailbox_id, user_id, stat_date, ${kind})
     VALUES ($1, $2, CURRENT_DATE, $3)
     ON CONFLICT (mailbox_id, stat_date)
     DO UPDATE SET ${kind} = outbound_mailbox_daily_stats.${kind} + EXCLUDED.${kind}`,
    [mailboxId, userId, Math.max(1, Number(amount) || 1)]
  );
}

module.exports = {
  // pure
  domainOf,
  clampCap,
  warmupDaysElapsed,
  warmupCap,
  engagementThrottleFactor,
  healthScore,
  effectiveDailyCap,
  selectMailbox,
  parseSpf,
  parseDmarc,
  parseDkim,
  checkDomainAuth,
  // db
  listMailboxes,
  getMailbox,
  createMailbox,
  updateMailbox,
  deleteMailbox,
  refreshMailboxAuth,
  recentStatsByMailbox,
  todaySentByMailbox,
  mailboxStatus,
  pickSendingMailbox,
  recordMailboxEvent,
  // constants
  MAX_SAFE_DAILY_CAP,
  HEALTH_WINDOW_DAYS,
};
