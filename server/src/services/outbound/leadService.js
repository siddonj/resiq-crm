const pool = require('../../models/db');
const outboundUtils = require('../../utils/outboundUtils');
const { scoreLead } = require('../outboundScoring');
const { logAction } = require('../auditLogger');

/**
 * Import leads from CSV rows within a transaction.
 */
async function importLeads({ userId, file, importConfig }) {
  const MAX_CSV_ROWS = 10000;
  const { sourceType, sourceReference, sourceConfidence } = importConfig;

  const importJob = await pool.query(
    `INSERT INTO lead_import_jobs (user_id, filename, status)
     VALUES ($1, $2, 'processing')
     RETURNING id`,
    [userId, file.originalname || 'upload.csv']
  );
  const jobId = importJob.rows[0].id;
  const client = await pool.connect();

  try {
    const csvText = file.buffer.toString('utf8');
    const rows = outboundUtils.parseCSV(csvText);

    if (rows.length === 0) {
      throw new Error('CSV file is empty or has no data rows.');
    }
    if (rows.length > MAX_CSV_ROWS) {
      throw new Error(`CSV exceeds maximum of ${MAX_CSV_ROWS} rows.`);
    }

    let importedRows = 0;
    let duplicateRows = 0;
    let failedRows = 0;
    const errorSample = [];

    await client.query('BEGIN');

    for (const row of rows) {
      try {
        const lead = outboundUtils.buildLeadFromRow(row);
        if (!lead.name || lead.name === 'Unknown') {
          throw new Error('Lead is missing name/first_name fields');
        }

        const dedupeKey = outboundUtils.computeDedupeKey(lead);
        const score = scoreLead(lead);

        const existing = await client.query(
          `SELECT id FROM outbound_leads WHERE user_id = $1 AND dedupe_key = $2`,
          [userId, dedupeKey]
        );

        if (existing.rows.length > 0) {
          duplicateRows++;
          continue;
        }

        const inserted = await client.query(
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
            userId, sourceType, sourceReference, Math.max(0, Math.min(100, sourceConfidence)),
            lead.name, lead.first_name, lead.last_name, lead.email, lead.phone,
            lead.company, lead.title, lead.linkedin_url, lead.website, lead.location,
            lead.notes, JSON.stringify(row), dedupeKey,
            score.fitScore, score.intentScore, score.totalScore, score.status,
            score.nextRecommendedAction,
          ]
        );

        importedRows++;
        await client.query(
          `INSERT INTO lead_score_history
            (user_id, lead_id, fit_score, intent_score, engagement_score, total_score, status, next_recommended_action, reasons, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
          [userId, inserted.rows[0].id, score.fitScore, score.intentScore, 0,
           score.totalScore, score.status, score.nextRecommendedAction,
           JSON.stringify(score.reasons || {}), 'import']
        );
        await client.query(
          `INSERT INTO lead_source_events (user_id, lead_id, event_type, channel, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, inserted.rows[0].id, 'lead_imported', null,
           JSON.stringify({ sourceType, sourceReference })]
        );
      } catch (err) {
        failedRows++;
        if (errorSample.length < 20) {
          errorSample.push({ row, error: err.message });
        }
      }
    }

    await client.query('COMMIT');

    await pool.query(
      `UPDATE lead_import_jobs
       SET status = 'completed',
           total_rows = $1, imported_rows = $2, duplicate_rows = $3, failed_rows = $4,
           error_sample = $5, completed_at = NOW()
       WHERE id = $6`,
      [rows.length, importedRows, duplicateRows, failedRows, JSON.stringify(errorSample), jobId]
    );

    logAction(userId, null, 'outbound_import_csv', 'outbound_leads', null,
      file.originalname || 'upload.csv', { jobId, totalRows: rows.length, importedRows, duplicateRows, failedRows });

    return { jobId, status: 'completed', totalRows: rows.length, importedRows, duplicateRows, failedRows, errorSample };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await pool.query(
      `UPDATE lead_import_jobs
       SET status = 'failed', failed_rows = failed_rows + 1,
           error_sample = jsonb_build_array(jsonb_build_object('error', $1)),
           completed_at = NOW()
       WHERE id = $2`,
      [err.message, jobId]
    );
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a bulk action on a set of leads.
 */
async function executeBulkAction({ userId, leadIds, actionType, payload, logLeadEventFn, autoStopFn }) {
  const leadsRes = await pool.query(
    `SELECT id, name, status, suppression_reason
     FROM outbound_leads
     WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, leadIds]
  );
  const foundLeadIds = new Set(leadsRes.rows.map((lead) => lead.id));
  const missingLeadIds = leadIds.filter((leadId) => !foundLeadIds.has(leadId));

  if (!leadsRes.rows.length) {
    throw new Error('No leads found for this action.');
  }

  const updatedLeadIds = [];
  const autoStoppedEnrollmentIds = [];
  const statusTarget = String(payload.status || '').trim().toLowerCase();
  const suppressionReason = String(payload.reason || '').trim();

  if (actionType === 'set_status' && !outboundUtils.VALID_OUTBOUND_LEAD_STATUSES.has(statusTarget)) {
    throw new Error('payload.status must be a valid lead status for set_status action.');
  }
  if (actionType === 'suppress' && !suppressionReason) {
    throw new Error('payload.reason is required for suppress bulk action.');
  }

  for (const lead of leadsRes.rows) {
    if (actionType === 'set_status') {
      await pool.query(
        `UPDATE outbound_leads SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
        [statusTarget, lead.id, userId]
      );
      await logLeadEventFn({
        userId, leadId: lead.id, eventType: 'bulk_status_updated',
        metadata: { fromStatus: lead.status, toStatus: statusTarget },
      });
      updatedLeadIds.push(lead.id);
      continue;
    }

    if (actionType === 'suppress') {
      await pool.query(
        `UPDATE outbound_leads SET status = 'suppressed', suppression_reason = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3`,
        [suppressionReason, lead.id, userId]
      );
      await logLeadEventFn({ userId, leadId: lead.id, eventType: 'lead_suppressed', metadata: { reason: suppressionReason } });
      if (autoStopFn) {
        const stopped = await autoStopFn({ userId, leadId: lead.id, reason: 'Bulk suppress', triggerSource: 'bulk_action' });
        autoStoppedEnrollmentIds.push(...stopped);
      }
      updatedLeadIds.push(lead.id);
      continue;
    }

    if (actionType === 'unsuppress') {
      await pool.query(
        `UPDATE outbound_leads SET status = 'new', suppression_reason = NULL, updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [lead.id, userId]
      );
      await logLeadEventFn({ userId, leadId: lead.id, eventType: 'lead_unsuppressed', metadata: {} });
      updatedLeadIds.push(lead.id);
      continue;
    }

    if (actionType === 'rescore') {
      const freshScore = scoreLead(lead);
      await pool.query(
        `UPDATE outbound_leads
         SET fit_score = $1, intent_score = $2, total_score = $3, status = $4,
             next_recommended_action = $5, updated_at = NOW()
         WHERE id = $6 AND user_id = $7`,
        [freshScore.fitScore, freshScore.intentScore, freshScore.totalScore,
         freshScore.status, freshScore.nextRecommendedAction, lead.id, userId]
      );
      await pool.query(
        `INSERT INTO lead_score_history
          (user_id, lead_id, fit_score, intent_score, engagement_score, total_score, status, next_recommended_action, reasons, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [userId, lead.id, freshScore.fitScore, freshScore.intentScore, 0,
         freshScore.totalScore, freshScore.status, freshScore.nextRecommendedAction,
         JSON.stringify(freshScore.reasons || {}), 'bulk_rescore']
      );
      await logLeadEventFn({ userId, leadId: lead.id, eventType: 'lead_rescored', metadata: { source: 'bulk_rescore' } });
      updatedLeadIds.push(lead.id);
    }
  }

  return { updatedCount: updatedLeadIds.length, updatedLeadIds, missingLeadIds, autoStoppedEnrollmentIds };
}

