const express = require('express');
const multer = require('multer');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const { scoreLead } = require('../services/outboundScoring');
const { logAction } = require('../services/auditLogger');
const { getSetting } = require('../services/appSettings');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const VALID_SOURCE_TYPES = new Set(['csv', 'manual', 'api', 'other']);
const SEND_EVENT_TYPES = {
  email: ['draft_sent'],
  linkedin: ['linkedin_task_completed'],
};

const VALID_CAMPAIGN_STATUSES = new Set(['draft', 'active', 'paused', 'completed', 'archived']);
const VALID_CAMPAIGN_CHANNELS = new Set(['email', 'linkedin']);
const VALID_CAMPAIGN_MEMBER_STATUSES = new Set([
  'queued',
  'contacted',
  'replied',
  'meeting',
  'opportunity',
  'suppressed',
  'dropped',
]);
const VALID_SEQUENCE_ENROLLMENT_STATES = new Set(['active', 'paused', 'stopped', 'completed', 'error']);
const ALLOWED_MANUAL_SEQUENCE_TRANSITIONS = {
  active: new Set(['paused', 'stopped']),
  paused: new Set(['active', 'stopped']),
  error: new Set(['active', 'stopped']),
  completed: new Set([]),
  stopped: new Set([]),
};
const CAMPAIGN_MEMBER_TO_LEAD_STATUS = {
  queued: 'queued',
  contacted: 'contacted',
  replied: 'replied',
  meeting: 'meeting',
  opportunity: 'opportunity',
  suppressed: 'suppressed',
};
const LEAD_OUTCOME_EVENT_MAP = {
  replied: {
    leadStatus: 'replied',
    eventType: 'lead_replied',
    stopReason: 'Auto-stopped after reply',
  },
  meeting: {
    leadStatus: 'meeting',
    eventType: 'meeting_booked',
    stopReason: 'Auto-stopped after meeting booked',
  },
  opportunity: {
    leadStatus: 'opportunity',
    eventType: 'opportunity_created',
    stopReason: 'Auto-stopped after opportunity created',
  },
  hard_bounce: {
    leadStatus: 'disqualified',
    eventType: 'hard_bounce',
    stopReason: 'Auto-stopped after hard bounce',
  },
};
const VALID_OUTBOUND_LEAD_STATUSES = new Set([
  'new',
  'qualified',
  'queued',
  'contacted',
  'replied',
  'meeting',
  'opportunity',
  'disqualified',
  'suppressed',
]);
const VALID_RULE_TRIGGER_EVENTS = new Set([
  'lead_imported',
  'draft_generated',
  'draft_approved',
  'draft_sent',
  'linkedin_task_completed',
  'lead_suppressed',
  'lead_unsuppressed',
  'lead_replied',
  'meeting_booked',
  'hard_bounce',
  'sequence_enrolled',
  'sequence_state_changed',
  'campaign_created',
  'campaign_member_status_changed',
  'manual_test',
]);
const VALID_RULE_ACTION_TYPES = new Set([
  'update_lead_status',
  'set_next_recommended_action',
  'create_reminder',
  'suppress_lead',
  'log_event',
  'enroll_sequence',
]);
const VALID_RULE_RUN_STATUSES = new Set(['success', 'failed', 'skipped']);
const VALID_FORECAST_PERIOD_TYPES = new Set(['weekly', 'monthly']);
const FORECAST_BUCKET_WEIGHTS = {
  closed: 1,
  commitOnly: 0.7,
  bestCaseOnly: 0.4,
};
const ATTRIBUTION_STAGE_BY_EVENT = {
  lead_imported: 'imported',
  sequence_enrolled: 'sequence',
  draft_sent: 'contacted',
  linkedin_task_completed: 'contacted',
  lead_replied: 'replied',
  meeting_booked: 'meeting',
  opportunity_created: 'opportunity',
};
const ATTRIBUTION_STAGE_ORDER = ['imported', 'contacted', 'replied', 'meeting', 'opportunity', 'sequence'];
const VALID_DATA_QUALITY_STATUSES = new Set(['open', 'resolved', 'dismissed']);
const VALID_DATA_QUALITY_ISSUE_TYPES = new Set([
  'missing_contact_channel',
  'missing_company',
  'missing_title',
  'low_source_confidence',
  'stale_lead',
  'potential_duplicate',
]);
const DATA_QUALITY_BLOCKING_TYPES = new Set(['missing_contact_channel']);
const MIN_SOURCE_CONFIDENCE_THRESHOLD = 40;
const STALE_LEAD_DAYS = 90;

function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\w_]/g, '');
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVRow(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const values = parseCSVRow(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] || '').trim();
    });
    return row;
  });
}

function canonicalLinkedInUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;

  try {
    const safe = raw.startsWith('http') ? raw : `https://${raw}`;
    const parsed = new URL(safe);
    parsed.search = '';
    parsed.hash = '';
    const normalized = parsed.toString().replace(/\/$/, '');
    return normalized.toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/$/, '');
  }
}

function buildLeadFromRow(row) {
  const firstName = row.first_name || row.firstname || '';
  const lastName = row.last_name || row.lastname || '';
  const fullName = row.name || `${firstName} ${lastName}`.trim();

  return {
    name: fullName || 'Unknown',
    first_name: firstName || null,
    last_name: lastName || null,
    email: (row.email || '').toLowerCase() || null,
    phone: row.phone || null,
    company: row.company || row.organization || null,
    title: row.title || row.job_title || row.role || null,
    linkedin_url: canonicalLinkedInUrl(row.linkedin_url || row.linkedin || row.linkedin_profile),
    website: row.website || row.company_website || null,
    location: row.location || row.geo || null,
    notes: row.notes || row.note || row.context || null,
  };
}

function computeDedupeKey(lead) {
  if (lead.email) return `email:${lead.email.toLowerCase()}`;
  if (lead.linkedin_url) return `linkedin:${lead.linkedin_url}`;
  return `name_company:${String(lead.name || '').toLowerCase()}|${String(lead.company || '').toLowerCase()}`;
}

function buildEmailDraft(lead) {
  const firstName = lead.first_name || (lead.name || '').split(' ')[0] || 'there';
  const companyName = lead.company || 'your team';
  const role = lead.title ? ` as ${lead.title}` : '';

  return {
    subject: `Quick idea for ${companyName}'s multifamily ops`,
    body: `Hi ${firstName},

I noticed your work${role} at ${companyName} and wanted to share a quick idea.

I help multifamily teams improve property tech execution and operational efficiency without adding tool sprawl.

If useful, I can send a short outline tailored to your portfolio and current workflow.

Best,
ResiQ CRM`,
  };
}

function buildLinkedInDraft(lead) {
  const firstName = lead.first_name || (lead.name || '').split(' ')[0] || 'there';
  const companyName = lead.company || 'your team';
  return `Hi ${firstName} - I work with multifamily operators to improve property tech execution and operational efficiency. Would love to connect and share a quick idea for ${companyName}.`;
}

async function logLeadEvent({
  userId,
  leadId,
  eventType,
  channel = null,
  metadata = {},
  runRules = true,
}) {
  const insertedEvent = await pool.query(
    `INSERT INTO lead_source_events (user_id, lead_id, event_type, channel, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [userId, leadId, eventType, channel, JSON.stringify(metadata)]
  );
  const insertedEventId = insertedEvent.rows[0]?.id || null;
  const insertedEventCreatedAt = insertedEvent.rows[0]?.created_at || new Date().toISOString();

  try {
    await recordAttributionTouchpoint({
      eventId: insertedEventId,
      userId,
      leadId,
      eventType,
      channel,
      metadata,
      occurredAt: insertedEventCreatedAt,
    });
  } catch (error) {
    console.warn('[Outbound Attribution] Failed to record touchpoint:', error.message);
  }

  if (runRules) {
    await runWorkflowRulesForEvent({
      userId,
      leadId,
      triggerEvent: eventType,
      eventData: metadata || {},
      triggerSource: 'lead_event',
    });
  }

  return insertedEventId;
}

async function recordAttributionTouchpoint({
  eventId,
  userId,
  leadId,
  eventType,
  channel = null,
  metadata = {},
  occurredAt = null,
}) {
  if (!eventId || !leadId) return;

  const attributionStage = deriveAttributionStage(eventType, metadata);
  if (!attributionStage) return;

  const leadRes = await pool.query(
    `SELECT source_type, source_reference
     FROM outbound_leads
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [leadId, userId]
  );
  const lead = leadRes.rows[0];
  if (!lead) return;

  const campaignId = sanitizeUuidValue(metadata.campaignId || metadata.campaign_id);
  const sequenceId = sanitizeUuidValue(metadata.sequenceId || metadata.sequence_id);
  let attributedValue = 0;

  if (attributionStage === 'opportunity') {
    const explicitValue = toFiniteNumber(
      metadata.attributedValue ?? metadata.attributed_value ?? metadata.revenue ?? metadata.expectedRevenue,
      0
    );
    attributedValue = explicitValue > 0 ? round2(explicitValue) : round2(await getAverageClosedWonValue(userId));
  }

  await pool.query(
    `INSERT INTO attribution_touchpoints
      (lead_event_id, user_id, lead_id, source_type, source_reference, campaign_id, sequence_id,
       event_type, attribution_stage, channel, touch_weight, attributed_value, metadata, occurred_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $12::jsonb, $13)
     ON CONFLICT (lead_event_id) DO NOTHING`,
    [
      eventId,
      userId,
      leadId,
      lead.source_type || 'other',
      lead.source_reference || null,
      campaignId,
      sequenceId,
      eventType,
      attributionStage,
      channel,
      attributedValue,
      JSON.stringify(metadata || {}),
      occurredAt || new Date().toISOString(),
    ]
  );
}

async function computeEngagementSignals(userId, leadId) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE event_type IN ('draft_generated', 'draft_approved'))::int AS prep_events,
       COUNT(*) FILTER (WHERE event_type IN ('draft_sent', 'linkedin_task_completed'))::int AS contact_events,
       COUNT(*) FILTER (WHERE event_type IN ('lead_replied', 'meeting_booked', 'opportunity_created'))::int AS positive_events,
       MAX(created_at) AS last_event_at
     FROM lead_source_events
     WHERE user_id = $1
       AND lead_id = $2`,
    [userId, leadId]
  );

  const row = result.rows[0] || {};
  const prepEvents = Number(row.prep_events || 0);
  const contactEvents = Number(row.contact_events || 0);
  const positiveEvents = Number(row.positive_events || 0);
  const lastEventAt = row.last_event_at ? new Date(row.last_event_at) : null;

  let score = 0;
  const reasons = [];

  if (prepEvents > 0) {
    score += Math.min(24, prepEvents * 8);
    reasons.push(`Draft activity recorded (${prepEvents})`);
  }
  if (contactEvents > 0) {
    score += Math.min(35, contactEvents * 12);
    reasons.push(`Contact actions recorded (${contactEvents})`);
  }
  if (positiveEvents > 0) {
    score += Math.min(45, positiveEvents * 20);
    reasons.push(`Positive outcomes recorded (${positiveEvents})`);
  }
  if (lastEventAt) {
    const ageDays = (Date.now() - lastEventAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays <= 14) {
      score += 10;
      reasons.push('Recent engagement in last 14 days');
    } else if (ageDays > 90) {
      reasons.push('Engagement is stale (older than 90 days)');
    }
  } else {
    reasons.push('No engagement events recorded yet');
  }

  return {
    engagementScore: Math.max(0, Math.min(100, Math.round(score))),
    engagementReasons: reasons,
  };
}

async function recordLeadScoreHistory({ userId, leadId, score, source = 'manual_rescore' }) {
  await pool.query(
    `INSERT INTO lead_score_history
      (user_id, lead_id, fit_score, intent_score, engagement_score, total_score, status, next_recommended_action, reasons, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      userId,
      leadId,
      score.fitScore,
      score.intentScore,
      score.engagementScore || 0,
      score.totalScore,
      score.status,
      score.nextRecommendedAction,
      JSON.stringify(score.reasons || {}),
      source,
    ]
  );
}

async function getDailySendUsage(userId, channel) {
  const eventTypes = SEND_EVENT_TYPES[channel] || [];
  const limitSettingKey =
    channel === 'email'
      ? 'outbound_daily_email_send_limit'
      : channel === 'linkedin'
      ? 'outbound_daily_linkedin_send_limit'
      : null;
  const limit = limitSettingKey ? Number(await getSetting(limitSettingKey)) : 0;
  if (eventTypes.length === 0) {
    return { channel, used: 0, limit, remaining: limit };
  }

  const result = await pool.query(
    `SELECT COUNT(*)::int AS used
     FROM lead_source_events
     WHERE user_id = $1
       AND channel = $2
       AND event_type = ANY($3)
       AND created_at >= date_trunc('day', NOW())`,
    [userId, channel, eventTypes]
  );

  const used = Number(result.rows[0]?.used || 0);
  return {
    channel,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

function requireWithinDailyLimit(usage) {
  return usage.used < usage.limit;
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function normalizeCampaignChannels(channels) {
  const candidate = Array.isArray(channels) ? channels : [];
  const normalized = candidate
    .map((channel) => String(channel || '').toLowerCase().trim())
    .filter((channel) => VALID_CAMPAIGN_CHANNELS.has(channel));

  const unique = [...new Set(normalized)];
  if (unique.length === 0) return ['email'];
  return unique;
}

function sanitizeUuidList(values) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => uuidRegex.test(value));
}

function sanitizeUuidValue(value) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const normalized = String(value || '').trim();
  return uuidRegex.test(normalized) ? normalized : null;
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeRate(numerator, denominator) {
  const parsedNumerator = toFiniteNumber(numerator, 0);
  const parsedDenominator = toFiniteNumber(denominator, 0);
  if (parsedDenominator <= 0) return 0;
  return round2((parsedNumerator / parsedDenominator) * 100);
}

function classifyPersonaTitle(title) {
  const normalized = String(title || '').trim().toLowerCase();
  if (!normalized) return 'Unknown';
  if (normalized.includes('chief') || normalized.includes(' cxo ') || normalized.startsWith('coo') || normalized.startsWith('ceo')) {
    return 'Executive';
  }
  if (normalized.includes('vp') || normalized.includes('vice president')) {
    return 'VP';
  }
  if (normalized.includes('director') || normalized.includes('head of')) {
    return 'Director';
  }
  if (normalized.includes('manager')) {
    return 'Manager';
  }
  if (normalized.includes('owner') || normalized.includes('founder') || normalized.includes('principal')) {
    return 'Owner/Founder';
  }
  return 'Other';
}

function normalizeIssueToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getLeadUpdatedAt(lead) {
  return lead?.updated_at || lead?.created_at || null;
}

function buildLeadDataQualityIssueCandidates(lead, { duplicateGroup = null } = {}) {
  if (!lead || !lead.id) return [];

  const issues = [];
  const leadId = lead.id;
  const hasEmail = Boolean(String(lead.email || '').trim());
  const hasLinkedIn = Boolean(String(lead.linkedin_url || '').trim());
  const hasCompany = Boolean(String(lead.company || '').trim());
  const hasTitle = Boolean(String(lead.title || '').trim());
  const sourceConfidence = Number(lead.source_confidence || 0);
  const updatedAt = getLeadUpdatedAt(lead);
  const daysSinceUpdate = updatedAt ? Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24)) : null;

  if (!hasEmail && !hasLinkedIn) {
    issues.push({
      leadId,
      issueType: 'missing_contact_channel',
      issueKey: `missing_contact_channel:${leadId}`,
      severity: 'high',
      isBlocking: true,
      details: {
        message: 'Lead requires email or LinkedIn URL before sequence enrollment.',
        missingFields: ['email_or_linkedin_url'],
      },
    });
  }

  if (!hasCompany) {
    issues.push({
      leadId,
      issueType: 'missing_company',
      issueKey: `missing_company:${leadId}`,
      severity: 'medium',
      isBlocking: false,
      details: {
        message: 'Company is missing.',
        missingFields: ['company'],
      },
    });
  }

  if (!hasTitle) {
    issues.push({
      leadId,
      issueType: 'missing_title',
      issueKey: `missing_title:${leadId}`,
      severity: 'low',
      isBlocking: false,
      details: {
        message: 'Title is missing.',
        missingFields: ['title'],
      },
    });
  }

  if (sourceConfidence < MIN_SOURCE_CONFIDENCE_THRESHOLD) {
    issues.push({
      leadId,
      issueType: 'low_source_confidence',
      issueKey: `low_source_confidence:${leadId}`,
      severity: 'medium',
      isBlocking: false,
      details: {
        message: `Source confidence is below ${MIN_SOURCE_CONFIDENCE_THRESHOLD}.`,
        sourceConfidence,
        minThreshold: MIN_SOURCE_CONFIDENCE_THRESHOLD,
      },
    });
  }

  if (daysSinceUpdate != null && daysSinceUpdate >= STALE_LEAD_DAYS) {
    issues.push({
      leadId,
      issueType: 'stale_lead',
      issueKey: `stale_lead:${leadId}`,
      severity: 'medium',
      isBlocking: false,
      details: {
        message: `Lead record is stale (${daysSinceUpdate} days since update).`,
        staleDays: daysSinceUpdate,
      },
    });
  }

  if (duplicateGroup && Array.isArray(duplicateGroup.leadIds) && duplicateGroup.leadIds.length > 1) {
    issues.push({
      leadId,
      issueType: 'potential_duplicate',
      issueKey: `potential_duplicate:${duplicateGroup.groupKey}:${leadId}`,
      severity: 'high',
      isBlocking: false,
      details: {
        message: 'Potential duplicate lead found by normalized name + company.',
        groupKey: duplicateGroup.groupKey,
        candidateLeadIds: duplicateGroup.leadIds,
        suggestedPrimaryLeadId: duplicateGroup.suggestedPrimaryLeadId || null,
      },
    });
  }

  return issues;
}

