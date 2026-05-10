const pool = require('../../models/db');
const outboundUtils = require('../../utils/outboundUtils');
const sequenceService = require('./sequenceService');

async function syncDataQualityIssuesForUser(userId) {
  const leadsRes = await pool.query(
    `SELECT id, name, email, linkedin_url, company, title, source_confidence, created_at, updated_at
     FROM outbound_leads
     WHERE user_id = $1`,
    [userId]
  );
  const leads = leadsRes.rows;
  const duplicateGroupByLead = outboundUtils.buildDuplicateGroupIndex(leads);

  const detectedIssues = [];
  for (const lead of leads) {
    const duplicateGroup = duplicateGroupByLead.get(lead.id) || null;
    detectedIssues.push(...outboundUtils.buildLeadDataQualityIssueCandidates(lead, { duplicateGroup }));
  }

  await sequenceService.upsertDataQualityIssues(userId, detectedIssues);

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

async function mergeDataQualityIssue({ userId, issueId, primaryLeadId, duplicateLeadIds }) {
  const mergeLeadIds = [...new Set([primaryLeadId, ...duplicateLeadIds])];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const leadsRes = await client.query(
      `SELECT *
       FROM outbound_leads
       WHERE user_id = $1
         AND id = ANY($2::uuid[])
       FOR UPDATE`,
      [userId, mergeLeadIds]
    );

    const leadById = new Map(leadsRes.rows.map((lead) => [lead.id, lead]));
    if (!leadById.has(primaryLeadId)) {
      await client.query('ROLLBACK');
      const err = new Error('Primary lead not found for this account.');
      err.statusCode = 404;
      throw err;
    }

    const missingDuplicates = duplicateLeadIds.filter((leadId) => !leadById.has(leadId));
    if (missingDuplicates.length) {
      await client.query('ROLLBACK');
      const err = new Error('One or more duplicate leads were not found for this account.');
      err.statusCode = 404;
      err.missingDuplicateLeadIds = missingDuplicates;
      throw err;
    }

    const primaryLead = leadById.get(primaryLeadId);
    const duplicateLeads = duplicateLeadIds.map((leadId) => leadById.get(leadId)).filter(Boolean);

    const mergedFields = {};
    const textFields = ['name', 'first_name', 'last_name', 'email', 'phone', 'company', 'title', 'linkedin_url', 'website', 'location'];
    for (const field of textFields) {
      mergedFields[field] = outboundUtils.pickPrimaryThenDuplicate(primaryLead[field], duplicateLeads, field);
    }

    if (mergedFields.email) {
      mergedFields.email = mergedFields.email.toLowerCase();
    }
    if (mergedFields.linkedin_url) {
      mergedFields.linkedin_url = outboundUtils.canonicalLinkedInUrl(mergedFields.linkedin_url);
    }

    const mergedNotes = outboundUtils.mergeUniqueNoteBlocks(primaryLead.notes, duplicateLeads);
    const mergedRawData = Object.assign(
      {},
      ...duplicateLeads.map((lead) => (outboundUtils.isPlainObject(lead.raw_data) ? lead.raw_data : {})),
      outboundUtils.isPlainObject(primaryLead.raw_data) ? primaryLead.raw_data : {}
    );

    const mergedSourceConfidence = Math.max(
      Number(primaryLead.source_confidence || 0),
      ...duplicateLeads.map((lead) => Number(lead.source_confidence || 0))
    );
    const mergedFitScore = Math.max(Number(primaryLead.fit_score || 0), ...duplicateLeads.map((lead) => Number(lead.fit_score || 0)));
    const mergedIntentScore = Math.max(Number(primaryLead.intent_score || 0), ...duplicateLeads.map((lead) => Number(lead.intent_score || 0)));
    const mergedTotalScore = Math.max(Number(primaryLead.total_score || 0), ...duplicateLeads.map((lead) => Number(lead.total_score || 0)));

    const fieldUpdates = {};
    for (const field of [...textFields, 'notes']) {
      const oldValue = primaryLead[field] == null ? null : primaryLead[field];
      const nextValue = field === 'notes' ? mergedNotes : mergedFields[field];
      if ((oldValue || null) !== (nextValue || null)) {
        fieldUpdates[field] = { from: oldValue || null, to: nextValue || null };
      }
    }
    if (Number(primaryLead.source_confidence || 0) !== mergedSourceConfidence) {
      fieldUpdates.source_confidence = { from: Number(primaryLead.source_confidence || 0), to: mergedSourceConfidence };
    }
    if (Number(primaryLead.fit_score || 0) !== mergedFitScore) {
      fieldUpdates.fit_score = { from: Number(primaryLead.fit_score || 0), to: mergedFitScore };
    }
    if (Number(primaryLead.intent_score || 0) !== mergedIntentScore) {
      fieldUpdates.intent_score = { from: Number(primaryLead.intent_score || 0), to: mergedIntentScore };
    }
    if (Number(primaryLead.total_score || 0) !== mergedTotalScore) {
      fieldUpdates.total_score = { from: Number(primaryLead.total_score || 0), to: mergedTotalScore };
    }

    const nextRecommendedAction = outboundUtils.pickPrimaryThenDuplicate(primaryLead.next_recommended_action, duplicateLeads, 'next_recommended_action');
    const suppressionReason = outboundUtils.pickPrimaryThenDuplicate(primaryLead.suppression_reason, duplicateLeads, 'suppression_reason');
    const lastOutreachChannel = outboundUtils.pickPrimaryThenDuplicate(primaryLead.last_outreach_channel, duplicateLeads, 'last_outreach_channel');
    const isSynthetic = Boolean(primaryLead.is_synthetic) && duplicateLeads.every((lead) => Boolean(lead.is_synthetic));

    const updatedPrimaryRes = await client.query(
      `UPDATE outbound_leads
       SET name = $1,
           first_name = $2,
           last_name = $3,
           email = $4,
           phone = $5,
           company = $6,
           title = $7,
           linkedin_url = $8,
           website = $9,
           location = $10,
           notes = $11,
           raw_data = $12::jsonb,
           source_confidence = $13,
           fit_score = $14,
           intent_score = $15,
           total_score = $16,
           next_recommended_action = $17,
           suppression_reason = $18,
           last_outreach_channel = $19,
           is_synthetic = $20,
           updated_at = NOW()
       WHERE id = $21
         AND user_id = $22
       RETURNING *`,
      [
        mergedFields.name,
        mergedFields.first_name,
        mergedFields.last_name,
        mergedFields.email,
        mergedFields.phone,
        mergedFields.company,
        mergedFields.title,
        mergedFields.linkedin_url,
        mergedFields.website,
        mergedFields.location,
        mergedNotes,
        JSON.stringify(mergedRawData),
        mergedSourceConfidence,
        mergedFitScore,
        mergedIntentScore,
        mergedTotalScore,
        nextRecommendedAction,
        suppressionReason,
        lastOutreachChannel,
        isSynthetic,
        primaryLeadId,
        userId,
      ]
    );

    await client.query(
      `DELETE FROM outbound_campaign_members duplicate_member
       USING outbound_campaign_members primary_member
       WHERE duplicate_member.lead_id = ANY($1::uuid[])
         AND primary_member.lead_id = $2
         AND duplicate_member.campaign_id = primary_member.campaign_id`,
      [duplicateLeadIds, primaryLeadId]
    );

    await client.query(
      `UPDATE outbound_campaign_members
       SET lead_id = $1,
           updated_at = NOW()
       WHERE lead_id = ANY($2::uuid[])`,
      [primaryLeadId, duplicateLeadIds]
    );

    await client.query(
      `UPDATE outbound_sequence_enrollments
       SET status = 'stopped',
           stop_reason = COALESCE(stop_reason, $1),
           stopped_at = COALESCE(stopped_at, NOW()),
           updated_at = NOW(),
           last_transition_at = NOW()
       WHERE user_id = $2
         AND lead_id = ANY($3::uuid[])
         AND status IN ('active', 'paused')`,
      [`Merged into primary lead ${primaryLeadId}`, userId, duplicateLeadIds]
    );

    await client.query(
      `UPDATE outbound_sequence_enrollments
       SET lead_id = $1,
           updated_at = NOW()
       WHERE user_id = $2
         AND lead_id = ANY($3::uuid[])`,
      [primaryLeadId, userId, duplicateLeadIds]
    );

    await client.query(`UPDATE outbound_message_drafts SET lead_id = $1, updated_at = NOW() WHERE lead_id = ANY($2::uuid[])`, [
      primaryLeadId,
      duplicateLeadIds,
    ]);
    await client.query(`UPDATE linkedin_outreach_tasks SET lead_id = $1, updated_at = NOW() WHERE lead_id = ANY($2::uuid[])`, [
      primaryLeadId,
      duplicateLeadIds,
    ]);
    await client.query(`UPDATE lead_source_events SET lead_id = $1 WHERE user_id = $2 AND lead_id = ANY($3::uuid[])`, [
      primaryLeadId,
      userId,
      duplicateLeadIds,
    ]);
    await client.query(`UPDATE lead_score_history SET lead_id = $1 WHERE user_id = $2 AND lead_id = ANY($3::uuid[])`, [
      primaryLeadId,
      userId,
      duplicateLeadIds,
    ]);
    await client.query(`UPDATE attribution_touchpoints SET lead_id = $1 WHERE user_id = $2 AND lead_id = ANY($3::uuid[])`, [
      primaryLeadId,
      userId,
      duplicateLeadIds,
    ]);

    await client.query(
      `DELETE FROM multifamily_object_associations duplicate_association
       USING multifamily_object_associations primary_association
       WHERE duplicate_association.user_id = $1
         AND primary_association.user_id = duplicate_association.user_id
         AND duplicate_association.entity_type = 'outbound_lead'
         AND primary_association.entity_type = 'outbound_lead'
         AND duplicate_association.entity_id = ANY($2::uuid[])
         AND primary_association.entity_id = $3
         AND duplicate_association.object_id = primary_association.object_id`,
      [userId, duplicateLeadIds, primaryLeadId]
    );

    await client.query(
      `UPDATE multifamily_object_associations
       SET entity_id = $1::uuid,
           target_key = $1::text,
           updated_at = NOW()
       WHERE user_id = $2
         AND entity_type = 'outbound_lead'
         AND entity_id = ANY($3::uuid[])`,
      [primaryLeadId, userId, duplicateLeadIds]
    );

    await client.query(
      `UPDATE data_quality_issues
       SET lead_id = $1,
           updated_at = NOW()
       WHERE user_id = $2
         AND lead_id = ANY($3::uuid[])`,
      [primaryLeadId, userId, duplicateLeadIds]
    );

    const issueRes = await pool.query(
      `SELECT id, issue_type, status, details, lead_id
       FROM data_quality_issues
       WHERE id = $1
         AND user_id = $2
       LIMIT 1`,
      [issueId, userId]
    );
    const issue = issueRes.rows[0];

    const mergeOpRes = await client.query(
      `INSERT INTO data_quality_merge_operations
        (user_id, issue_id, primary_lead_id, merged_lead_ids, merged_lead_count, field_updates, metadata)
       VALUES
        ($1, $2, $3, $4::uuid[], $5, $6::jsonb, $7::jsonb)
       RETURNING *`,
      [
        userId,
        issueId,
        primaryLeadId,
        duplicateLeadIds,
        duplicateLeadIds.length,
        JSON.stringify(fieldUpdates),
        JSON.stringify({
          issueStatusAtMerge: issue ? issue.status : null,
          source: 'data_quality_issue_merge',
        }),
      ]
    );
    const mergeOperation = mergeOpRes.rows[0];

    await client.query(
      `UPDATE data_quality_issues
       SET status = 'resolved',
           resolved_at = NOW(),
           updated_at = NOW(),
           details = jsonb_set(COALESCE(details, '{}'::jsonb), '{mergeOperationId}', to_jsonb($1::text), true)
       WHERE user_id = $2
         AND issue_type = 'potential_duplicate'
         AND (id = $3 OR lead_id = $4 OR lead_id = ANY($5::uuid[]))`,
      [mergeOperation.id, userId, issueId, primaryLeadId, duplicateLeadIds]
    );

    await client.query(
      `DELETE FROM outbound_leads
       WHERE user_id = $1
         AND id = ANY($2::uuid[])`,
      [userId, duplicateLeadIds]
    );

    await client.query('COMMIT');

    await syncDataQualityIssuesForUser(userId);

    return {
      mergeOperation: outboundUtils.mapDataQualityMergeOperationRow(mergeOperation),
      primaryLead: updatedPrimaryRes.rows[0],
      mergedLeadIds: duplicateLeadIds,
      resolvedIssueId: issueId,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { syncDataQualityIssuesForUser, mergeDataQualityIssue };
