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

async function logLeadEvent({ userId, leadId, eventType, channel = null, metadata = {} }) {
  await pool.query(
    `INSERT INTO lead_source_events (user_id, lead_id, event_type, channel, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, leadId, eventType, channel, JSON.stringify(metadata)]
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
  const params = [req.user.id, Number(minScore)];
  let sql = `
    SELECT *
    FROM outbound_leads
    WHERE user_id = $1
      AND total_score >= $2
  `;

  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }

  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    sql += ` AND (
      name ILIKE $${idx}
      OR COALESCE(company, '') ILIKE $${idx}
      OR COALESCE(title, '') ILIKE $${idx}
      OR COALESCE(email, '') ILIKE $${idx}
    )`;
  }

  params.push(Math.min(500, Math.max(1, Number(limit))));
  sql += ` ORDER BY total_score DESC, created_at DESC LIMIT $${params.length}`;

  const result = await pool.query(sql, params);
  return res.json({ total: result.rows.length, leads: result.rows });
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

  return res.json(updatedRes.rows[0]);
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

  logAction(
    req.user.id,
    req.user.email,
    suppressed ? 'outbound_lead_suppressed' : 'outbound_lead_unsuppressed',
    'outbound_lead',
    updatedLead.id,
    updatedLead.name,
    { reason: suppressed ? reason : null }
  );

  return res.json(updatedLead);
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