function buildDuplicateGroupIndex(leads) {
  const groups = new Map();
  for (const lead of leads) {
    const normalizedName = normalizeIssueToken(lead.name);
    const normalizedCompany = normalizeIssueToken(lead.company);
    if (!normalizedName || !normalizedCompany) continue;
    const groupKey = `${normalizedName}:${normalizedCompany}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(lead);
  }

  const byLeadId = new Map();
  for (const [groupKey, members] of groups.entries()) {
    if (members.length <= 1) continue;
    members.sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
    const leadIds = members.map((member) => member.id);
    const suggestedPrimaryLeadId = leadIds[0];
    for (const member of members) {
      byLeadId.set(member.id, {
        groupKey,
        leadIds,
        suggestedPrimaryLeadId,
      });
    }
  }

  return byLeadId;
}

async function upsertDataQualityIssues(userId, issues) {
  if (!issues.length) return;

  for (const issue of issues) {
    await pool.query(
      `INSERT INTO data_quality_issues
        (user_id, lead_id, issue_type, issue_key, severity, status, is_blocking, details, detected_at, updated_at, resolved_at)
       VALUES
        ($1, $2, $3, $4, $5, 'open', $6, $7::jsonb, NOW(), NOW(), NULL)
       ON CONFLICT (user_id, issue_key)
       DO UPDATE SET
         lead_id = EXCLUDED.lead_id,
         issue_type = EXCLUDED.issue_type,
         severity = EXCLUDED.severity,
         status = 'open',
         is_blocking = EXCLUDED.is_blocking,
         details = EXCLUDED.details,
         detected_at = NOW(),
         updated_at = NOW(),
         resolved_at = NULL`,
      [
        userId,
        issue.leadId || null,
        issue.issueType,
        issue.issueKey,
        issue.severity || 'medium',
        Boolean(issue.isBlocking),
        JSON.stringify(issue.details || {}),
      ]
    );
  }
}

async function syncDataQualityIssuesForUser(userId) {
  const leadsRes = await pool.query(
    `SELECT id, name, email, linkedin_url, company, title, source_confidence, created_at, updated_at
     FROM outbound_leads
     WHERE user_id = $1`,
    [userId]
  );
  const leads = leadsRes.rows;
  const duplicateGroupByLead = buildDuplicateGroupIndex(leads);

  const detectedIssues = [];
  for (const lead of leads) {
    const duplicateGroup = duplicateGroupByLead.get(lead.id) || null;
    detectedIssues.push(...buildLeadDataQualityIssueCandidates(lead, { duplicateGroup }));
  }

  await upsertDataQualityIssues(userId, detectedIssues);

  const activeIssueKeys = detectedIssues.map((issue) => issue.issueKey);
  await pool.query(
    `UPDATE data_quality_issues
     SET status = 'resolved',
         resolved_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1
       AND status = 'open'
       AND NOT (issue_key = ANY($2::text[]))`,
    [userId, activeIssueKeys]
  );
}

function mapDataQualityIssueRow(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    issueType: row.issue_type,
    issueKey: row.issue_key,
    severity: row.severity,
    status: row.status,
    isBlocking: Boolean(row.is_blocking),
    details: row.details || {},
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
    lead: row.lead_id
      ? {
          id: row.lead_id,
          name: row.lead_name,
          email: row.lead_email,
          company: row.lead_company,
          title: row.lead_title,
          status: row.lead_status,
        }
      : null,
  };
}

function deriveAttributionStage(eventType, metadata = {}) {
  if (eventType === 'campaign_member_status_changed') {
    const memberStatus = String(metadata.memberStatus || metadata.member_status || '').trim().toLowerCase();
    if (memberStatus === 'contacted') return 'contacted';
    return null;
  }
  return ATTRIBUTION_STAGE_BY_EVENT[eventType] || null;
}

async function getAverageClosedWonValue(userId) {
  const result = await pool.query(
    `SELECT
       COALESCE(AVG(value), 0)::numeric(14,2) AS avg_closed_won_value
     FROM deals
     WHERE user_id = $1
       AND stage = 'closed_won'
       AND value IS NOT NULL
       AND value > 0`,
    [userId]
  );
  const value = Number(result.rows[0]?.avg_closed_won_value || 0);
  return value > 0 ? value : 25000;
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function toPeriodDateString(date) {
  return date.toISOString().slice(0, 10);
}

function getCurrentPeriodWindow(periodType) {
  const now = new Date();
  const utcToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (periodType === 'weekly') {
    const mondayOffset = (utcToday.getUTCDay() + 6) % 7;
    const periodStart = new Date(utcToday);
    periodStart.setUTCDate(periodStart.getUTCDate() - mondayOffset);
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 6);

    return {
      periodType,
      periodStart: toPeriodDateString(periodStart),
      periodEnd: toPeriodDateString(periodEnd),
    };
  }

  const periodStart = new Date(Date.UTC(utcToday.getUTCFullYear(), utcToday.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(utcToday.getUTCFullYear(), utcToday.getUTCMonth() + 1, 0));

  return {
    periodType: 'monthly',
    periodStart: toPeriodDateString(periodStart),
    periodEnd: toPeriodDateString(periodEnd),
  };
}

function calculatePeriodProgress(periodStart, periodEnd) {
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const totalDays = Math.max(1, Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1);
  const elapsedRaw = Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1;
  const elapsedDays = Math.max(0, Math.min(totalDays, elapsedRaw));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const completionRatio = totalDays > 0 ? elapsedDays / totalDays : 0;

  return {
    totalDays,
    elapsedDays,
    remainingDays,
    completionRatio: round2(completionRatio),
  };
}

async function recordSequenceTransition({
  enrollmentId,
  userId,
  fromState = null,
  toState,
  reason = null,
  triggerSource = 'manual',
  metadata = {},
}) {
  await pool.query(
    `INSERT INTO outbound_sequence_enrollment_transitions
      (enrollment_id, user_id, from_state, to_state, reason, trigger_source, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [enrollmentId, userId, fromState, toState, reason, triggerSource, JSON.stringify(metadata || {})]
  );
}

async function getEnrollmentRecord(userId, enrollmentId) {
  const result = await pool.query(
    `SELECT
       e.*,
       s.name AS sequence_name,
       l.name AS lead_name,
       l.email AS lead_email,
       l.company AS lead_company,
       l.status AS lead_status,
       l.suppression_reason
     FROM outbound_sequence_enrollments e
     JOIN sequences s ON s.id = e.sequence_id
     JOIN outbound_leads l ON l.id = e.lead_id
     WHERE e.id = $1
       AND e.user_id = $2
     LIMIT 1`,
    [enrollmentId, userId]
  );
  return result.rows[0] || null;
}

async function autoStopOpenSequenceEnrollments({
  userId,
  leadId,
  reason,
  triggerSource,
  metadata = {},
}) {
  const openRes = await pool.query(
    `SELECT id, status
     FROM outbound_sequence_enrollments
     WHERE user_id = $1
       AND lead_id = $2
       AND status IN ('active', 'paused')
     ORDER BY created_at DESC`,
    [userId, leadId]
  );

  if (!openRes.rows.length) return [];

  const stoppedIds = [];
  for (const enrollment of openRes.rows) {
    await pool.query(
      `UPDATE outbound_sequence_enrollments
       SET status = 'stopped',
           stop_reason = $1,
           stopped_at = NOW(),
           updated_at = NOW(),
           last_transition_at = NOW()
       WHERE id = $2
         AND user_id = $3`,
      [reason, enrollment.id, userId]
    );

    await recordSequenceTransition({
      enrollmentId: enrollment.id,
      userId,
      fromState: enrollment.status,
      toState: 'stopped',
      reason,
      triggerSource,
      metadata,
    });

    stoppedIds.push(enrollment.id);
  }

  return stoppedIds;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getByPath(source, path) {
  const segments = String(path || '')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return undefined;

  let current = source;
  for (const segment of segments) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    current = current[segment];
    if (current === undefined) return undefined;
  }
  return current;
}

function compareConditionValues(op, actual, expected) {
  const normalized = String(op || 'equals').toLowerCase();
  switch (normalized) {
    case 'equals':
    case 'eq':
      return actual === expected;
    case 'not_equals':
    case 'ne':
      return actual !== expected;
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
    default:
      return false;
  }
}

function evaluateRuleConditions(conditions, context) {
  if (!isPlainObject(conditions)) {
    return true;
  }

  const operator = String(conditions.operator || 'AND').toUpperCase();
  const rules = Array.isArray(conditions.rules) ? conditions.rules : [];

  if (!rules.length) {
    return true;
  }

  const evaluations = rules.map((rule) => {
    if (!isPlainObject(rule)) return false;
    const field = String(rule.field || '').trim();
    const op = String(rule.op || 'equals').trim();
    if (!field) return false;
    const actual = getByPath(context, field);
    return compareConditionValues(op, actual, rule.value);
  });

  if (operator === 'OR') {
    return evaluations.some(Boolean);
  }
  return evaluations.every(Boolean);
}

function normalizeRuleActions(actions) {
  const normalized = (Array.isArray(actions) ? actions : [])
    .map((action) => (isPlainObject(action) ? action : null))
    .filter(Boolean)
    .map((action) => {
      const type = String(action.type || '').trim().toLowerCase();
      if (!VALID_RULE_ACTION_TYPES.has(type)) return null;
      const config = isPlainObject(action.config) ? action.config : {};
      return { type, config };
    })
    .filter(Boolean);
  return normalized;
}

async function upsertSequenceEnrollmentForRule({ userId, sequenceId, leadId }) {
  const sequenceRes = await pool.query(
    `SELECT id, name
     FROM sequences
     WHERE id = $1
       AND user_id = $2`,
    [sequenceId, userId]
  );
  if (!sequenceRes.rows.length) {
    throw new Error('Sequence not found for enroll_sequence action');
  }

  const stepsRes = await pool.query(
    `SELECT COUNT(*)::int AS total_steps
     FROM sequence_steps
     WHERE sequence_id = $1`,
    [sequenceId]
  );
  const totalSteps = Number(stepsRes.rows[0]?.total_steps || 0);
  if (totalSteps === 0) {
    throw new Error('Sequence has no steps for enroll_sequence action');
  }

  const openRes = await pool.query(
    `SELECT id
     FROM outbound_sequence_enrollments
     WHERE user_id = $1
       AND lead_id = $2
       AND status IN ('active', 'paused')
     LIMIT 1`,
    [userId, leadId]
  );
  if (openRes.rows.length) {
    return {
      skipped: true,
      message: 'Lead already has an open sequence enrollment',
      enrollmentId: openRes.rows[0].id,
    };
  }

  const insertedRes = await pool.query(
    `INSERT INTO outbound_sequence_enrollments
      (user_id, sequence_id, lead_id, status, current_step, next_step_due_at)
     VALUES ($1, $2, $3, 'active', 1, NOW())
     RETURNING id`,
    [userId, sequenceId, leadId]
  );
  const enrollmentId = insertedRes.rows[0].id;

  await recordSequenceTransition({
    enrollmentId,
    userId,
    fromState: null,
    toState: 'active',
    reason: 'Workflow rule enrollment',
    triggerSource: 'workflow_rule',
    metadata: { sequenceId, leadId },
  });

  return {
    skipped: false,
    enrollmentId,
    sequenceName: sequenceRes.rows[0].name,
  };
}

async function executeWorkflowRuleActions({
  userId,
  lead,
  actions,
  triggerEvent,
  dryRun = true,
}) {
  const executed = [];

  for (const action of actions) {
    const result = {
      type: action.type,
      status: 'success',
      dryRun,
      config: action.config,
    };

    try {
      if (action.type === 'update_lead_status') {
        if (!lead?.id) throw new Error('update_lead_status requires lead context');
        const nextStatus = String(action.config.status || '').trim().toLowerCase();
        if (!VALID_OUTBOUND_LEAD_STATUSES.has(nextStatus)) {
          throw new Error('Invalid lead status in update_lead_status action');
        }
        if (!dryRun) {
          await pool.query(
            `UPDATE outbound_leads
             SET status = $1,
                 updated_at = NOW()
             WHERE id = $2
               AND user_id = $3`,
            [nextStatus, lead.id, userId]
          );
        }
        result.nextStatus = nextStatus;
      } else if (action.type === 'set_next_recommended_action') {
        if (!lead?.id) throw new Error('set_next_recommended_action requires lead context');
        const nextAction = String(action.config.value || action.config.nextRecommendedAction || '').trim();
        if (!nextAction) throw new Error('set_next_recommended_action requires a value');
        if (!dryRun) {
          await pool.query(
            `UPDATE outbound_leads
             SET next_recommended_action = $1,
                 updated_at = NOW()
             WHERE id = $2
               AND user_id = $3`,
            [nextAction, lead.id, userId]
          );
        }
        result.value = nextAction;
      } else if (action.type === 'create_reminder') {
        const message = String(action.config.message || action.config.title || '').trim();
        const dueDays = Math.max(0, Number(action.config.dueDays ?? action.config.due_days ?? 1));
        if (!message) throw new Error('create_reminder requires message');
        if (!dryRun) {
          await pool.query(
            `INSERT INTO reminders (user_id, message, remind_at)
             VALUES ($1, $2, NOW() + ($3 || ' days')::interval)`,
            [userId, message, String(dueDays)]
          );
        }
        result.message = message;
        result.dueDays = dueDays;
      } else if (action.type === 'suppress_lead') {
        if (!lead?.id) throw new Error('suppress_lead requires lead context');
        const reason = String(action.config.reason || 'Suppressed by workflow rule').trim();
        if (!dryRun) {
          await pool.query(
            `UPDATE outbound_leads
             SET status = 'suppressed',
                 suppression_reason = $1,
                 updated_at = NOW()
             WHERE id = $2
               AND user_id = $3`,
            [reason, lead.id, userId]
          );
          await autoStopOpenSequenceEnrollments({
            userId,
            leadId: lead.id,
            reason: 'Auto-stopped after suppression update',
            triggerSource: 'workflow_rule',
            metadata: { triggerEvent, reason },
          });
          await logLeadEvent({
            userId,
            leadId: lead.id,
            eventType: 'lead_suppressed',
            metadata: { reason, source: 'workflow_rule' },
            runRules: false,
          });
        }
        result.reason = reason;
      } else if (action.type === 'log_event') {
        const eventType = String(action.config.eventType || 'workflow_rule_event').trim();
        if (!eventType) throw new Error('log_event requires eventType');
        if (!dryRun) {
          await logLeadEvent({
            userId,
            leadId: lead?.id || null,
            eventType,
            metadata: {
              ...(isPlainObject(action.config.metadata) ? action.config.metadata : {}),
              source: 'workflow_rule',
            },
            runRules: false,
          });
        }
        result.eventType = eventType;
      } else if (action.type === 'enroll_sequence') {
        if (!lead?.id) throw new Error('enroll_sequence requires lead context');
        const sequenceId = String(action.config.sequenceId || '').trim();
        if (!sequenceId) throw new Error('enroll_sequence requires sequenceId');
        if (!dryRun) {
          const enrollment = await upsertSequenceEnrollmentForRule({
            userId,
            sequenceId,
            leadId: lead.id,
          });
          result.enrollment = enrollment;
        } else {
          result.sequenceId = sequenceId;
        }
      } else {
        result.status = 'skipped';
        result.message = 'Unsupported action type';
      }
    } catch (error) {
      result.status = 'failed';
      result.error = error.message;
    }

    executed.push(result);
  }

  return executed;
}

async function insertWorkflowRuleRun({
  ruleId,
  userId,
  triggerSource,
  inputContext,
  matched,
  status,
  actionsExecuted,
  errorMessage = null,
}) {
  const normalizedStatus = VALID_RULE_RUN_STATUSES.has(status) ? status : 'failed';
  await pool.query(
    `INSERT INTO workflow_rule_runs
      (rule_id, user_id, trigger_source, input_context, matched, status, actions_executed, error_message)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8)`,
    [
      ruleId,
      userId,
      triggerSource,
      JSON.stringify(inputContext || {}),
      matched,
      normalizedStatus,
      JSON.stringify(actionsExecuted || []),
      errorMessage,
    ]
  );
}

async function runWorkflowRulesForEvent({
  userId,
  leadId = null,
  triggerEvent,
  eventData = {},
  triggerSource = 'lead_event',
  dryRun = false,
  limitToRuleId = null,
  includeDisabled = false,
}) {
  const eventName = String(triggerEvent || '').trim();
  if (!eventName) return [];

  const params = [userId];
  const filters = ['user_id = $1'];
  if (!includeDisabled) {
    filters.push('enabled = TRUE');
  }

  if (limitToRuleId) {
    params.push(limitToRuleId);
    filters.push(`id = $${params.length}`);
  } else {
    params.push(eventName);
    filters.push(`trigger_event = $${params.length}`);
  }

  const rulesRes = await pool.query(
    `SELECT *
     FROM workflow_rules
     WHERE ${filters.join(' AND ')}
     ORDER BY priority ASC, created_at ASC`,
    params
  );

  if (!rulesRes.rows.length) return [];

  const lead = leadId
    ? (
        await pool.query(
          `SELECT *
           FROM outbound_leads
           WHERE id = $1
             AND user_id = $2
           LIMIT 1`,
          [leadId, userId]
        )
      ).rows[0] || null
    : null;

  const context = {
    lead,
    event: {
      type: eventName,
      data: isPlainObject(eventData) ? eventData : {},
    },
    now: new Date().toISOString(),
  };

  const outputs = [];
  for (const rule of rulesRes.rows) {
    const matched = evaluateRuleConditions(rule.conditions || {}, context);
    const trueActions = normalizeRuleActions(rule.true_actions);
    const falseActions = normalizeRuleActions(rule.false_actions);
    const targetActions = matched ? trueActions : falseActions;

    try {
      const actionsExecuted = await executeWorkflowRuleActions({
        userId,
        lead,
        actions: targetActions,
        triggerEvent: eventName,
        dryRun,
      });

      const actionFailures = actionsExecuted.filter((entry) => entry.status === 'failed');
      const status = actionFailures.length ? 'failed' : targetActions.length ? 'success' : 'skipped';

      if (!dryRun) {
        await insertWorkflowRuleRun({
          ruleId: rule.id,
          userId,
          triggerSource,
          inputContext: context,
          matched,
          status,
          actionsExecuted,
          errorMessage: actionFailures.length ? actionFailures.map((item) => item.error).join('; ') : null,
        });
      }

      outputs.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matched,
        status,
        actionsExecuted,
      });
    } catch (error) {
      if (!dryRun) {
        await insertWorkflowRuleRun({
          ruleId: rule.id,
          userId,
          triggerSource,
          inputContext: context,
          matched,
          status: 'failed',
          actionsExecuted: [],
          errorMessage: error.message,
        });
      }

      outputs.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matched,
        status: 'failed',
        actionsExecuted: [],
        error: error.message,
      });
    }
  }

  return outputs;
}

