const pool = require('../../models/db');
const outboundUtils = require('../../utils/outboundUtils');
const { logAction } = require('../auditLogger');

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

async function recordSequenceTransition({
  enrollmentId,
  userId,
  fromState,
  toState,
  reason,
  triggerSource,
  metadata = {},
}) {
  await pool.query(
    `INSERT INTO sequence_enrollment_transitions
       (enrollment_id, user_id, from_state, to_state, reason, trigger_source, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [enrollmentId, userId, fromState, toState, reason, triggerSource, JSON.stringify(metadata)]
  );
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

async function listSequences(userId) {
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
    [userId]
  );

  return {
    total: result.rows.length,
    sequences: result.rows,
  };
}

async function listEnrollments(userId, status, limit) {
  const safeStatus = String(status || '').trim().toLowerCase();
  const safeLimit = Math.min(500, Math.max(1, Number(limit || 200)));

  if (safeStatus && !outboundUtils.VALID_SEQUENCE_ENROLLMENT_STATES.has(safeStatus)) {
    throw new Error('Invalid enrollment status filter.');
  }

  const params = [userId];
  const filters = ['e.user_id = $1'];
  if (safeStatus) {
    params.push(safeStatus);
    filters.push(`e.status = $${params.length}`);
  }
  params.push(safeLimit);

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

  return {
    total: result.rows.length,
    enrollments: result.rows,
  };
}

async function enrollLead({ userId, sequenceId, leadId, logLeadEventFn }) {
  const sequenceRes = await pool.query(
    `SELECT id, name
     FROM sequences
     WHERE id = $1
       AND user_id = $2`,
    [sequenceId, userId]
  );
  if (!sequenceRes.rows.length) {
    throw new Error('Sequence not found.');
  }

  const stepsRes = await pool.query(
    `SELECT COUNT(*)::int AS total_steps
     FROM sequence_steps
     WHERE sequence_id = $1`,
    [sequenceId]
  );
  const totalSteps = Number(stepsRes.rows[0]?.total_steps || 0);
  if (totalSteps === 0) {
    throw new Error('Sequence has no steps yet.');
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
    [leadId, userId]
  );
  if (!leadRes.rows.length) {
    throw new Error('Lead not found.');
  }

  const lead = leadRes.rows[0];
  if (lead.status === 'suppressed' || lead.suppression_reason) {
    throw new Error('Suppressed leads cannot be enrolled in sequences.');
  }

  let duplicateGroup = null;
  const normalizedName = outboundUtils.normalizeIssueToken(lead.name);
  const normalizedCompany = outboundUtils.normalizeIssueToken(lead.company);
  if (normalizedName && normalizedCompany) {
    const duplicateRes = await pool.query(
      `SELECT ARRAY_AGG(id ORDER BY updated_at DESC, created_at DESC) AS lead_ids
       FROM outbound_leads
       WHERE user_id = $1
         AND LOWER(REGEXP_REPLACE(COALESCE(name, ''), '[^a-z0-9]+', '', 'g')) = $2
         AND LOWER(REGEXP_REPLACE(COALESCE(company, ''), '[^a-z0-9]+', '', 'g')) = $3`,
      [userId, normalizedName, normalizedCompany]
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

  const leadIssues = outboundUtils.buildLeadDataQualityIssueCandidates(lead, { duplicateGroup });
  await upsertDataQualityIssues(userId, leadIssues);
  const blockingIssues = leadIssues.filter((issue) => outboundUtils.DATA_QUALITY_BLOCKING_TYPES.has(issue.issueType));
  if (blockingIssues.length) {
    const error = new Error('Lead failed data quality guardrails before enrollment.');
    error.code = 'data_quality_block';
    error.blockers = blockingIssues.map((issue) => ({
      issueType: issue.issueType,
      severity: issue.severity,
      details: issue.details || {},
    }));
    throw error;
  }

  const openRes = await pool.query(
    `SELECT e.id, e.sequence_id, e.status, s.name AS sequence_name
     FROM outbound_sequence_enrollments e
     JOIN sequences s ON s.id = e.sequence_id
     WHERE e.user_id = $1
       AND e.lead_id = $2
       AND e.status IN ('active', 'paused')
     LIMIT 1`,
    [userId, leadId]
  );
  if (openRes.rows.length) {
    const open = openRes.rows[0];
    const error = new Error(`Lead already has an ${open.status} sequence enrollment.`);
    error.enrollmentId = open.id;
    error.sequenceId = open.sequence_id;
    error.sequenceName = open.sequence_name;
    throw error;
  }

  try {
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
      [leadId, userId]
    );

    if (logLeadEventFn) {
      await logLeadEventFn({
        userId,
        leadId,
        eventType: 'sequence_enrolled',
        metadata: { sequenceId, enrollmentId },
      });
    }

    logAction(userId, null, 'outbound_sequence_enrolled', 'outbound_sequence_enrollment', enrollmentId, sequenceRes.rows[0].name, { leadId });

    const enrollment = await getEnrollmentRecord(userId, enrollmentId);
    return enrollment;
  } catch (err) {
    if (err?.code === '23505') {
      throw new Error('Lead already has an open sequence enrollment.');
    }
    throw new Error('Failed to enroll lead into sequence.');
  }
}

async function changeEnrollmentState({ userId, enrollmentId, nextState, reason, logLeadEventFn }) {
  const existing = await getEnrollmentRecord(userId, enrollmentId);
  if (!existing) {
    throw new Error('Sequence enrollment not found.');
  }

  const currentState = String(existing.status || '').toLowerCase();
  if (currentState === nextState) {
    return existing;
  }

  const allowedTargets = outboundUtils.ALLOWED_MANUAL_SEQUENCE_TRANSITIONS[currentState] || new Set();
  if (!allowedTargets.has(nextState)) {
    throw new Error(`Cannot transition enrollment from ${currentState} to ${nextState}.`);
  }

  if (nextState === 'active' && (existing.lead_status === 'suppressed' || existing.suppression_reason)) {
    throw new Error('Cannot resume sequence while lead is suppressed.');
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
    [nextState, finalReason, enrollmentId, userId]
  );

  await recordSequenceTransition({
    enrollmentId,
    userId,
    fromState: currentState,
    toState: nextState,
    reason: finalReason,
    triggerSource: 'manual',
    metadata: { leadId: existing.lead_id, sequenceId: existing.sequence_id },
  });

  if (logLeadEventFn) {
    await logLeadEventFn({
      userId,
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
  }

  logAction(userId, null, 'outbound_sequence_state_changed', 'outbound_sequence_enrollment', enrollmentId, existing.sequence_name, {
    leadId: existing.lead_id,
    fromState: currentState,
    toState: nextState,
    reason: finalReason,
  });

  const updated = await getEnrollmentRecord(userId, enrollmentId);
  return updated;
}

module.exports = {
  listSequences,
  listEnrollments,
  enrollLead,
  changeEnrollmentState,
  getEnrollmentRecord,
  recordSequenceTransition,
  autoStopOpenSequenceEnrollments,
  upsertDataQualityIssues,
};