/**
 * Toggle suppression on a single lead.
 */
async function toggleSuppression({ userId, leadId, suppressed, reason, logLeadEventFn, autoStopFn }) {
  const leadRes = await pool.query(
    `SELECT id, status FROM outbound_leads WHERE id = $1 AND user_id = $2`,
    [leadId, userId]
  );
  if (!leadRes.rows.length) {
    throw new Error('Lead not found.');
  }

  if (suppressed) {
    await pool.query(
      `UPDATE outbound_leads SET status = 'suppressed', suppression_reason = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3`,
      [reason, leadId, userId]
    );
    if (autoStopFn) {
      await autoStopFn({ userId, leadId, reason: 'Auto-stopped after suppression update', triggerSource: 'manual_ui' });
    }
    await logLeadEventFn({ userId, leadId, eventType: 'lead_suppressed', metadata: { reason, source: 'manual_ui' } });
  } else {
    await pool.query(
      `UPDATE outbound_leads SET status = 'new', suppression_reason = NULL, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [leadId, userId]
    );
    await logLeadEventFn({ userId, leadId, eventType: 'lead_unsuppressed', metadata: { source: 'manual_ui' } });
  }

  return { suppressed, reason };
}

module.exports = {
  importLeads,
  executeBulkAction,
  toggleSuppression,
};