async function buildOutboundForecastSummary(userId, periodType = 'monthly') {
  const normalizedPeriodType = VALID_FORECAST_PERIOD_TYPES.has(periodType) ? periodType : 'monthly';
  const period = getCurrentPeriodWindow(normalizedPeriodType);
  const progress = calculatePeriodProgress(period.periodStart, period.periodEnd);

  const [bucketRes, activityRes, revenueRes, avgDealRes, goalRes] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'opportunity' THEN 1 ELSE 0 END), 0)::int AS closed_count,
         COALESCE(SUM(CASE WHEN status = 'meeting' THEN 1 ELSE 0 END), 0)::int AS commit_only_count,
         COALESCE(SUM(CASE WHEN status IN ('contacted', 'replied') THEN 1 ELSE 0 END), 0)::int AS best_case_only_count
       FROM outbound_leads
       WHERE user_id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'meeting_booked')::int AS meetings_actual,
         COUNT(*) FILTER (
           WHERE event_type = 'opportunity_created'
              OR (event_type = 'campaign_member_status_changed' AND COALESCE(metadata->>'memberStatus', '') = 'opportunity')
         )::int AS opportunities_actual
       FROM lead_source_events
       WHERE user_id = $1
         AND created_at >= $2::date
         AND created_at < ($3::date + INTERVAL '1 day')`,
      [userId, period.periodStart, period.periodEnd]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(value), 0)::numeric(14,2) AS revenue_actual,
         COUNT(*)::int AS deals_won_actual
       FROM deals
       WHERE user_id = $1
         AND stage = 'closed_won'
         AND COALESCE(close_date::timestamptz, updated_at, created_at) >= $2::date
         AND COALESCE(close_date::timestamptz, updated_at, created_at) < ($3::date + INTERVAL '1 day')`,
      [userId, period.periodStart, period.periodEnd]
    ),
    pool.query(
      `SELECT
         COALESCE(AVG(value), 0)::numeric(14,2) AS avg_closed_won_value
       FROM deals
       WHERE user_id = $1
         AND stage = 'closed_won'
         AND value IS NOT NULL
         AND value > 0`,
      [userId]
    ),
    pool.query(
      `SELECT *
       FROM sales_goals
       WHERE user_id = $1
         AND period_type = $2
         AND period_start = $3::date
         AND period_end = $4::date
       LIMIT 1`,
      [userId, period.periodType, period.periodStart, period.periodEnd]
    ),
  ]);

  const bucketRow = bucketRes.rows[0] || {};
  const activityRow = activityRes.rows[0] || {};
  const revenueRow = revenueRes.rows[0] || {};
  const avgDealRow = avgDealRes.rows[0] || {};
  const goal = goalRes.rows[0] || null;

  const closedCount = Number(bucketRow.closed_count || 0);
  const commitOnlyCount = Number(bucketRow.commit_only_count || 0);
  const bestCaseOnlyCount = Number(bucketRow.best_case_only_count || 0);
  const commitCount = closedCount + commitOnlyCount;
  const bestCaseCount = commitCount + bestCaseOnlyCount;

  const averageClosedWonDealValue = Number(avgDealRow.avg_closed_won_value || 0);
  const baselineValue =
    averageClosedWonDealValue > 0
      ? averageClosedWonDealValue
      : goal?.target_opportunities > 0 && Number(goal.target_revenue || 0) > 0
      ? Number(goal.target_revenue) / Number(goal.target_opportunities)
      : 25000;

  const closedValue = round2(closedCount * baselineValue * FORECAST_BUCKET_WEIGHTS.closed);
  const commitValue = round2(
    closedValue + commitOnlyCount * baselineValue * FORECAST_BUCKET_WEIGHTS.commitOnly
  );
  const bestCaseValue = round2(
    commitValue + bestCaseOnlyCount * baselineValue * FORECAST_BUCKET_WEIGHTS.bestCaseOnly
  );
  const totalForecastValue = bestCaseValue;

  const meetingsActual = Number(activityRow.meetings_actual || 0);
  const opportunitiesActual = Number(activityRow.opportunities_actual || 0);
  const revenueActual = Number(revenueRow.revenue_actual || 0);
  const dealsWonActual = Number(revenueRow.deals_won_actual || 0);

  const projectionScale = progress.elapsedDays > 0 ? progress.totalDays / progress.elapsedDays : 0;
  const meetingsProjected = round2(meetingsActual * projectionScale);
  const opportunitiesProjected = round2(opportunitiesActual * projectionScale);
  const revenueProjected = round2(revenueActual * projectionScale);

  const targetMeetings = goal ? Number(goal.target_meetings || 0) : 0;
  const targetOpportunities = goal ? Number(goal.target_opportunities || 0) : 0;
  const targetRevenue = goal ? Number(goal.target_revenue || 0) : 0;

  const goalGap = goal
    ? {
        meetingsGap: round2(targetMeetings - meetingsProjected),
        opportunitiesGap: round2(targetOpportunities - opportunitiesProjected),
        revenueGap: round2(targetRevenue - revenueProjected),
      }
    : null;

  const metadata = {
    baselineValue: round2(baselineValue),
    averageClosedWonDealValue: round2(averageClosedWonDealValue),
    projected: {
      meetings: meetingsProjected,
      opportunities: opportunitiesProjected,
      revenue: revenueProjected,
    },
    actual: {
      meetings: meetingsActual,
      opportunities: opportunitiesActual,
      revenue: round2(revenueActual),
      dealsWon: dealsWonActual,
    },
    progress,
  };

  await pool.query(
    `INSERT INTO pipeline_forecasts
      (user_id, period_type, period_start, period_end, snapshot_date,
       commit_count, best_case_count, closed_count,
       commit_value, best_case_value, closed_value, total_forecast_value, metadata)
     VALUES ($1, $2, $3::date, $4::date, CURRENT_DATE, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
     ON CONFLICT (user_id, period_type, period_start, period_end, snapshot_date)
     DO UPDATE SET
       commit_count = EXCLUDED.commit_count,
       best_case_count = EXCLUDED.best_case_count,
       closed_count = EXCLUDED.closed_count,
       commit_value = EXCLUDED.commit_value,
       best_case_value = EXCLUDED.best_case_value,
       closed_value = EXCLUDED.closed_value,
       total_forecast_value = EXCLUDED.total_forecast_value,
       metadata = EXCLUDED.metadata`,
    [
      userId,
      period.periodType,
      period.periodStart,
      period.periodEnd,
      commitCount,
      bestCaseCount,
      closedCount,
      commitValue,
      bestCaseValue,
      closedValue,
      totalForecastValue,
      JSON.stringify(metadata),
    ]
  );

  return {
    period: {
      type: period.periodType,
      start: period.periodStart,
      end: period.periodEnd,
    },
    buckets: {
      closed: { count: closedCount, value: closedValue },
      commit: { count: commitCount, value: commitValue },
      bestCase: { count: bestCaseCount, value: bestCaseValue },
      totalForecastValue,
    },
    actuals: {
      meetings: meetingsActual,
      opportunities: opportunitiesActual,
      revenue: round2(revenueActual),
      dealsWon: dealsWonActual,
    },
    projected: {
      meetings: meetingsProjected,
      opportunities: opportunitiesProjected,
      revenue: revenueProjected,
    },
    goals: goal
      ? {
          id: goal.id,
          targetMeetings,
          targetOpportunities,
          targetRevenue: round2(targetRevenue),
          notes: goal.notes,
          updatedAt: goal.updated_at,
        }
      : null,
    gapToGoal: goalGap,
    progress,
    assumptions: {
      baselineDealValue: round2(baselineValue),
      averageClosedWonDealValue: round2(averageClosedWonDealValue),
      bucketWeights: {
        closed: FORECAST_BUCKET_WEIGHTS.closed,
        commitOnly: FORECAST_BUCKET_WEIGHTS.commitOnly,
        bestCaseOnly: FORECAST_BUCKET_WEIGHTS.bestCaseOnly,
      },
    },
  };
}

