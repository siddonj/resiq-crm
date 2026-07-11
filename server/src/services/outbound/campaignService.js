const pool = require('../../models/db');
const outboundUtils = require('../../utils/outboundUtils');
const { logAction } = require('../auditLogger');
const { autoStopOpenSequenceEnrollments } = require('./sequenceService');

async function createCampaign({ userId, orgId, name, channels, audienceFilter, notes, leadIds, logLeadEventFn }) {
  const campaignRes = await pool.query(
    `INSERT INTO outbound_campaigns (user_id, name, channels, audience_filter, notes, status)
     VALUES ($1, $2, $3::text[], $4::jsonb, $5, 'draft')
     RETURNING *`,
    [userId, name, channels, JSON.stringify(audienceFilter || {}), notes]
  );

  const campaign = campaignRes.rows[0];
  const safeLeadIds = outboundUtils.sanitizeUuidList(leadIds);
  let addedMembers = 0;

  if (safeLeadIds.length > 0) {
    const membersRes = await pool.query(
      `INSERT INTO outbound_campaign_members (campaign_id, lead_id, member_status)
       SELECT $1, l.id, 'queued'
       FROM outbound_leads l
       WHERE l.user_id = $2
         AND l.id = ANY($3::uuid[])
       ON CONFLICT (campaign_id, lead_id) DO NOTHING
       RETURNING id`,
      [campaign.id, userId, safeLeadIds]
    );
    addedMembers = membersRes.rowCount;
  }

  if (logLeadEventFn) {
    await logLeadEventFn({
      userId,
      leadId: null,
      eventType: 'campaign_created',
      metadata: {
        campaignId: campaign.id,
        channels,
        addedMembers,
      },
    });
  }

  logAction(userId, null, 'outbound_campaign_created', 'outbound_campaign', campaign.id, name, {
    channels,
    addedMembers,
  }, orgId);

  return {
    ...campaign,
    addedMembers,
  };
}

async function listCampaigns(userId, status, limit) {
  const params = [userId];
  const filters = ['c.user_id = $1'];

  if (status) {
    params.push(String(status));
    filters.push(`c.status = $${params.length}`);
  }

  params.push(Math.min(500, Math.max(1, Number(limit || 100))));

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

  return {
    total: result.rows.length,
    campaigns: result.rows,
  };
}

async function getCampaign(userId, campaignId) {
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
    [campaignId, userId]
  );

  if (campaignRes.rows.length === 0) {
    throw new Error('Campaign not found.');
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
    [campaignId]
  );

  return {
    campaign: campaignRes.rows[0],
    members: membersRes.rows,
  };
}

async function addMembers({ userId, orgId, campaignId, leadIds }) {
  const safeLeadIds = outboundUtils.sanitizeUuidList(leadIds);
  if (safeLeadIds.length === 0) {
    throw new Error('leadIds array is required.');
  }

  const campaignCheck = await pool.query(
    `SELECT id, name FROM outbound_campaigns WHERE id = $1 AND user_id = $2`,
    [campaignId, userId]
  );
  if (campaignCheck.rows.length === 0) {
    throw new Error('Campaign not found.');
  }

  const membersRes = await pool.query(
    `INSERT INTO outbound_campaign_members (campaign_id, lead_id, member_status)
     SELECT $1, l.id, 'queued'
     FROM outbound_leads l
     WHERE l.user_id = $2
       AND l.id = ANY($3::uuid[])
     ON CONFLICT (campaign_id, lead_id) DO NOTHING
     RETURNING id`,
    [campaignId, userId, safeLeadIds]
  );

  await pool.query(
    `UPDATE outbound_campaigns
     SET updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [campaignId, userId]
  );

  logAction(userId, null, 'outbound_campaign_members_added', 'outbound_campaign', campaignId, campaignCheck.rows[0].name, { addedMembers: membersRes.rowCount }, orgId);

  return {
    campaignId,
    addedMembers: membersRes.rowCount,
  };
}

async function updateCampaignStatus({ userId, orgId, campaignId, nextStatus }) {
  const existingRes = await pool.query(
    `SELECT id, name, status FROM outbound_campaigns WHERE id = $1 AND user_id = $2`,
    [campaignId, userId]
  );
  if (existingRes.rows.length === 0) {
    throw new Error('Campaign not found.');
  }

  const updatedRes = await pool.query(
    `UPDATE outbound_campaigns
     SET status = $1::varchar,
         updated_at = NOW(),
         started_at = CASE WHEN $1::varchar = 'active'::varchar AND started_at IS NULL THEN NOW() ELSE started_at END,
         completed_at = CASE WHEN $1::varchar = 'completed'::varchar THEN NOW() ELSE completed_at END
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [nextStatus, campaignId, userId]
  );

  const campaign = updatedRes.rows[0];
  logAction(userId, null, 'outbound_campaign_status_updated', 'outbound_campaign', campaign.id, campaign.name, {
    from: existingRes.rows[0].status,
    to: campaign.status,
  }, orgId);

  return campaign;
}

