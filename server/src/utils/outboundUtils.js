/**
 * Outbound Automation Pure Utilities
 * Extracted from routes/outboundAutomation.js for testability and reuse.
 */

const VALID_SOURCE_TYPES = new Set(['csv', 'manual', 'api', 'other']);
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
const VALID_DATA_QUALITY_STATUSES = new Set(['open', 'resolved', 'dismissed']);
const VALID_DATA_QUALITY_ISSUE_TYPES = new Set([
  'missing_contact_channel',
  'missing_company',
  'missing_title',
  'low_source_confidence',
  'stale_lead',
  'potential_duplicate',
]);
const VALID_MULTIFAMILY_OBJECT_TYPES = new Set(['portfolio', 'property', 'tech_stack', 'initiative']);
const VALID_MULTIFAMILY_ENTITY_TYPES = new Set(['outbound_lead', 'contact', 'deal', 'company']);
const VALID_MULTIFAMILY_EXPLORER_ENTITY_TYPES = new Set(['contact', 'deal', 'company']);
const VALID_DRAFT_STATUSES = new Set(['drafted', 'approved', 'sent', 'archived']);
const VALID_DRAFT_CHANNELS = new Set(['email', 'linkedin']);
const VALID_LINKEDIN_TASK_STATUSES = new Set(['pending', 'drafted', 'approved', 'completed', 'skipped', 'blocked']);
const VALID_OUTBOUND_SAVED_VIEW_SCOPES = new Set(['outbound_leads']);
const VALID_OUTBOUND_BULK_ACTIONS = new Set(['set_status', 'suppress', 'unsuppress', 'rescore']);

const SEND_EVENT_TYPES = {
  email: ['draft_sent'],
  linkedin: ['linkedin_task_completed'],
};

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

function normalizeMultifamilyObjectType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!VALID_MULTIFAMILY_OBJECT_TYPES.has(normalized)) return null;
  return normalized;
}

function normalizeMultifamilyEntityType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!VALID_MULTIFAMILY_ENTITY_TYPES.has(normalized)) return null;
  return normalized;
}

function normalizeMultifamilyExplorerEntityType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!VALID_MULTIFAMILY_EXPLORER_ENTITY_TYPES.has(normalized)) return null;
  return normalized;
}

function normalizeTextValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function mapMultifamilyObjectRow(row) {
  return {
    id: row.id,
    objectType: row.object_type,
    name: row.name,
    description: row.description || null,
    metadata: row.metadata || {},
    associationCounts: {
      outboundLead: Number(row.outbound_lead_count || 0),
      contact: Number(row.contact_count || 0),
      deal: Number(row.deal_count || 0),
      company: Number(row.company_count || 0),
      total: Number(row.total_association_count || 0),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMultifamilyAssociationRow(row) {
  return {
    id: row.id,
    objectId: row.object_id,
    objectType: row.object_type,
    entityType: row.entity_type,
    entityId: row.entity_id || null,
    companyName: row.company_name || null,
    targetKey: row.target_key,
    metadata: row.metadata || {},
    target: {
      name: row.target_name || null,
      email: row.target_email || null,
      company: row.target_company || null,
      title: row.target_title || null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDraftInboxRow(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    channel: row.channel,
    subject: row.subject || null,
    body: row.body,
    status: row.status,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lead: {
      id: row.lead_id,
      name: row.lead_name || null,
      email: row.lead_email || null,
      company: row.lead_company || null,
      title: row.lead_title || null,
      totalScore: Number(row.lead_total_score || 0),
      status: row.lead_status || null,
    },
    linkedinTask: row.linkedin_task_id
      ? {
          id: row.linkedin_task_id,
          status: row.linkedin_task_status,
          dueAt: row.linkedin_task_due_at,
          completedAt: row.linkedin_task_completed_at,
        }
      : null,
  };
}

function computeLinkedinTaskPriority(task) {
  const status = String(task.status || '').toLowerCase();
  const statusWeights = {
    approved: 35,
    drafted: 25,
    pending: 20,
    blocked: 10,
    skipped: 0,
    completed: 0,
  };

  const nowMs = Date.now();
  const dueAtMs = task.due_at ? new Date(task.due_at).getTime() : null;
  let dueWeight = 0;
  if (Number.isFinite(dueAtMs)) {
    if (dueAtMs < nowMs) {
      const daysOverdue = Math.max(0, Math.floor((nowMs - dueAtMs) / (1000 * 60 * 60 * 24)));
      dueWeight += 45 + Math.min(15, daysOverdue * 4);
    } else {
      const daysUntilDue = Math.max(0, Math.floor((dueAtMs - nowMs) / (1000 * 60 * 60 * 24)));
      dueWeight += Math.max(0, 20 - Math.min(20, daysUntilDue * 2));
    }
  } else {
    dueWeight += 10;
  }

  const leadScoreWeight = Math.min(35, Math.max(0, Number(task.lead_total_score || 0) * 0.35));
  return Math.round((statusWeights[status] || 0) + dueWeight + leadScoreWeight);
}

function mapLinkedinTaskBoardRow(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    draftId: row.draft_id || null,
    taskType: row.task_type,
    status: row.status,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    priorityScore: computeLinkedinTaskPriority(row),
    lead: {
      id: row.lead_id,
      name: row.lead_name || null,
      email: row.lead_email || null,
      company: row.lead_company || null,
      title: row.lead_title || null,
      totalScore: Number(row.lead_total_score || 0),
      status: row.lead_status || null,
      suppressionReason: row.lead_suppression_reason || null,
    },
    draft: row.draft_id
      ? {
          id: row.draft_id,
          channel: row.draft_channel || null,
          status: row.draft_status || null,
          subject: row.draft_subject || null,
        }
      : null,
  };
}

function mapTaskBoardBuckets(rows) {
  const buckets = {
    pending: [],
    drafted: [],
    approved: [],
    blocked: [],
    completed: [],
    skipped: [],
  };
  for (const row of rows) {
    const item = mapLinkedinTaskBoardRow(row);
    if (!buckets[item.status]) {
      buckets[item.status] = [];
    }
    buckets[item.status].push(item);
  }
  return buckets;
}

function normalizeSavedViewFilters(filters) {
  const source = isPlainObject(filters) ? filters : {};
  const normalized = {};

  if (source.status) {
    const status = String(source.status).trim().toLowerCase();
    if (VALID_OUTBOUND_LEAD_STATUSES.has(status)) {
      normalized.status = status;
    }
  }

  if (source.search) {
    const search = String(source.search).trim();
    if (search) normalized.search = search.slice(0, 200);
  }

  const minScore = Number(source.minScore);
  if (Number.isFinite(minScore)) {
    normalized.minScore = Math.max(0, Math.min(100, Math.round(minScore)));
  }

  const limit = Number(source.limit);
  if (Number.isFinite(limit)) {
    normalized.limit = Math.max(1, Math.min(500, Math.round(limit)));
  }

  const objectType = normalizeMultifamilyObjectType(source.objectType);
  if (objectType) {
    normalized.objectType = objectType;
  }

  const objectId = sanitizeUuidValue(source.objectId || '');
  if (objectId) {
    normalized.objectId = objectId;
  }

  return normalized;
}

function mapSavedViewRow(row) {
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    isDefault: Boolean(row.is_default),
    filters: row.filters || {},
    displayOptions: row.display_options || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mergeUniqueNoteBlocks(primaryNote, duplicates) {
  const chunks = [primaryNote, ...duplicates.map((lead) => lead.notes)]
    .map((value) => normalizeTextValue(value))
    .filter(Boolean);

  const unique = [];
  for (const chunk of chunks) {
    if (!unique.includes(chunk)) {
      unique.push(chunk);
    }
  }

  return unique.length ? unique.join('\n\n') : null;
}

function pickPrimaryThenDuplicate(primaryValue, duplicateLeads, fieldName) {
  const primaryNormalized = normalizeTextValue(primaryValue);
  if (primaryNormalized) return primaryNormalized;

  for (const duplicate of duplicateLeads) {
    const candidate = normalizeTextValue(duplicate?.[fieldName]);
    if (candidate) return candidate;
  }

  return null;
}

function mapDataQualityMergeOperationRow(row) {
  return {
    id: row.id,
    issueId: row.issue_id || null,
    primaryLeadId: row.primary_lead_id || null,
    primaryLead: row.primary_lead_id
      ? {
          id: row.primary_lead_id,
          name: row.primary_lead_name || null,
          email: row.primary_lead_email || null,
          company: row.primary_lead_company || null,
        }
      : null,
    mergedLeadIds: Array.isArray(row.merged_lead_ids) ? row.merged_lead_ids : [],
    mergedLeadCount: Number(row.merged_lead_count || 0),
    fieldUpdates: row.field_updates || {},
    metadata: row.metadata || {},
    createdAt: row.created_at,
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

module.exports = {
  // Constants
  VALID_SOURCE_TYPES,
  VALID_CAMPAIGN_STATUSES,
  VALID_CAMPAIGN_CHANNELS,
  VALID_CAMPAIGN_MEMBER_STATUSES,
  VALID_SEQUENCE_ENROLLMENT_STATES,
  ALLOWED_MANUAL_SEQUENCE_TRANSITIONS,
  CAMPAIGN_MEMBER_TO_LEAD_STATUS,
  LEAD_OUTCOME_EVENT_MAP,
  VALID_OUTBOUND_LEAD_STATUSES,
  VALID_RULE_TRIGGER_EVENTS,
  VALID_RULE_ACTION_TYPES,
  VALID_RULE_RUN_STATUSES,
  VALID_FORECAST_PERIOD_TYPES,
  FORECAST_BUCKET_WEIGHTS,
  ATTRIBUTION_STAGE_BY_EVENT,
  ATTRIBUTION_STAGE_ORDER,
  VALID_DATA_QUALITY_STATUSES,
  VALID_DATA_QUALITY_ISSUE_TYPES,
  DATA_QUALITY_BLOCKING_TYPES,
  MIN_SOURCE_CONFIDENCE_THRESHOLD,
  STALE_LEAD_DAYS,
  VALID_MULTIFAMILY_OBJECT_TYPES,
  VALID_MULTIFAMILY_ENTITY_TYPES,
  VALID_MULTIFAMILY_EXPLORER_ENTITY_TYPES,
  VALID_DRAFT_STATUSES,
  VALID_DRAFT_CHANNELS,
  VALID_LINKEDIN_TASK_STATUSES,
  VALID_OUTBOUND_SAVED_VIEW_SCOPES,
  VALID_OUTBOUND_BULK_ACTIONS,
  SEND_EVENT_TYPES,

  // CSV & Lead parsing
  parseCSVRow,
  normalizeHeader,
  parseCSV,
  canonicalLinkedInUrl,
  buildLeadFromRow,
  computeDedupeKey,
  buildEmailDraft,
  buildLinkedInDraft,
  csvEscape,

  // Normalization & sanitization
  normalizeCampaignChannels,
  sanitizeUuidList,
  sanitizeUuidValue,
  normalizeMultifamilyObjectType,
  normalizeMultifamilyEntityType,
  normalizeMultifamilyExplorerEntityType,
  normalizeTextValue,
  normalizeIssueToken,
  normalizeSavedViewFilters,

  // Math & logic
  toFiniteNumber,
  safeRate,
  round2,
  classifyPersonaTitle,
  isPlainObject,
  getByPath,
  compareConditionValues,
  evaluateRuleConditions,
  normalizeRuleActions,

  // Dates & periods
  toPeriodDateString,
  getCurrentPeriodWindow,
  calculatePeriodProgress,
  getLeadUpdatedAt,

  // Mappers
  mapMultifamilyObjectRow,
  mapMultifamilyAssociationRow,
  mapDraftInboxRow,
  computeLinkedinTaskPriority,
  mapLinkedinTaskBoardRow,
  mapTaskBoardBuckets,
  mapSavedViewRow,
  mapDataQualityMergeOperationRow,
  mapDataQualityIssueRow,
  mergeUniqueNoteBlocks,
  pickPrimaryThenDuplicate,
  deriveAttributionStage,
};