async function buildOutboundAttributionSummary(userId, periodType = 'monthly') {
  const normalizedPeriodType = VALID_FORECAST_PERIOD_TYPES.has(periodType) ? periodType : 'monthly';
  const period = getCurrentPeriodWindow(normalizedPeriodType);
  const [overviewRes, sourceRes, sequenceRes, personaRowsRes, lineageRes, baselineValue] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(DISTINCT lead_id) FILTER (WHERE attribution_stage = 'imported')::int AS imported_leads,
         COUNT(DISTINCT lead_id) FILTER (WHERE attribution_stage = 'contacted')::int AS contacted_leads,
         COUNT(DISTINCT lead_id) FILTER (WHERE attribution_stage = 'replied')::int AS replied_leads,
         COUNT(DISTINCT lead_id) FILTER (WHERE attribution_stage = 'meeting')::int AS meeting_leads,
         COUNT(DISTINCT lead_id) FILTER (WHERE attribution_stage = 'opportunity')::int AS opportunity_leads,
         COALESCE(SUM(attributed_value) FILTER (WHERE attribution_stage = 'opportunity'), 0)::numeric(14,2) AS attributed_revenue
       FROM attribution_touchpoints
       WHERE user_id = $1
         AND occurred_at >= $2::date
         AND occurred_at < ($3::date + INTERVAL '1 day')`,
      [userId, period.periodStart, period.periodEnd]
    ),
    pool.query(
      `SELECT
         COALESCE(NULLIF(t.source_type, ''), 'other') AS source_type,
         COALESCE(NULLIF(t.source_reference, ''), 'unknown') AS source_reference,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'imported')::int AS imported_leads,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'contacted')::int AS contacted_leads,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'replied')::int AS replied_leads,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'meeting')::int AS meeting_leads,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'opportunity')::int AS opportunity_leads,
         COALESCE(SUM(t.attributed_value) FILTER (WHERE t.attribution_stage = 'opportunity'), 0)::numeric(14,2) AS attributed_revenue
       FROM attribution_touchpoints t
       WHERE t.user_id = $1
         AND t.occurred_at >= $2::date
         AND t.occurred_at < ($3::date + INTERVAL '1 day')
       GROUP BY 1, 2
       ORDER BY attributed_revenue DESC, opportunity_leads DESC, meeting_leads DESC, contacted_leads DESC
       LIMIT 25`,
      [userId, period.periodStart, period.periodEnd]
    ),
    pool.query(
      `SELECT
         t.sequence_id,
         COALESCE(s.name, 'Unknown sequence') AS sequence_name,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'contacted')::int AS contacted_leads,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'replied')::int AS replied_leads,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'meeting')::int AS meeting_leads,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'opportunity')::int AS opportunity_leads,
         COALESCE(SUM(t.attributed_value) FILTER (WHERE t.attribution_stage = 'opportunity'), 0)::numeric(14,2) AS attributed_revenue
       FROM attribution_touchpoints t
       LEFT JOIN sequences s ON s.id = t.sequence_id
       WHERE t.user_id = $1
         AND t.sequence_id IS NOT NULL
         AND t.occurred_at >= $2::date
         AND t.occurred_at < ($3::date + INTERVAL '1 day')
       GROUP BY t.sequence_id, s.name
       ORDER BY attributed_revenue DESC, opportunity_leads DESC, meeting_leads DESC
       LIMIT 25`,
      [userId, period.periodStart, period.periodEnd]
    ),
    pool.query(
      `SELECT
         t.lead_id,
         t.attribution_stage,
         t.attributed_value,
         l.title
       FROM attribution_touchpoints t
       LEFT JOIN outbound_leads l ON l.id = t.lead_id
       WHERE t.user_id = $1
         AND t.occurred_at >= $2::date
         AND t.occurred_at < ($3::date + INTERVAL '1 day')`,
      [userId, period.periodStart, period.periodEnd]
    ),
    pool.query(
      `SELECT
         COALESCE(NULLIF(t.source_type, ''), 'other') AS source_type,
         COALESCE(NULLIF(t.source_reference, ''), 'unknown') AS source_reference,
         COALESCE(t.sequence_id::text, 'unsequenced') AS sequence_key,
         COALESCE(s.name, 'Unsequenced') AS sequence_name,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'meeting')::int AS meetings,
         COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'opportunity')::int AS opportunities,
         COALESCE(SUM(t.attributed_value) FILTER (WHERE t.attribution_stage = 'opportunity'), 0)::numeric(14,2) AS attributed_revenue
       FROM attribution_touchpoints t
       LEFT JOIN sequences s ON s.id = t.sequence_id
       WHERE t.user_id = $1
         AND t.occurred_at >= $2::date
         AND t.occurred_at < ($3::date + INTERVAL '1 day')
       GROUP BY 1, 2, 3, 4
       HAVING COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage IN ('meeting', 'opportunity')) > 0
       ORDER BY attributed_revenue DESC, opportunities DESC, meetings DESC
       LIMIT 20`,
      [userId, period.periodStart, period.periodEnd]
    ),
    getAverageClosedWonValue(userId),
  ]);

  const overview = overviewRes.rows[0] || {};
  const importedLeads = Number(overview.imported_leads || 0);
  const contactedLeads = Number(overview.contacted_leads || 0);
  const repliedLeads = Number(overview.replied_leads || 0);
  const meetingLeads = Number(overview.meeting_leads || 0);
  const opportunityLeads = Number(overview.opportunity_leads || 0);
  const attributedRevenue = round2(Number(overview.attributed_revenue || 0));

  const bySource = sourceRes.rows.map((row) => {
    const imported = Number(row.imported_leads || 0);
    const contacted = Number(row.contacted_leads || 0);
    const replied = Number(row.replied_leads || 0);
    const meetings = Number(row.meeting_leads || 0);
    const opportunities = Number(row.opportunity_leads || 0);
    const revenue = round2(Number(row.attributed_revenue || 0));
    return {
      sourceType: row.source_type,
      sourceReference: row.source_reference,
      importedLeads: imported,
      contactedLeads: contacted,
      repliedLeads: replied,
      meetingLeads: meetings,
      opportunityLeads: opportunities,
      attributedRevenue: revenue,
      meetingRateFromImported: safeRate(meetings, imported),
      opportunityRateFromImported: safeRate(opportunities, imported),
      replyRateFromContacted: safeRate(replied, contacted),
      valuePerImportedLead: imported > 0 ? round2(revenue / imported) : 0,
      valuePerOpportunity: opportunities > 0 ? round2(revenue / opportunities) : 0,
    };
  });

  const bySequence = sequenceRes.rows.map((row) => {
    const contacted = Number(row.contacted_leads || 0);
    const replied = Number(row.replied_leads || 0);
    const meetings = Number(row.meeting_leads || 0);
    const opportunities = Number(row.opportunity_leads || 0);
    const revenue = round2(Number(row.attributed_revenue || 0));
    return {
      sequenceId: row.sequence_id,
      sequenceName: row.sequence_name,
      contactedLeads: contacted,
      repliedLeads: replied,
      meetingLeads: meetings,
      opportunityLeads: opportunities,
      attributedRevenue: revenue,
      replyRateFromContacted: safeRate(replied, contacted),
      meetingRateFromContacted: safeRate(meetings, contacted),
      opportunityRateFromContacted: safeRate(opportunities, contacted),
    };
  });

  const personaBuckets = new Map();
  for (const row of personaRowsRes.rows) {
    const persona = classifyPersonaTitle(row.title);
    if (!personaBuckets.has(persona)) {
      personaBuckets.set(persona, {
        persona,
        leadIds: new Set(),
        contactedLeadIds: new Set(),
        repliedLeadIds: new Set(),
        meetingLeadIds: new Set(),
        opportunityLeadIds: new Set(),
        attributedRevenue: 0,
      });
    }
    const bucket = personaBuckets.get(persona);
    const leadId = row.lead_id;
    if (leadId) bucket.leadIds.add(leadId);

    const stage = String(row.attribution_stage || '').trim().toLowerCase();
    if (stage === 'contacted' && leadId) bucket.contactedLeadIds.add(leadId);
    if (stage === 'replied' && leadId) bucket.repliedLeadIds.add(leadId);
    if (stage === 'meeting' && leadId) bucket.meetingLeadIds.add(leadId);
    if (stage === 'opportunity' && leadId) {
      bucket.opportunityLeadIds.add(leadId);
      bucket.attributedRevenue += Number(row.attributed_value || 0);
    }
  }

  const byPersona = [...personaBuckets.values()]
    .map((bucket) => {
      const leads = bucket.leadIds.size;
      const contacted = bucket.contactedLeadIds.size;
      const replied = bucket.repliedLeadIds.size;
      const meetings = bucket.meetingLeadIds.size;
      const opportunities = bucket.opportunityLeadIds.size;
      const revenue = round2(bucket.attributedRevenue);
      return {
        persona: bucket.persona,
        leads,
        contactedLeads: contacted,
        repliedLeads: replied,
        meetingLeads: meetings,
        opportunityLeads: opportunities,
        attributedRevenue: revenue,
        meetingRateFromLeads: safeRate(meetings, leads),
        opportunityRateFromLeads: safeRate(opportunities, leads),
      };
    })
    .sort((a, b) => b.attributedRevenue - a.attributedRevenue || b.opportunityLeads - a.opportunityLeads || b.meetingLeads - a.meetingLeads)
    .slice(0, 10);

  const lineage = lineageRes.rows.map((row) => ({
    sourceType: row.source_type,
    sourceReference: row.source_reference,
    sequenceKey: row.sequence_key,
    sequenceName: row.sequence_name,
    meetings: Number(row.meetings || 0),
    opportunities: Number(row.opportunities || 0),
    attributedRevenue: round2(Number(row.attributed_revenue || 0)),
  }));

  return {
    period: {
      type: period.periodType,
      start: period.periodStart,
      end: period.periodEnd,
    },
    overview: {
      importedLeads,
      contactedLeads,
      repliedLeads,
      meetingLeads,
      opportunityLeads,
      attributedRevenue,
      meetingRateFromImported: safeRate(meetingLeads, importedLeads),
      opportunityRateFromImported: safeRate(opportunityLeads, importedLeads),
      replyRateFromContacted: safeRate(repliedLeads, contactedLeads),
      valuePerImportedLead: importedLeads > 0 ? round2(attributedRevenue / importedLeads) : 0,
      valuePerOpportunity: opportunityLeads > 0 ? round2(attributedRevenue / opportunityLeads) : 0,
      estimatedSpend: 0,
    },
    bySource,
    bySequence,
    byPersona,
    lineage,
    assumptions: {
      attributionModel: 'event_touchpoints',
      stageOrder: ATTRIBUTION_STAGE_ORDER,
      opportunityValueFallback: round2(baselineValue),
      estimatedSpendModel: 'manual_cost_tracking_pending',
    },
  };
}

router.use(auth);

/**
 * POST /api/outbound/leads/import/csv
 */
router.post('/leads/import/csv', upload.single('file'), async (req, res) => {
  const sourceType = VALID_SOURCE_TYPES.has(req.body.sourceType) ? req.body.sourceType : 'csv';
  const sourceReference = req.body.sourceReference || null;
  const sourceConfidence = Number(req.body.sourceConfidence || 80);

  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required.' });
  }

  const importJob = await pool.query(
    `INSERT INTO lead_import_jobs (user_id, filename, status)
     VALUES ($1, $2, 'processing')
     RETURNING id`,
    [req.user.id, req.file.originalname || 'upload.csv']
  );

  const jobId = importJob.rows[0].id;

  try {
    const csvText = req.file.buffer.toString('utf8');
    const rows = parseCSV(csvText);

    let importedRows = 0;
    let duplicateRows = 0;
    let failedRows = 0;
    const errorSample = [];

    for (const row of rows) {
      try {
        const lead = buildLeadFromRow(row);
        if (!lead.name || lead.name === 'Unknown') {
          throw new Error('Lead is missing name/first_name fields');
        }

        const dedupeKey = computeDedupeKey(lead);
        const score = scoreLead(lead);

        const existing = await pool.query(
          `SELECT id FROM outbound_leads WHERE user_id = $1 AND dedupe_key = $2`,
          [req.user.id, dedupeKey]
        );

        if (existing.rows.length > 0) {
          duplicateRows++;
          continue;
        }

        const inserted = await pool.query(
          `INSERT INTO outbound_leads
            (user_id, source_type, source_reference, source_confidence, is_synthetic,
             name, first_name, last_name, email, phone, company, title, linkedin_url,
             website, location, notes, raw_data, dedupe_key,
             fit_score, intent_score, total_score, status, next_recommended_action)
           VALUES
            ($1, $2, $3, $4, FALSE,
             $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22)
           RETURNING id`,
          [
            req.user.id,
            sourceType,
            sourceReference,
            Math.max(0, Math.min(100, sourceConfidence)),
            lead.name,
            lead.first_name,
            lead.last_name,
            lead.email,
            lead.phone,
            lead.company,
            lead.title,
            lead.linkedin_url,
            lead.website,
            lead.location,
            lead.notes,
            JSON.stringify(row),
            dedupeKey,
            score.fitScore,
            score.intentScore,
            score.totalScore,
            score.status,
            score.nextRecommendedAction,
          ]
        );

        importedRows++;
        await recordLeadScoreHistory({
          userId: req.user.id,
          leadId: inserted.rows[0].id,
          score,
          source: 'import',
        });
        await logLeadEvent({
          userId: req.user.id,
          leadId: inserted.rows[0].id,
          eventType: 'lead_imported',
          metadata: { sourceType, sourceReference },
        });
      } catch (err) {
        failedRows++;
        if (errorSample.length < 20) {
          errorSample.push({ row, error: err.message });
        }
      }
    }

    await pool.query(
      `UPDATE lead_import_jobs
       SET status = 'completed',
           total_rows = $1,
           imported_rows = $2,
           duplicate_rows = $3,
           failed_rows = $4,
           error_sample = $5,
           completed_at = NOW()
       WHERE id = $6`,
      [rows.length, importedRows, duplicateRows, failedRows, JSON.stringify(errorSample), jobId]
    );

    logAction(
      req.user.id,
      req.user.email,
      'outbound_import_csv',
      'outbound_leads',
      null,
      req.file.originalname || 'upload.csv',
      {
        jobId,
        totalRows: rows.length,
        importedRows,
        duplicateRows,
        failedRows,
      }
    );

    return res.status(201).json({
      jobId,
      status: 'completed',
      totalRows: rows.length,
      importedRows,
      duplicateRows,
      failedRows,
      errorSample,
    });
  } catch (err) {
    await pool.query(
      `UPDATE lead_import_jobs
       SET status = 'failed',
           failed_rows = failed_rows + 1,
           error_sample = jsonb_build_array(jsonb_build_object('error', $1)),
           completed_at = NOW()
       WHERE id = $2`,
      [err.message, jobId]
    );
    return res.status(500).json({
      error: 'Failed to import CSV',
      message: err.message,
      jobId,
    });
  }
});

/**
 * GET /api/outbound/leads/import/:jobId/status
 */
router.get('/leads/import/:jobId/status', async (req, res) => {
  const result = await pool.query(
    `SELECT id, status, filename, total_rows, imported_rows, duplicate_rows, failed_rows,
            error_sample, created_at, completed_at
     FROM lead_import_jobs
     WHERE id = $1 AND user_id = $2`,
    [req.params.jobId, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Import job not found.' });
  }

  return res.json(result.rows[0]);
});

/**
 * GET /api/outbound/leads
 */
router.get('/leads', async (req, res) => {
  const { status, minScore = 0, search = '', limit = 100 } = req.query;
  await syncDataQualityIssuesForUser(req.user.id);

  const params = [req.user.id, Number(minScore)];
  let sql = `
    SELECT
      l.*,
      COALESCE(issue_counts.open_issue_count, 0)::int AS open_issue_count,
      COALESCE(issue_counts.open_blocking_issue_count, 0)::int AS open_blocking_issue_count
    FROM outbound_leads l
    LEFT JOIN (
      SELECT
        lead_id,
        COUNT(*) FILTER (WHERE status = 'open')::int AS open_issue_count,
        COUNT(*) FILTER (WHERE status = 'open' AND is_blocking = TRUE)::int AS open_blocking_issue_count
      FROM data_quality_issues
      WHERE user_id = $1
      GROUP BY lead_id
    ) issue_counts ON issue_counts.lead_id = l.id
    WHERE l.user_id = $1
      AND l.total_score >= $2
  `;

  if (status) {
    params.push(status);
    sql += ` AND l.status = $${params.length}`;
  }

  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    sql += ` AND (
      l.name ILIKE $${idx}
      OR COALESCE(l.company, '') ILIKE $${idx}
      OR COALESCE(l.title, '') ILIKE $${idx}
      OR COALESCE(l.email, '') ILIKE $${idx}
    )`;
  }

  params.push(Math.min(500, Math.max(1, Number(limit))));
  sql += ` ORDER BY l.total_score DESC, l.created_at DESC LIMIT $${params.length}`;

  const result = await pool.query(sql, params);
  return res.json({ total: result.rows.length, leads: result.rows });
});

/**
 * GET /api/outbound/data-quality/issues
 * Query: status=open|resolved|dismissed, issueType, limit
 */
router.get('/data-quality/issues', async (req, res) => {
  const status = String(req.query.status || 'open').trim().toLowerCase();
  const issueType = String(req.query.issueType || '').trim().toLowerCase();
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

  if (status && !VALID_DATA_QUALITY_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid data quality status filter.' });
  }
  if (issueType && !VALID_DATA_QUALITY_ISSUE_TYPES.has(issueType)) {
    return res.status(400).json({ error: 'Invalid data quality issueType filter.' });
  }

  await syncDataQualityIssuesForUser(req.user.id);

  const params = [req.user.id];
  const filters = ['i.user_id = $1'];
  if (status) {
    params.push(status);
    filters.push(`i.status = $${params.length}`);
  }
  if (issueType) {
    params.push(issueType);
    filters.push(`i.issue_type = $${params.length}`);
  }
  params.push(limit);

  const [issuesRes, summaryRes] = await Promise.all([
    pool.query(
      `SELECT
         i.*,
         l.name AS lead_name,
         l.email AS lead_email,
         l.company AS lead_company,
         l.title AS lead_title,
         l.status AS lead_status
       FROM data_quality_issues i
       LEFT JOIN outbound_leads l ON l.id = i.lead_id
       WHERE ${filters.join(' AND ')}
       ORDER BY
         CASE i.severity
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           ELSE 3
         END,
         i.updated_at DESC
       LIMIT $${params.length}`,
      params
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
         COUNT(*) FILTER (WHERE status = 'open' AND is_blocking = TRUE)::int AS open_blocking_count,
         COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved_count,
         COUNT(*) FILTER (WHERE status = 'dismissed')::int AS dismissed_count
       FROM data_quality_issues
       WHERE user_id = $1`,
      [req.user.id]
    ),
  ]);

  return res.json({
    total: issuesRes.rows.length,
    issues: issuesRes.rows.map(mapDataQualityIssueRow),
    summary: summaryRes.rows[0] || {
      open_count: 0,
      open_blocking_count: 0,
      resolved_count: 0,
      dismissed_count: 0,
    },
  });
});