async function updateMemberStatus({
  userId,
  campaignId,
  memberId,
  memberStatus,
  lastChannel,
  statusReason,
  logLeadEventFn,
}) {
  const safeMemberStatus = String(memberStatus || '').trim();
  const safeLastChannel = lastChannel == null ? null : String(lastChannel).trim().toLowerCase();
  const safeReason = statusReason == null ? '' : String(statusReason).trim();

  if (!outboundUtils.VALID_CAMPAIGN_MEMBER_STATUSES.has(safeMemberStatus)) {
    throw new Error('Invalid memberStatus.');
  }

  if (safeLastChannel && !outboundUtils.VALID_CAMPAIGN_CHANNELS.has(safeLastChannel)) {
    throw new Error('Invalid lastChannel.');
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
    [safeMemberStatus, safeLastChannel, memberId, campaignId, userId]
  );

  if (updatedRes.rows.length === 0) {
    throw new Error('Campaign member not found.');
  }

  await pool.query(
    `UPDATE outbound_campaigns
     SET updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [campaignId, userId]
  );

  const updatedMember = updatedRes.rows[0];
  const mappedLeadStatus = outboundUtils.CAMPAIGN_MEMBER_TO_LEAD_STATUS[safeMemberStatus];
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
      [mappedLeadStatus, safeReason, leadId, userId]
    );
  }

  if (leadId && logLeadEventFn) {
    await logLeadEventFn({
      userId,
      leadId,
      eventType: 'campaign_member_status_changed',
      metadata: {
        campaignId,
        memberId,
        memberStatus: safeMemberStatus,
        lastChannel: safeLastChannel,
      },
    });
  }

  if (leadId && safeMemberStatus === 'replied') {
    if (logLeadEventFn) {
      await logLeadEventFn({
        userId,
        leadId,
        eventType: 'lead_replied',
        metadata: { campaignId, memberId },
      });
    }
    autoStoppedEnrollmentIds = await autoStopOpenSequenceEnrollments({
      userId,
      leadId,
      reason: 'Auto-stopped after reply',
      triggerSource: 'campaign_member_status',
      metadata: { campaignId, memberId, memberStatus: safeMemberStatus },
    });
  } else if (leadId && safeMemberStatus === 'opportunity') {
    if (logLeadEventFn) {
      await logLeadEventFn({
        userId,
        leadId,
        eventType: 'opportunity_created',
        metadata: { campaignId, memberId },
      });
    }
  } else if (leadId && safeMemberStatus === 'meeting') {
    if (logLeadEventFn) {
      await logLeadEventFn({
        userId,
        leadId,
        eventType: 'meeting_booked',
        metadata: { campaignId, memberId },
      });
    }
    autoStoppedEnrollmentIds = await autoStopOpenSequenceEnrollments({
      userId,
      leadId,
      reason: 'Auto-stopped after meeting booked',
      triggerSource: 'campaign_member_status',
      metadata: { campaignId, memberId, memberStatus: safeMemberStatus },
    });
  } else if (leadId && safeMemberStatus === 'suppressed') {
    if (logLeadEventFn) {
      await logLeadEventFn({
        userId,
        leadId,
        eventType: 'lead_suppressed',
        metadata: { campaignId, memberId, reason: safeReason || null },
      });
    }
    autoStoppedEnrollmentIds = await autoStopOpenSequenceEnrollments({
      userId,
      leadId,
      reason: 'Auto-stopped after suppression update',
      triggerSource: 'campaign_member_status',
      metadata: { campaignId, memberId, memberStatus: safeMemberStatus },
    });
  }

  return {
    ...updatedMember,
    autoStoppedEnrollmentIds,
  };
}

module.exports = {
  createCampaign,
  listCampaigns,
  getCampaign,
  addMembers,
  updateCampaignStatus,
  updateMemberStatus,
};