/**
 * PATCH /api/outbound/data-quality/issues/:id/status
 * Body: { status: 'open'|'resolved'|'dismissed' }
 */
router.patch('/data-quality/issues/:id/status', async (req, res) => {
  const status = String(req.body.status || '').trim().toLowerCase();
  if (!VALID_DATA_QUALITY_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  const updatedRes = await pool.query(
    `UPDATE data_quality_issues
     SET status = $1,
         resolved_at = CASE WHEN $1 IN ('resolved', 'dismissed') THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $2
       AND user_id = $3
     RETURNING *`,
    [status, req.params.id, req.user.id]
  );

  if (!updatedRes.rows.length) {
    return res.status(404).json({ error: 'Data quality issue not found.' });
  }

  logAction(req.user.id, req.user.email, 'outbound_data_quality_issue_status_updated', 'data_quality_issue', req.params.id, null, {
    status,
  });

  const issueRow = updatedRes.rows[0];
  const leadRes = issueRow.lead_id
    ? await pool.query(
        `SELECT id AS lead_id, name AS lead_name, email AS lead_email, company AS lead_company, title AS lead_title, status AS lead_status
         FROM outbound_leads
         WHERE id = $1
           AND user_id = $2
         LIMIT 1`,
        [issueRow.lead_id, req.user.id]
      )
    : { rows: [] };

  return res.json(mapDataQualityIssueRow({ ...issueRow, ...(leadRes.rows[0] || {}) }));
});

/**
 * GET /api/outbound/sequences
 */
router.get('/sequences', async (req, res) => {
  const result = await pool.query(
    `SELECT
       s.id,
       s.name,
       s.description,
       s.created_at,
       s.updated_at,
       COUNT(st.id)::int AS step_count
     FROM sequences s
     LEFT JOIN sequence_steps st ON st.sequence_id = s.id
     WHERE s.user_id = $1
     GROUP BY s.id
     ORDER BY s.updated_at DESC`,
    [req.user.id]
  );

  return res.json({
    total: result.rows.length,
    sequences: result.rows,
  });
});

/**
 * GET /api/outbound/sequences/enrollments
 * Query: status, limit
 */
router.get('/sequences/enrollments', async (req, res) => {
  const status = String(req.query.status || '').trim().toLowerCase();
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

  if (status && !VALID_SEQUENCE_ENROLLMENT_STATES.has(status)) {
    return res.status(400).json({ error: 'Invalid enrollment status filter.' });
  }

  const params = [req.user.id];
  const filters = ['e.user_id = $1'];
  if (status) {
    params.push(status);
    filters.push(`e.status = $${params.length}`);
  }
  params.push(limit);

  const result = await pool.query(
    `SELECT
       e.*,
       s.name AS sequence_name,
       l.name AS lead_name,
       l.email AS lead_email,
       l.company AS lead_company,
       l.status AS lead_status,
       COALESCE(step_counts.total_steps, 0) AS total_steps
     FROM outbound_sequence_enrollments e
     JOIN sequences s ON s.id = e.sequence_id
     JOIN outbound_leads l ON l.id = e.lead_id
     LEFT JOIN (
       SELECT sequence_id, COUNT(*)::int AS total_steps
       FROM sequence_steps
       GROUP BY sequence_id
     ) step_counts ON step_counts.sequence_id = e.sequence_id
     WHERE ${filters.join(' AND ')}
     ORDER BY e.updated_at DESC
     LIMIT $${params.length}`,
    params
  );

  return res.json({
    total: result.rows.length,
    enrollments: result.rows,
  });
});

/**
 * POST /api/outbound/sequences/:id/enroll
 * Body: { leadId }
 */
router.post('/sequences/:id/enroll', async (req, res) => {
  const sequenceId = req.params.id;
  const leadId = String(req.body.leadId || '').trim();

  if (!leadId) {
    return res.status(400).json({ error: 'leadId is required.' });
  }

  const sequenceRes = await pool.query(
    `SELECT id, name
     FROM sequences
     WHERE id = $1
       AND user_id = $2`,
    [sequenceId, req.user.id]
  );
  if (!sequenceRes.rows.length) {
    return res.status(404).json({ error: 'Sequence not found.' });
  }

  const stepsRes = await pool.query(
    `SELECT COUNT(*)::int AS total_steps
     FROM sequence_steps
     WHERE sequence_id = $1`,
    [sequenceId]
  );
  const totalSteps = Number(stepsRes.rows[0]?.total_steps || 0);
  if (totalSteps === 0) {
    return res.status(409).json({ error: 'Sequence has no steps yet.' });
  }

  const leadRes = await pool.query(
    `SELECT
       id,
       name,
       email,
       linkedin_url,
       company,
       title,
       source_confidence,
       status,
       suppression_reason,
       created_at,
       updated_at
     FROM outbound_leads
     WHERE id = $1
       AND user_id = $2`,
    [leadId, req.user.id]
  );
  if (!leadRes.rows.length) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  const lead = leadRes.rows[0];
  if (lead.status === 'suppressed' || lead.suppression_reason) {
    return res.status(409).json({ error: 'Suppressed leads cannot be enrolled in sequences.' });
  }

  let duplicateGroup = null;
  const normalizedName = normalizeIssueToken(lead.name);
  const normalizedCompany = normalizeIssueToken(lead.company);
  if (normalizedName && normalizedCompany) {
    const duplicateRes = await pool.query(
      `SELECT ARRAY_AGG(id ORDER BY updated_at DESC, created_at DESC) AS lead_ids
       FROM outbound_leads
       WHERE user_id = $1
         AND LOWER(REGEXP_REPLACE(COALESCE(name, ''), '[^a-z0-9]+', '', 'g')) = $2
         AND LOWER(REGEXP_REPLACE(COALESCE(company, ''), '[^a-z0-9]+', '', 'g')) = $3`,
      [req.user.id, normalizedName, normalizedCompany]
    );
    const duplicateLeadIds = duplicateRes.rows[0]?.lead_ids || [];
    if (duplicateLeadIds.length > 1) {
      duplicateGroup = {
        groupKey: `${normalizedName}:${normalizedCompany}`,
        leadIds: duplicateLeadIds,
        suggestedPrimaryLeadId: duplicateLeadIds[0],
      };
    }
  }

  const leadIssues = buildLeadDataQualityIssueCandidates(lead, { duplicateGroup });
  await upsertDataQualityIssues(req.user.id, leadIssues);
  const blockingIssues = leadIssues.filter((issue) => DATA_QUALITY_BLOCKING_TYPES.has(issue.issueType));
  if (blockingIssues.length) {
    return res.status(409).json({
      error: 'Lead failed data quality guardrails before enrollment.',
      code: 'data_quality_block',
      blockers: blockingIssues.map((issue) => ({
        issueType: issue.issueType,
        severity: issue.severity,
        details: issue.details || {},
      })),
    });
  }

  const openRes = await pool.query(
    `SELECT e.id, e.sequence_id, e.status, s.name AS sequence_name
     FROM outbound_sequence_enrollments e
     JOIN sequences s ON s.id = e.sequence_id
     WHERE e.user_id = $1
       AND e.lead_id = $2
       AND e.status IN ('active', 'paused')
     LIMIT 1`,
    [req.user.id, leadId]
  );
  if (openRes.rows.length) {
    const open = openRes.rows[0];
    return res.status(409).json({
      error: `Lead already has an ${open.status} sequence enrollment.`,
      enrollmentId: open.id,
      sequenceId: open.sequence_id,
      sequenceName: open.sequence_name,
    });
  }

  try {
    const insertedRes = await pool.query(
      `INSERT INTO outbound_sequence_enrollments
        (user_id, sequence_id, lead_id, status, current_step, next_step_due_at)
       VALUES ($1, $2, $3, 'active', 1, NOW())
       RETURNING id`,
      [req.user.id, sequenceId, leadId]
    );

    const enrollmentId = insertedRes.rows[0].id;

    await recordSequenceTransition({
      enrollmentId,
      userId: req.user.id,
      fromState: null,
      toState: 'active',
      reason: 'Manual enroll',
      triggerSource: 'manual',
      metadata: { sequenceId, leadId },
    });

    await pool.query(
      `UPDATE outbound_leads
       SET status = CASE
            WHEN status IN ('new', 'qualified') THEN 'queued'
            ELSE status
          END,
          updated_at = NOW()
       WHERE id = $1
         AND user_id = $2`,
      [leadId, req.user.id]
    );

    await logLeadEvent({
      userId: req.user.id,
      leadId,
      eventType: 'sequence_enrolled',
      metadata: { sequenceId, enrollmentId },
    });

    logAction(
      req.user.id,
      req.user.email,
      'outbound_sequence_enrolled',
      'outbound_sequence_enrollment',
      enrollmentId,
      sequenceRes.rows[0].name,
      { leadId }
    );

    const enrollment = await getEnrollmentRecord(req.user.id, enrollmentId);
    return res.status(201).json(enrollment);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Lead already has an open sequence enrollment.' });
    }
    return res.status(500).json({ error: 'Failed to enroll lead into sequence.' });
  }
});

/**
 * PATCH /api/outbound/sequences/enrollments/:id/state
 * Body: { state, reason? }
 */
router.patch('/sequences/enrollments/:id/state', async (req, res) => {
  const enrollmentId = req.params.id;
  const nextState = String(req.body.state || '').trim().toLowerCase();
  const reason = req.body.reason ? String(req.body.reason).trim() : '';

  if (!VALID_SEQUENCE_ENROLLMENT_STATES.has(nextState)) {
    return res.status(400).json({ error: 'Invalid state.' });
  }

  const existing = await getEnrollmentRecord(req.user.id, enrollmentId);
  if (!existing) {
    return res.status(404).json({ error: 'Sequence enrollment not found.' });
  }

  const currentState = String(existing.status || '').toLowerCase();
  if (currentState === nextState) {
    return res.json(existing);
  }

  const allowedTargets = ALLOWED_MANUAL_SEQUENCE_TRANSITIONS[currentState] || new Set();
  if (!allowedTargets.has(nextState)) {
    return res.status(409).json({
      error: `Cannot transition enrollment from ${currentState} to ${nextState}.`,
    });
  }

  if (nextState === 'active' && (existing.lead_status === 'suppressed' || existing.suppression_reason)) {
    return res.status(409).json({
      error: 'Cannot resume sequence while lead is suppressed.',
    });
  }

  const defaultReason =
    nextState === 'paused' ? 'Manual pause' : nextState === 'stopped' ? 'Manual stop' : 'Manual state update';
  const finalReason = reason || defaultReason;

  await pool.query(
    `UPDATE outbound_sequence_enrollments
     SET status = $1,
         pause_reason = CASE
           WHEN $1 = 'paused' THEN $2
           WHEN $1 = 'active' THEN NULL
           ELSE pause_reason
         END,
         stop_reason = CASE
           WHEN $1 = 'stopped' THEN $2
           ELSE stop_reason
         END,
         paused_at = CASE WHEN $1 = 'paused' THEN NOW() ELSE paused_at END,
         resumed_at = CASE WHEN $1 = 'active' THEN NOW() ELSE resumed_at END,
         stopped_at = CASE WHEN $1 = 'stopped' THEN NOW() ELSE stopped_at END,
         completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
         updated_at = NOW(),
         last_transition_at = NOW()
     WHERE id = $3
       AND user_id = $4`,
    [nextState, finalReason, enrollmentId, req.user.id]
  );

  await recordSequenceTransition({
    enrollmentId,
    userId: req.user.id,
    fromState: currentState,
    toState: nextState,
    reason: finalReason,
    triggerSource: 'manual',
    metadata: { leadId: existing.lead_id, sequenceId: existing.sequence_id },
  });

  await logLeadEvent({
    userId: req.user.id,
    leadId: existing.lead_id,
    eventType: 'sequence_state_changed',
    metadata: {
      enrollmentId,
      sequenceId: existing.sequence_id,
      fromState: currentState,
      toState: nextState,
      reason: finalReason,
    },
  });

  logAction(
    req.user.id,
    req.user.email,
    'outbound_sequence_state_changed',
    'outbound_sequence_enrollment',
    enrollmentId,
    existing.sequence_name,
    {
      leadId: existing.lead_id,
      fromState: currentState,
      toState: nextState,
      reason: finalReason,
    }
  );

  const updated = await getEnrollmentRecord(req.user.id, enrollmentId);
  return res.json(updated);
});

/**
 * GET /api/outbound/workflows/rules
 */
router.get('/workflows/rules', async (req, res) => {
  const includeDisabled = String(req.query.includeDisabled || '').trim().toLowerCase() === 'true';
  const params = [req.user.id];
  const filters = ['user_id = $1'];
  if (!includeDisabled) {
    filters.push('enabled = TRUE');
  }

  const result = await pool.query(
    `SELECT id, user_id, name, description, enabled, trigger_event, priority, conditions, true_actions, false_actions,
            last_tested_at, created_at, updated_at
     FROM workflow_rules
     WHERE ${filters.join(' AND ')}
     ORDER BY priority ASC, created_at DESC`,
    params
  );

  return res.json({
    total: result.rows.length,
    rules: result.rows,
  });
});

/**
 * POST /api/outbound/workflows/rules
 */
router.post('/workflows/rules', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = req.body.description ? String(req.body.description).trim() : null;
  const triggerEvent = String(req.body.triggerEvent || '').trim();
  const priority = Math.max(0, Math.min(1000, Number(req.body.priority || 100)));
  const enabled = req.body.enabled == null ? true : Boolean(req.body.enabled);
  const conditions = isPlainObject(req.body.conditions) ? req.body.conditions : {};

  const rawTrueActions = Array.isArray(req.body.trueActions) ? req.body.trueActions : [];
  const rawFalseActions = Array.isArray(req.body.falseActions) ? req.body.falseActions : [];
  const trueActions = normalizeRuleActions(rawTrueActions);
  const falseActions = normalizeRuleActions(rawFalseActions);

  if (!name) {
    return res.status(400).json({ error: 'Rule name is required.' });
  }
  if (!VALID_RULE_TRIGGER_EVENTS.has(triggerEvent)) {
    return res.status(400).json({ error: 'Invalid triggerEvent for outbound workflow rule.' });
  }
  if (rawTrueActions.length !== trueActions.length || rawFalseActions.length !== falseActions.length) {
    return res.status(400).json({ error: 'One or more actions are invalid.' });
  }

  const result = await pool.query(
    `INSERT INTO workflow_rules
      (user_id, name, description, enabled, trigger_event, priority, conditions, true_actions, false_actions)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
     RETURNING *`,
    [
      req.user.id,
      name,
      description,
      enabled,
      triggerEvent,
      priority,
      JSON.stringify(conditions),
      JSON.stringify(trueActions),
      JSON.stringify(falseActions),
    ]
  );

  const rule = result.rows[0];
  logAction(req.user.id, req.user.email, 'outbound_workflow_rule_created', 'workflow_rule', rule.id, rule.name, {
    triggerEvent: rule.trigger_event,
    priority: rule.priority,
    enabled: rule.enabled,
  });

  return res.status(201).json(rule);
});

/**
 * PATCH /api/outbound/workflows/rules/:id
 */
router.patch('/workflows/rules/:id', async (req, res) => {
  const existingRes = await pool.query(
    `SELECT *
     FROM workflow_rules
     WHERE id = $1
       AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!existingRes.rows.length) {
    return res.status(404).json({ error: 'Workflow rule not found.' });
  }
  const current = existingRes.rows[0];

  const name = req.body.name == null ? current.name : String(req.body.name).trim();
  const description = req.body.description == null ? current.description : String(req.body.description).trim();
  const triggerEvent =
    req.body.triggerEvent == null ? current.trigger_event : String(req.body.triggerEvent || '').trim();
  const priority =
    req.body.priority == null ? Number(current.priority) : Math.max(0, Math.min(1000, Number(req.body.priority)));
  const enabled = req.body.enabled == null ? Boolean(current.enabled) : Boolean(req.body.enabled);
  const conditions = req.body.conditions == null ? current.conditions : isPlainObject(req.body.conditions) ? req.body.conditions : {};

  if (!name) {
    return res.status(400).json({ error: 'Rule name is required.' });
  }
  if (!VALID_RULE_TRIGGER_EVENTS.has(triggerEvent)) {
    return res.status(400).json({ error: 'Invalid triggerEvent for outbound workflow rule.' });
  }

  const rawTrueActions = req.body.trueActions == null ? current.true_actions : req.body.trueActions;
  const rawFalseActions = req.body.falseActions == null ? current.false_actions : req.body.falseActions;
  const trueActions = normalizeRuleActions(rawTrueActions);
  const falseActions = normalizeRuleActions(rawFalseActions);

  if (
    (Array.isArray(rawTrueActions) && rawTrueActions.length !== trueActions.length) ||
    (Array.isArray(rawFalseActions) && rawFalseActions.length !== falseActions.length)
  ) {
    return res.status(400).json({ error: 'One or more actions are invalid.' });
  }

  const updatedRes = await pool.query(
    `UPDATE workflow_rules
     SET name = $1,
         description = $2,
         enabled = $3,
         trigger_event = $4,
         priority = $5,
         conditions = $6::jsonb,
         true_actions = $7::jsonb,
         false_actions = $8::jsonb,
         updated_at = NOW()
     WHERE id = $9
       AND user_id = $10
     RETURNING *`,
    [
      name,
      description || null,
      enabled,
      triggerEvent,
      priority,
      JSON.stringify(conditions),
      JSON.stringify(trueActions),
      JSON.stringify(falseActions),
      req.params.id,
      req.user.id,
    ]
  );

  const updated = updatedRes.rows[0];
  logAction(req.user.id, req.user.email, 'outbound_workflow_rule_updated', 'workflow_rule', updated.id, updated.name, {
    triggerEvent: updated.trigger_event,
    priority: updated.priority,
    enabled: updated.enabled,
  });

  return res.json(updated);
});

/**
 * GET /api/outbound/workflows/rules/:id/runs
 */
router.get('/workflows/rules/:id/runs', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const existingRes = await pool.query(
    `SELECT id
     FROM workflow_rules
     WHERE id = $1
       AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!existingRes.rows.length) {
    return res.status(404).json({ error: 'Workflow rule not found.' });
  }

  const runsRes = await pool.query(
    `SELECT *
     FROM workflow_rule_runs
     WHERE rule_id = $1
       AND user_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [req.params.id, req.user.id, limit]
  );

  return res.json({
    total: runsRes.rows.length,
    runs: runsRes.rows,
  });
});

/**
 * POST /api/outbound/workflows/rules/:id/test
 * Body: { leadId?, eventData?, triggerEvent?, applyActions?: boolean }
 */
router.post('/workflows/rules/:id/test', async (req, res) => {
  const ruleRes = await pool.query(
    `SELECT *
     FROM workflow_rules
     WHERE id = $1
       AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!ruleRes.rows.length) {
    return res.status(404).json({ error: 'Workflow rule not found.' });
  }

  const rule = ruleRes.rows[0];
  const triggerEvent = req.body.triggerEvent
    ? String(req.body.triggerEvent).trim()
    : String(rule.trigger_event || '').trim();
  if (!VALID_RULE_TRIGGER_EVENTS.has(triggerEvent)) {
    return res.status(400).json({ error: 'Invalid triggerEvent for test run.' });
  }

  const leadId = req.body.leadId ? String(req.body.leadId).trim() : null;
  const applyActions = Boolean(req.body.applyActions);
  const eventData = isPlainObject(req.body.eventData) ? req.body.eventData : {};

  const ruleRuns = await runWorkflowRulesForEvent({
    userId: req.user.id,
    leadId,
    triggerEvent,
    eventData,
    triggerSource: 'manual_test',
    dryRun: !applyActions,
    limitToRuleId: rule.id,
    includeDisabled: true,
  });

  await pool.query(
    `UPDATE workflow_rules
     SET last_tested_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2`,
    [rule.id, req.user.id]
  );

  const summary = ruleRuns[0] || {
    ruleId: rule.id,
    matched: false,
    status: 'skipped',
    actionsExecuted: [],
  };

  logAction(req.user.id, req.user.email, 'outbound_workflow_rule_tested', 'workflow_rule', rule.id, rule.name, {
    triggerEvent,
    applyActions,
    status: summary.status,
  });

  return res.json({
    applyActions,
    triggerEvent,
    leadId,
    result: summary,
  });
});

/**
 * POST /api/outbound/campaigns
 * Body: { name, channels, audienceFilter, notes, leadIds }
 */
router.post('/campaigns', async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Campaign name is required.' });
  }

  const channels = normalizeCampaignChannels(req.body.channels);
  const audienceFilter = req.body.audienceFilter && typeof req.body.audienceFilter === 'object'
    ? req.body.audienceFilter
    : {};
  const notes = req.body.notes ? String(req.body.notes) : null;

  const campaignRes = await pool.query(
    `INSERT INTO outbound_campaigns (user_id, name, channels, audience_filter, notes, status)
     VALUES ($1, $2, $3::text[], $4::jsonb, $5, 'draft')
     RETURNING *`,
    [req.user.id, name, channels, JSON.stringify(audienceFilter), notes]
  );

  const campaign = campaignRes.rows[0];
  const leadIds = sanitizeUuidList(req.body.leadIds);
  let addedMembers = 0;

  if (leadIds.length > 0) {
    const membersRes = await pool.query(
      `INSERT INTO outbound_campaign_members (campaign_id, lead_id, member_status)
       SELECT $1, l.id, 'queued'
       FROM outbound_leads l
       WHERE l.user_id = $2
         AND l.id = ANY($3::uuid[])
       ON CONFLICT (campaign_id, lead_id) DO NOTHING
       RETURNING id`,
      [campaign.id, req.user.id, leadIds]
    );
    addedMembers = membersRes.rowCount;
  }

  await logLeadEvent({
    userId: req.user.id,
    leadId: null,
    eventType: 'campaign_created',
    metadata: {
      campaignId: campaign.id,
      channels,
      addedMembers,
    },
  });

  logAction(req.user.id, req.user.email, 'outbound_campaign_created', 'outbound_campaign', campaign.id, name, {
    channels,
    addedMembers,
  });

  return res.status(201).json({
    ...campaign,
    addedMembers,
  });
});

/**
 * GET /api/outbound/campaigns
 */
router.get('/campaigns', async (req, res) => {
  const { status = '', limit = 100 } = req.query;
  const params = [req.user.id];
  const filters = ['c.user_id = $1'];

  if (status) {
    params.push(String(status));
    filters.push(`c.status = $${params.length}`);
  }

  params.push(Math.min(500, Math.max(1, Number(limit))));

  const result = await pool.query(
    `SELECT
       c.*,
       COUNT(m.id)::int AS member_count,
       COALESCE(SUM(CASE WHEN m.member_status = 'queued' THEN 1 ELSE 0 END), 0)::int AS queued_count,
       COALESCE(SUM(CASE WHEN m.member_status IN ('contacted', 'replied', 'meeting', 'opportunity') THEN 1 ELSE 0 END), 0)::int AS engaged_count
     FROM outbound_campaigns c
     LEFT JOIN outbound_campaign_members m ON m.campaign_id = c.id
     WHERE ${filters.join(' AND ')}
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return res.json({
    total: result.rows.length,
    campaigns: result.rows,
  });
});

/**
 * GET /api/outbound/campaigns/:id
 */
router.get('/campaigns/:id', async (req, res) => {
  const campaignRes = await pool.query(
    `SELECT
       c.*,
       COUNT(m.id)::int AS member_count,
       COALESCE(SUM(CASE WHEN m.member_status = 'queued' THEN 1 ELSE 0 END), 0)::int AS queued_count,
       COALESCE(SUM(CASE WHEN m.member_status IN ('contacted', 'replied', 'meeting', 'opportunity') THEN 1 ELSE 0 END), 0)::int AS engaged_count
     FROM outbound_campaigns c
     LEFT JOIN outbound_campaign_members m ON m.campaign_id = c.id
     WHERE c.id = $1 AND c.user_id = $2
     GROUP BY c.id`,
    [req.params.id, req.user.id]
  );

  if (campaignRes.rows.length === 0) {
    return res.status(404).json({ error: 'Campaign not found.' });
  }

  const membersRes = await pool.query(
    `SELECT
       m.id,
       m.member_status,
       m.last_channel,
       m.added_at,
       m.updated_at,
       l.id AS lead_id,
       l.name,
       l.email,
       l.company,
       l.title,
       l.total_score,
       l.status AS lead_status
     FROM outbound_campaign_members m
     JOIN outbound_leads l ON l.id = m.lead_id
     WHERE m.campaign_id = $1
     ORDER BY m.added_at DESC`,
    [req.params.id]
  );

  return res.json({
    campaign: campaignRes.rows[0],
    members: membersRes.rows,
  });
});

/**
 * POST /api/outbound/campaigns/:id/members/add
 * Body: { leadIds: [] }
 */
router.post('/campaigns/:id/members/add', async (req, res) => {
  const leadIds = sanitizeUuidList(req.body.leadIds);
  if (leadIds.length === 0) {
    return res.status(400).json({ error: 'leadIds array is required.' });
  }

  const campaignCheck = await pool.query(
    `SELECT id, name FROM outbound_campaigns WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (campaignCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Campaign not found.' });
  }

  const membersRes = await pool.query(
    `INSERT INTO outbound_campaign_members (campaign_id, lead_id, member_status)
     SELECT $1, l.id, 'queued'
     FROM outbound_leads l
     WHERE l.user_id = $2
       AND l.id = ANY($3::uuid[])
     ON CONFLICT (campaign_id, lead_id) DO NOTHING
     RETURNING id`,
    [req.params.id, req.user.id, leadIds]
  );

  await pool.query(
    `UPDATE outbound_campaigns
     SET updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );

  logAction(
    req.user.id,
    req.user.email,
    'outbound_campaign_members_added',
    'outbound_campaign',
    req.params.id,
    campaignCheck.rows[0].name,
    { addedMembers: membersRes.rowCount }
  );

  return res.status(201).json({
    campaignId: req.params.id,
    addedMembers: membersRes.rowCount,
  });
});

/**
 * PATCH /api/outbound/campaigns/:id/status
 * Body: { status }
 */
router.patch('/campaigns/:id/status', async (req, res) => {
  const nextStatus = String(req.body.status || '').trim();
  if (!VALID_CAMPAIGN_STATUSES.has(nextStatus)) {
    return res.status(400).json({ error: 'Invalid campaign status.' });
  }

  const existingRes = await pool.query(
    `SELECT id, name, status FROM outbound_campaigns WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (existingRes.rows.length === 0) {
    return res.status(404).json({ error: 'Campaign not found.' });
  }

  const updatedRes = await pool.query(
    `UPDATE outbound_campaigns
     SET status = $1::varchar,
         updated_at = NOW(),
         started_at = CASE WHEN $1::varchar = 'active'::varchar AND started_at IS NULL THEN NOW() ELSE started_at END,
         completed_at = CASE WHEN $1::varchar = 'completed'::varchar THEN NOW() ELSE completed_at END
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [nextStatus, req.params.id, req.user.id]
  );

  const campaign = updatedRes.rows[0];
  logAction(req.user.id, req.user.email, 'outbound_campaign_status_updated', 'outbound_campaign', campaign.id, campaign.name, {
    from: existingRes.rows[0].status,
    to: campaign.status,
  });

  return res.json(campaign);
});

/**
 * PATCH /api/outbound/campaigns/:campaignId/members/:memberId/status
 * Body: { memberStatus, lastChannel }
 */
router.patch('/campaigns/:campaignId/members/:memberId/status', async (req, res) => {
  const memberStatus = String(req.body.memberStatus || '').trim();
  const lastChannel = req.body.lastChannel == null ? null : String(req.body.lastChannel).trim().toLowerCase();
  const statusReason = req.body.reason == null ? '' : String(req.body.reason).trim();

  if (!VALID_CAMPAIGN_MEMBER_STATUSES.has(memberStatus)) {
    return res.status(400).json({ error: 'Invalid memberStatus.' });
  }

  if (lastChannel && !VALID_CAMPAIGN_CHANNELS.has(lastChannel)) {
    return res.status(400).json({ error: 'Invalid lastChannel.' });
  }

  const updatedRes = await pool.query(
    `UPDATE outbound_campaign_members m
     SET member_status = $1,
         last_channel = $2,
         updated_at = NOW()
     FROM outbound_campaigns c
     WHERE m.id = $3
       AND m.campaign_id = c.id
       AND c.id = $4
       AND c.user_id = $5
     RETURNING m.*`,
    [memberStatus, lastChannel, req.params.memberId, req.params.campaignId, req.user.id]
  );

  if (updatedRes.rows.length === 0) {
    return res.status(404).json({ error: 'Campaign member not found.' });
  }

  await pool.query(
    `UPDATE outbound_campaigns
     SET updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [req.params.campaignId, req.user.id]
  );
  const updatedMember = updatedRes.rows[0];
  const mappedLeadStatus = CAMPAIGN_MEMBER_TO_LEAD_STATUS[memberStatus];
  const leadId = updatedMember.lead_id;
  let autoStoppedEnrollmentIds = [];

  if (mappedLeadStatus && leadId) {
    await pool.query(
      `UPDATE outbound_leads
       SET status = $1,
           suppression_reason = CASE
             WHEN $1 = 'suppressed' THEN COALESCE(NULLIF($2, ''), suppression_reason, 'Campaign suppression update')
             WHEN status = 'suppressed' THEN NULL
             ELSE suppression_reason
           END,
           updated_at = NOW()
       WHERE id = $3
         AND user_id = $4`,
      [mappedLeadStatus, statusReason, leadId, req.user.id]
    );
  }

  if (leadId) {
    await logLeadEvent({
      userId: req.user.id,
      leadId,
      eventType: 'campaign_member_status_changed',
      metadata: {
        campaignId: req.params.campaignId,
        memberId: req.params.memberId,
        memberStatus,
        lastChannel,
      },
    });
  }

  if (leadId && memberStatus === 'replied') {
    await logLeadEvent({
      userId: req.user.id,
      leadId,
      eventType: 'lead_replied',
      metadata: {
        campaignId: req.params.campaignId,
        memberId: req.params.memberId,
      },
    });
    autoStoppedEnrollmentIds = await autoStopOpenSequenceEnrollments({
      userId: req.user.id,
      leadId,
      reason: 'Auto-stopped after reply',
      triggerSource: 'campaign_member_status',
      metadata: {
        campaignId: req.params.campaignId,
        memberId: req.params.memberId,
        memberStatus,
      },
    });
  } else if (leadId && memberStatus === 'opportunity') {
    await logLeadEvent({
      userId: req.user.id,
      leadId,
      eventType: 'opportunity_created',
      metadata: {
        campaignId: req.params.campaignId,
        memberId: req.params.memberId,
      },
    });
  } else if (leadId && memberStatus === 'meeting') {
    await logLeadEvent({
      userId: req.user.id,
      leadId,
      eventType: 'meeting_booked',
      metadata: {
        campaignId: req.params.campaignId,
        memberId: req.params.memberId,
      },
    });
    autoStoppedEnrollmentIds = await autoStopOpenSequenceEnrollments({
      userId: req.user.id,
      leadId,
      reason: 'Auto-stopped after meeting booked',
      triggerSource: 'campaign_member_status',
      metadata: {
        campaignId: req.params.campaignId,
        memberId: req.params.memberId,
        memberStatus,
      },
    });
  } else if (leadId && memberStatus === 'suppressed') {
    await logLeadEvent({
      userId: req.user.id,
      leadId,
      eventType: 'lead_suppressed',
      metadata: {
        campaignId: req.params.campaignId,
        memberId: req.params.memberId,
        reason: statusReason || null,
      },
    });
    autoStoppedEnrollmentIds = await autoStopOpenSequenceEnrollments({
      userId: req.user.id,
      leadId,
      reason: 'Auto-stopped after suppression update',
      triggerSource: 'campaign_member_status',
      metadata: {
        campaignId: req.params.campaignId,
        memberId: req.params.memberId,
        memberStatus,
      },
    });
  }

  return res.json({
    ...updatedMember,
    autoStoppedEnrollmentIds,
  });
});

/**
 * POST /api/outbound/leads/:id/score
 */
router.post('/leads/:id/score', async (req, res) => {
  const leadRes = await pool.query(
    `SELECT * FROM outbound_leads WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );

  if (leadRes.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  const lead = leadRes.rows[0];
  const engagement = await computeEngagementSignals(req.user.id, lead.id);
  const score = scoreLead(lead, engagement);

  const updated = await pool.query(
    `UPDATE outbound_leads
     SET fit_score = $1,
         intent_score = $2,
         total_score = $3,
         status = $4,
         next_recommended_action = $5,
         updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [
      score.fitScore,
      score.intentScore,
      score.totalScore,
      score.status,
      score.nextRecommendedAction,
      req.params.id,
    ]
  );

  await logLeadEvent({
    userId: req.user.id,
    leadId: req.params.id,
    eventType: 'lead_scored',
    metadata: score,
  });

  await recordLeadScoreHistory({
    userId: req.user.id,
    leadId: req.params.id,
    score,
    source: 'manual_rescore',
  });

  return res.json(updated.rows[0]);
});

/**
 * GET /api/outbound/scoring/:leadId/explain
 * Phase 21 Slice 1: explainable scoring + score history timeline
 */
router.get('/scoring/:leadId/explain', async (req, res) => {
  const leadRes = await pool.query(
    `SELECT * FROM outbound_leads WHERE id = $1 AND user_id = $2`,
    [req.params.leadId, req.user.id]
  );
  if (leadRes.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  const lead = leadRes.rows[0];
  const engagement = await computeEngagementSignals(req.user.id, lead.id);
  const explanation = scoreLead(lead, engagement);

  const historyRes = await pool.query(
    `SELECT id, fit_score, intent_score, engagement_score, total_score, status, next_recommended_action, reasons, source, created_at
     FROM lead_score_history
     WHERE user_id = $1 AND lead_id = $2
     ORDER BY created_at DESC
     LIMIT 30`,
    [req.user.id, lead.id]
  );

  const latestHistory = historyRes.rows[0] || null;
  const previousHistory = historyRes.rows[1] || null;
  const scoreDelta = latestHistory && previousHistory
    ? Number(latestHistory.total_score) - Number(previousHistory.total_score)
    : null;

  return res.json({
    lead: {
      id: lead.id,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      status: lead.status,
      totalScore: lead.total_score,
      fitScore: lead.fit_score,
      intentScore: lead.intent_score,
      nextRecommendedAction: lead.next_recommended_action,
    },
    explanation,
    scoreDeltaFromPrevious: scoreDelta,
    history: historyRes.rows,
  });
});

/**
 * PATCH /api/outbound/leads/:id/suppression
 * Body: { suppressed: boolean, reason?: string }
 */
router.patch('/leads/:id/suppression', async (req, res) => {
  const suppressed = Boolean(req.body.suppressed);
  const reason = req.body.reason ? String(req.body.reason).trim() : null;

  const leadRes = await pool.query(
    `SELECT * FROM outbound_leads WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );

  if (leadRes.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  if (suppressed && !reason) {
    return res.status(400).json({ error: 'Suppression reason is required.' });
  }

  const updatedRes = await pool.query(
    `UPDATE outbound_leads
     SET status = CASE
          WHEN $1::boolean = TRUE THEN 'suppressed'
          WHEN status = 'suppressed' THEN 'new'
          ELSE status
        END,
        suppression_reason = CASE WHEN $1::boolean = TRUE THEN $2 ELSE NULL END,
        updated_at = NOW()
     WHERE id = $3 AND user_id = $4
     RETURNING *`,
    [suppressed, reason, req.params.id, req.user.id]
  );

  const updatedLead = updatedRes.rows[0];
  await logLeadEvent({
    userId: req.user.id,
    leadId: updatedLead.id,
    eventType: suppressed ? 'lead_suppressed' : 'lead_unsuppressed',
    metadata: { reason: suppressed ? reason : null },
  });
  const autoStoppedEnrollmentIds = suppressed
    ? await autoStopOpenSequenceEnrollments({
        userId: req.user.id,
        leadId: updatedLead.id,
        reason: 'Auto-stopped after suppression update',
        triggerSource: 'suppression_update',
        metadata: { reason },
      })
    : [];

  logAction(
    req.user.id,
    req.user.email,
    suppressed ? 'outbound_lead_suppressed' : 'outbound_lead_unsuppressed',
    'outbound_lead',
    updatedLead.id,
    updatedLead.name,
    { reason: suppressed ? reason : null }
  );

  return res.json({
    ...updatedLead,
    autoStoppedEnrollmentIds,
  });
});

/**
 * POST /api/outbound/leads/:id/outcome
 * Body: { outcome: 'replied'|'meeting'|'opportunity'|'hard_bounce', note?: string }
 */
router.post('/leads/:id/outcome', async (req, res) => {
  const outcome = String(req.body.outcome || '').trim().toLowerCase();
  const note = req.body.note ? String(req.body.note).trim() : null;
  const config = LEAD_OUTCOME_EVENT_MAP[outcome];

  if (!config) {
    return res.status(400).json({
      error: 'Invalid outcome. Use replied, meeting, opportunity, or hard_bounce.',
    });
  }

  const leadRes = await pool.query(
    `SELECT id, name
     FROM outbound_leads
     WHERE id = $1
       AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!leadRes.rows.length) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  const updatedRes = await pool.query(
    `UPDATE outbound_leads
     SET status = $1,
         suppression_reason = CASE
           WHEN $1 = 'disqualified' THEN COALESCE($2, suppression_reason, 'Hard bounce')
           WHEN status = 'suppressed' THEN NULL
           ELSE suppression_reason
         END,
         updated_at = NOW()
     WHERE id = $3
       AND user_id = $4
     RETURNING *`,
    [config.leadStatus, note, req.params.id, req.user.id]
  );
  const updatedLead = updatedRes.rows[0];

  await logLeadEvent({
    userId: req.user.id,
    leadId: req.params.id,
    eventType: config.eventType,
    metadata: {
      outcome,
      note,
    },
  });

  const autoStoppedEnrollmentIds = await autoStopOpenSequenceEnrollments({
    userId: req.user.id,
    leadId: req.params.id,
    reason: config.stopReason,
    triggerSource: 'lead_outcome',
    metadata: {
      outcome,
      note,
    },
  });

  logAction(req.user.id, req.user.email, 'outbound_lead_outcome', 'outbound_lead', req.params.id, updatedLead.name, {
    outcome,
    note,
    autoStoppedEnrollments: autoStoppedEnrollmentIds.length,
  });

  return res.json({
    lead: updatedLead,
    autoStoppedEnrollmentIds,
  });
});

/**
 * POST /api/outbound/drafts/generate
 * Body: { leadId, channel: 'email'|'linkedin' }
 */
router.post('/drafts/generate', async (req, res) => {
  const { leadId, channel = 'email' } = req.body;
  if (!leadId) return res.status(400).json({ error: 'leadId is required.' });
  if (!['email', 'linkedin'].includes(channel)) {
    return res.status(400).json({ error: 'channel must be email or linkedin.' });
  }

  const leadRes = await pool.query(
    `SELECT * FROM outbound_leads WHERE id = $1 AND user_id = $2`,
    [leadId, req.user.id]
  );
  if (leadRes.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  const lead = leadRes.rows[0];
  if (lead.status === 'suppressed' || lead.suppression_reason) {
    return res.status(409).json({ error: 'Lead is suppressed and cannot be contacted.' });
  }
  let subject = null;
  let body = '';

  if (channel === 'email') {
    const emailDraft = buildEmailDraft(lead);
    subject = emailDraft.subject;
    body = emailDraft.body;
  } else {
    body = buildLinkedInDraft(lead);
  }

  const draftResult = await pool.query(
    `INSERT INTO outbound_message_drafts (user_id, lead_id, channel, subject, body, status)
     VALUES ($1, $2, $3, $4, $5, 'drafted')
     RETURNING *`,
    [req.user.id, leadId, channel, subject, body]
  );

  const draft = draftResult.rows[0];
  let linkedinTask = null;

  if (channel === 'linkedin') {
    const taskResult = await pool.query(
      `INSERT INTO linkedin_outreach_tasks (user_id, lead_id, draft_id, task_type, status, due_at)
       VALUES ($1, $2, $3, 'manual_message', 'drafted', NOW() + INTERVAL '1 day')
       RETURNING id, status, due_at`,
      [req.user.id, leadId, draft.id]
    );
    linkedinTask = taskResult.rows[0];
  }

  await logLeadEvent({
    userId: req.user.id,
    leadId,
    eventType: 'draft_generated',
    channel,
    metadata: { draftId: draft.id },
  });

  logAction(req.user.id, req.user.email, 'outbound_draft_generated', 'outbound_draft', draft.id, channel, {
    leadId,
    channel,
  });

  return res.status(201).json({
    ...draft,
    linkedinTaskId: linkedinTask ? linkedinTask.id : null,
    linkedinTaskStatus: linkedinTask ? linkedinTask.status : null,
    linkedinTaskDueAt: linkedinTask ? linkedinTask.due_at : null,
  });
});

/**
 * PATCH /api/outbound/drafts/:id/approve
 */
router.patch('/drafts/:id/approve', async (req, res) => {
  const existingRes = await pool.query(
    `SELECT * FROM outbound_message_drafts WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );

  if (existingRes.rows.length === 0) {
    return res.status(404).json({ error: 'Draft not found.' });
  }

  const current = existingRes.rows[0];
  if (current.status === 'approved') {
    return res.json(current);
  }

  if (current.status === 'sent') {
    return res.status(409).json({ error: 'Cannot approve a draft that is already sent.' });
  }

  if (current.status !== 'drafted') {
    return res.status(409).json({ error: `Draft cannot be approved from status ${current.status}.` });
  }

  const draftRes = await pool.query(
    `UPDATE outbound_message_drafts
     SET status = 'approved',
         approved_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [req.params.id, req.user.id]
  );

  const draft = draftRes.rows[0];
  if (draft.channel === 'linkedin') {
    await pool.query(
      `UPDATE linkedin_outreach_tasks
       SET status = 'approved',
           updated_at = NOW()
       WHERE draft_id = $1 AND user_id = $2`,
      [draft.id, req.user.id]
    );
  }

  await logLeadEvent({
    userId: req.user.id,
    leadId: draft.lead_id,
    eventType: 'draft_approved',
    channel: draft.channel,
    metadata: { draftId: draft.id },
  });

  logAction(req.user.id, req.user.email, 'outbound_draft_approved', 'outbound_draft', draft.id, draft.channel, {
    channel: draft.channel,
    leadId: draft.lead_id,
  });

  return res.json(draft);
});

/**
 * POST /api/outbound/drafts/:id/send
 * Manual send confirmation for email drafts
 */
router.post('/drafts/:id/send', async (req, res) => {
  const draftRes = await pool.query(
    `SELECT * FROM outbound_message_drafts WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );

  if (draftRes.rows.length === 0) {
    return res.status(404).json({ error: 'Draft not found.' });
  }

  const draft = draftRes.rows[0];
  if (draft.channel !== 'email') {
    return res.status(400).json({ error: 'Only email drafts can be sent from this endpoint.' });
  }

  if (draft.status === 'sent') {
    return res.status(409).json({ error: 'Draft already sent.' });
  }

  if (draft.status !== 'approved') {
    return res.status(409).json({ error: 'Draft must be approved before sending.' });
  }

  const leadRes = await pool.query(
    `SELECT id, status, suppression_reason
     FROM outbound_leads
     WHERE id = $1 AND user_id = $2`,
    [draft.lead_id, req.user.id]
  );
  if (leadRes.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found for this draft.' });
  }
  const lead = leadRes.rows[0];
  if (lead.status === 'suppressed' || lead.suppression_reason) {
    return res.status(409).json({ error: 'Lead is suppressed and cannot be contacted.' });
  }

  const usage = await getDailySendUsage(req.user.id, 'email');
  if (!requireWithinDailyLimit(usage)) {
    return res.status(429).json({
      error: `Daily email send limit reached (${usage.limit}).`,
      dailyUsage: usage,
    });
  }

  const updatedRes = await pool.query(
    `UPDATE outbound_message_drafts
     SET status = 'sent',
         sent_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [req.params.id, req.user.id]
  );
  const updatedDraft = updatedRes.rows[0];

  await pool.query(
    `UPDATE outbound_leads
     SET status = CASE WHEN status IN ('new', 'qualified', 'queued') THEN 'contacted' ELSE status END,
         last_outreach_channel = 'email',
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [updatedDraft.lead_id, req.user.id]
  );

  await logLeadEvent({
    userId: req.user.id,
    leadId: updatedDraft.lead_id,
    eventType: 'draft_sent',
    channel: 'email',
    metadata: { draftId: updatedDraft.id },
  });

  logAction(req.user.id, req.user.email, 'outbound_email_sent', 'outbound_draft', updatedDraft.id, 'email', {
    leadId: updatedDraft.lead_id,
  });

  return res.json({
    draft: updatedDraft,
    dailyUsage: {
      ...usage,
      used: usage.used + 1,
      remaining: Math.max(0, usage.limit - (usage.used + 1)),
    },
  });
});

/**
 * POST /api/outbound/linkedin/tasks/:id/complete
 */
router.post('/linkedin/tasks/:id/complete', async (req, res) => {
  const { notes = null } = req.body;
  const existingTaskRes = await pool.query(
    `SELECT t.*, d.status AS draft_status, l.status AS lead_status, l.suppression_reason
     FROM linkedin_outreach_tasks t
     LEFT JOIN outbound_message_drafts d ON d.id = t.draft_id
     LEFT JOIN outbound_leads l ON l.id = t.lead_id
     WHERE t.id = $1 AND t.user_id = $2`,
    [req.params.id, req.user.id]
  );

  if (existingTaskRes.rows.length === 0) {
    return res.status(404).json({ error: 'LinkedIn task not found.' });
  }

  const currentTask = existingTaskRes.rows[0];
  if (currentTask.status === 'completed') {
    return res.status(409).json({ error: 'LinkedIn task already completed.' });
  }

  if (currentTask.status !== 'approved' || (currentTask.draft_status && currentTask.draft_status !== 'approved')) {
    return res.status(409).json({
      error: 'LinkedIn task requires approved draft before completion.',
      taskStatus: currentTask.status,
      draftStatus: currentTask.draft_status,
    });
  }

  if (currentTask.lead_status === 'suppressed' || currentTask.suppression_reason) {
    return res.status(409).json({ error: 'Lead is suppressed and cannot be contacted.' });
  }

  const usage = await getDailySendUsage(req.user.id, 'linkedin');
  if (!requireWithinDailyLimit(usage)) {
    return res.status(429).json({
      error: `Daily LinkedIn send limit reached (${usage.limit}).`,
      dailyUsage: usage,
    });
  }

  const taskRes = await pool.query(
    `UPDATE linkedin_outreach_tasks
     SET status = 'completed',
         completed_at = NOW(),
         notes = $1,
         updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [notes, req.params.id, req.user.id]
  );

  const task = taskRes.rows[0];

  if (task.draft_id) {
    await pool.query(
      `UPDATE outbound_message_drafts
       SET status = 'sent',
           sent_at = COALESCE(sent_at, NOW()),
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND status = 'approved'`,
      [task.draft_id, req.user.id]
    );
  }

  await pool.query(
    `UPDATE outbound_leads
     SET status = CASE WHEN status IN ('new', 'qualified', 'queued') THEN 'contacted' ELSE status END,
         last_outreach_channel = 'linkedin',
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [task.lead_id, req.user.id]
  );

  await logLeadEvent({
    userId: req.user.id,
    leadId: task.lead_id,
    eventType: 'linkedin_task_completed',
    channel: 'linkedin',
    metadata: { taskId: task.id, notes },
  });

  logAction(req.user.id, req.user.email, 'outbound_linkedin_completed', 'linkedin_task', task.id, 'linkedin', {
    leadId: task.lead_id,
    draftId: task.draft_id,
  });

  return res.json({
    ...task,
    dailyUsage: {
      ...usage,
      used: usage.used + 1,
      remaining: Math.max(0, usage.limit - (usage.used + 1)),
    },
  });
});

/**
 * GET /api/outbound/events/export
 * Query: format=json|csv, days=30, channel, eventType, limit=1000
 */
router.get('/events/export', async (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  const days = Math.max(1, Math.min(365, Number(req.query.days || 30)));
  const limit = Math.max(1, Math.min(10000, Number(req.query.limit || 1000)));

  const params = [req.user.id, days];
  const filters = [`e.user_id = $1`, `e.created_at >= NOW() - ($2::text || ' days')::interval`];

  if (req.query.channel) {
    params.push(String(req.query.channel));
    filters.push(`e.channel = $${params.length}`);
  }

  if (req.query.eventType) {
    params.push(String(req.query.eventType));
    filters.push(`e.event_type = $${params.length}`);
  }

  params.push(limit);
  const sql = `
    SELECT
      e.id,
      e.created_at,
      e.channel,
      e.event_type,
      e.metadata,
      e.lead_id,
      l.name AS lead_name,
      l.email AS lead_email,
      l.company AS lead_company
    FROM lead_source_events e
    LEFT JOIN outbound_leads l ON l.id = e.lead_id
    WHERE ${filters.join(' AND ')}
    ORDER BY e.created_at DESC
    LIMIT $${params.length}
  `;

  const result = await pool.query(sql, params);

  logAction(req.user.id, req.user.email, 'outbound_events_export', 'outbound_event', null, null, {
    format,
    days,
    limit,
    count: result.rows.length,
  });

  if (format === 'csv') {
    const headers = [
      'id',
      'created_at',
      'channel',
      'event_type',
      'lead_id',
      'lead_name',
      'lead_email',
      'lead_company',
      'metadata',
    ];

    const rows = result.rows.map((event) =>
      [
        event.id,
        event.created_at,
        event.channel,
        event.event_type,
        event.lead_id,
        event.lead_name,
        event.lead_email,
        event.lead_company,
        JSON.stringify(event.metadata || {}),
      ]
        .map(csvEscape)
        .join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="outbound-events-${Date.now()}.csv"`);
    return res.send(csv);
  }

  return res.json({
    count: result.rows.length,
    events: result.rows,
  });
});

/**
 * GET /api/outbound/audit/export
 * Query: format=json|csv, days=30, limit=1000
 */
router.get('/audit/export', async (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  const days = Math.max(1, Math.min(365, Number(req.query.days || 30)));
  const limit = Math.max(1, Math.min(10000, Number(req.query.limit || 1000)));

  const result = await pool.query(
    `SELECT id, created_at, action, resource_type, resource_id, resource_name, metadata
     FROM audit_logs
     WHERE user_id = $1
       AND action LIKE 'outbound_%'
       AND created_at >= NOW() - ($2::text || ' days')::interval
     ORDER BY created_at DESC
     LIMIT $3`,
    [req.user.id, days, limit]
  );

  logAction(req.user.id, req.user.email, 'outbound_audit_export', 'audit_log', null, null, {
    format,
    days,
    limit,
    count: result.rows.length,
  });

  if (format === 'csv') {
    const headers = ['id', 'created_at', 'action', 'resource_type', 'resource_id', 'resource_name', 'metadata'];
    const rows = result.rows.map((log) =>
      [
        log.id,
        log.created_at,
        log.action,
        log.resource_type,
        log.resource_id,
        log.resource_name,
        JSON.stringify(log.metadata || {}),
      ]
        .map(csvEscape)
        .join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="outbound-audit-${Date.now()}.csv"`);
    return res.send(csv);
  }

  return res.json({
    count: result.rows.length,
    auditLogs: result.rows,
  });
});

/**
 * PUT /api/outbound/forecast/goals
 * Body: { periodType, targetMeetings, targetOpportunities, targetRevenue, notes }
 */
router.put('/forecast/goals', async (req, res) => {
  const periodType = String(req.body.periodType || 'monthly').trim().toLowerCase();
  if (!VALID_FORECAST_PERIOD_TYPES.has(periodType)) {
    return res.status(400).json({ error: 'periodType must be weekly or monthly.' });
  }

  const targetMeetings = Math.max(0, Number(req.body.targetMeetings || 0));
  const targetOpportunities = Math.max(0, Number(req.body.targetOpportunities || 0));
  const targetRevenue = Math.max(0, Number(req.body.targetRevenue || 0));
  const notes = req.body.notes == null ? null : String(req.body.notes).trim();

  const period = getCurrentPeriodWindow(periodType);
  const goalRes = await pool.query(
    `INSERT INTO sales_goals
      (user_id, period_type, period_start, period_end, target_meetings, target_opportunities, target_revenue, notes, updated_at)
     VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8, NOW())
     ON CONFLICT (user_id, period_type, period_start, period_end)
     DO UPDATE SET
       target_meetings = EXCLUDED.target_meetings,
       target_opportunities = EXCLUDED.target_opportunities,
       target_revenue = EXCLUDED.target_revenue,
       notes = EXCLUDED.notes,
       updated_at = NOW()
     RETURNING *`,
    [
      req.user.id,
      period.periodType,
      period.periodStart,
      period.periodEnd,
      targetMeetings,
      targetOpportunities,
      targetRevenue,
      notes,
    ]
  );

  const goal = goalRes.rows[0];
  logAction(
    req.user.id,
    req.user.email,
    'outbound_forecast_goal_upserted',
    'sales_goal',
    goal.id,
    period.periodType,
    {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      targetMeetings,
      targetOpportunities,
      targetRevenue: round2(targetRevenue),
    }
  );

  const summary = await buildOutboundForecastSummary(req.user.id, periodType);
  return res.json({
    goal: {
      id: goal.id,
      periodType: goal.period_type,
      periodStart: goal.period_start,
      periodEnd: goal.period_end,
      targetMeetings: Number(goal.target_meetings || 0),
      targetOpportunities: Number(goal.target_opportunities || 0),
      targetRevenue: round2(Number(goal.target_revenue || 0)),
      notes: goal.notes,
      updatedAt: goal.updated_at,
    },
    summary,
  });
});

/**
 * GET /api/outbound/forecast/summary
 * Query: period=weekly|monthly
 */
router.get('/forecast/summary', async (req, res) => {
  const periodType = String(req.query.period || 'monthly').trim().toLowerCase();
  if (!VALID_FORECAST_PERIOD_TYPES.has(periodType)) {
    return res.status(400).json({ error: 'period must be weekly or monthly.' });
  }

  const summary = await buildOutboundForecastSummary(req.user.id, periodType);
  return res.json(summary);
});

/**
 * GET /api/outbound/attribution/summary
 * Query: period=weekly|monthly
 */
router.get('/attribution/summary', async (req, res) => {
  const periodType = String(req.query.period || 'monthly').trim().toLowerCase();
  if (!VALID_FORECAST_PERIOD_TYPES.has(periodType)) {
    return res.status(400).json({ error: 'period must be weekly or monthly.' });
  }

  const summary = await buildOutboundAttributionSummary(req.user.id, periodType);
  return res.json(summary);
});

/**
 * GET /api/outbound/analytics/summary
 */
router.get('/analytics/summary', async (req, res) => {
  const [leadStats, recentEvents, pendingLinkedInTasks, emailUsage, linkedinUsage, campaignStats] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) AS total_leads,
         SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified_count,
         SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) AS contacted_count,
         SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied_count,
         SUM(CASE WHEN status = 'meeting' THEN 1 ELSE 0 END) AS meeting_count,
         SUM(CASE WHEN status = 'opportunity' THEN 1 ELSE 0 END) AS opportunity_count,
         AVG(total_score)::numeric(10,2) AS avg_total_score
       FROM outbound_leads
       WHERE user_id = $1`,
      [req.user.id]
    ),
    pool.query(
      `SELECT channel, event_type, COUNT(*) AS event_count
       FROM lead_source_events
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY channel, event_type
       ORDER BY event_count DESC`,
      [req.user.id]
    ),
    pool.query(
      `SELECT COUNT(*) AS pending_count
       FROM linkedin_outreach_tasks
       WHERE user_id = $1
         AND status IN ('pending', 'drafted', 'approved')`,
      [req.user.id]
    ),
    getDailySendUsage(req.user.id, 'email'),
    getDailySendUsage(req.user.id, 'linkedin'),
    pool.query(
      `SELECT
         COUNT(*)::int AS total_campaigns,
         COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0)::int AS active_campaigns
       FROM outbound_campaigns
       WHERE user_id = $1`,
      [req.user.id]
    ),
  ]);

  return res.json({
    leads: leadStats.rows[0],
    pendingLinkedInTasks: Number(pendingLinkedInTasks.rows[0].pending_count || 0),
    last7DaysEvents: recentEvents.rows,
    dailySendLimits: {
      email: emailUsage,
      linkedin: linkedinUsage,
    },
    campaigns: campaignStats.rows[0],
  });
});

module.exports = router;
