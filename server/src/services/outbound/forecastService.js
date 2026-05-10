const pool = require('../../models/db');
const outboundUtils = require('../../utils/outboundUtils');

async function buildOutboundForecastSummary(userId, periodType = 'monthly') {
  const normalizedPeriodType = outboundUtils.VALID_FORECAST_PERIOD_TYPES.has(periodType) ? periodType : 'monthly';
  const period = outboundUtils.getCurrentPeriodWindow(normalizedPeriodType);
  const progress = outboundUtils.calculatePeriodProgress(period.periodStart, period.periodEnd);

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

  const closedValue = outboundUtils.round2(closedCount * baselineValue * outboundUtils.FORECAST_BUCKET_WEIGHTS.closed);
  const commitValue = outboundUtils.round2(
    closedValue + commitOnlyCount * baselineValue * outboundUtils.FORECAST_BUCKET_WEIGHTS.commitOnly
  );
  const bestCaseValue = outboundUtils.round2(
    commitValue + bestCaseOnlyCount * baselineValue * outboundUtils.FORECAST_BUCKET_WEIGHTS.bestCaseOnly
  );
  const totalForecastValue = bestCaseValue;

  const meetingsActual = Number(activityRow.meetings_actual || 0);
  const opportunitiesActual = Number(activityRow.opportunities_actual || 0);
  const revenueActual = Number(revenueRow.revenue_actual || 0);
  const dealsWonActual = Number(revenueRow.deals_won_actual || 0);

  const projectionScale = progress.elapsedDays > 0 ? progress.totalDays / progress.elapsedDays : 0;
  const meetingsProjected = outboundUtils.round2(meetingsActual * projectionScale);
  const opportunitiesProjected = outboundUtils.round2(opportunitiesActual * projectionScale);
  const revenueProjected = outboundUtils.round2(revenueActual * projectionScale);

  const targetMeetings = goal ? Number(goal.target_meetings || 0) : 0;
  const targetOpportunities = goal ? Number(goal.target_opportunities || 0) : 0;
  const targetRevenue = goal ? Number(goal.target_revenue || 0) : 0;

  const goalGap = goal
    ? {
        meetingsGap: outboundUtils.round2(targetMeetings - meetingsProjected),
        opportunitiesGap: outboundUtils.round2(targetOpportunities - opportunitiesProjected),
        revenueGap: outboundUtils.round2(targetRevenue - revenueProjected),
      }
    : null;

  const metadata = {
    baselineValue: outboundUtils.round2(baselineValue),
    averageClosedWonDealValue: outboundUtils.round2(averageClosedWonDealValue),
    projected: {
      meetings: meetingsProjected,
      opportunities: opportunitiesProjected,
      revenue: revenueProjected,
    },
    actual: {
      meetings: meetingsActual,
      opportunities: opportunitiesActual,
      revenue: outboundUtils.round2(revenueActual),
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
      revenue: outboundUtils.round2(revenueActual),
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
          targetRevenue: outboundUtils.round2(targetRevenue),
          notes: goal.notes,
          updatedAt: goal.updated_at,
        }
      : null,
    gapToGoal: goalGap,
    progress,
    assumptions: {
      baselineDealValue: outboundUtils.round2(baselineValue),
      averageClosedWonDealValue: outboundUtils.round2(averageClosedWonDealValue),
      bucketWeights: {
        closed: outboundUtils.FORECAST_BUCKET_WEIGHTS.closed,
        commitOnly: outboundUtils.FORECAST_BUCKET_WEIGHTS.commitOnly,
        bestCaseOnly: outboundUtils.FORECAST_BUCKET_WEIGHTS.bestCaseOnly,
      },
    },
  };
}

async function buildOutboundAttributionSummary(userId, periodType = 'monthly') {
  const normalizedPeriodType = outboundUtils.VALID_FORECAST_PERIOD_TYPES.has(periodType) ? periodType : 'monthly';
  const period = outboundUtils.getCurrentPeriodWindow(normalizedPeriodType);
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
  const attributedRevenue = outboundUtils.round2(Number(overview.attributed_revenue || 0));

  const bySource = sourceRes.rows.map((row) => {
    const imported = Number(row.imported_leads || 0);
    const contacted = Number(row.contacted_leads || 0);
    const replied = Number(row.replied_leads || 0);
    const meetings = Number(row.meeting_leads || 0);
    const opportunities = Number(row.opportunity_leads || 0);
    const revenue = outboundUtils.round2(Number(row.attributed_revenue || 0));
    return {
      sourceType: row.source_type,
      sourceReference: row.source_reference,
      importedLeads: imported,
      contactedLeads: contacted,
      repliedLeads: replied,
      meetingLeads: meetings,
      opportunityLeads: opportunities,
      attributedRevenue: revenue,
      meetingRateFromImported: outboundUtils.safeRate(meetings, imported),
      opportunityRateFromImported: outboundUtils.safeRate(opportunities, imported),
      replyRateFromContacted: outboundUtils.safeRate(replied, contacted),
      valuePerImportedLead: imported > 0 ? outboundUtils.round2(revenue / imported) : 0,
      valuePerOpportunity: opportunities > 0 ? outboundUtils.round2(revenue / opportunities) : 0,
    };
  });

  const bySequence = sequenceRes.rows.map((row) => {
    const contacted = Number(row.contacted_leads || 0);
    const replied = Number(row.replied_leads || 0);
    const meetings = Number(row.meeting_leads || 0);
    const opportunities = Number(row.opportunity_leads || 0);
    const revenue = outboundUtils.round2(Number(row.attributed_revenue || 0));
    return {
      sequenceId: row.sequence_id,
      sequenceName: row.sequence_name,
      contactedLeads: contacted,
      repliedLeads: replied,
      meetingLeads: meetings,
      opportunityLeads: opportunities,
      attributedRevenue: revenue,
      replyRateFromContacted: outboundUtils.safeRate(replied, contacted),
      meetingRateFromContacted: outboundUtils.safeRate(meetings, contacted),
      opportunityRateFromContacted: outboundUtils.safeRate(opportunities, contacted),
    };
  });

  const personaBuckets = new Map();
  for (const row of personaRowsRes.rows) {
    const persona = outboundUtils.classifyPersonaTitle(row.title);
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
      const revenue = outboundUtils.round2(bucket.attributedRevenue);
      return {
        persona: bucket.persona,
        leads,
        contactedLeads: contacted,
        repliedLeads: replied,
        meetingLeads: meetings,
        opportunityLeads: opportunities,
        attributedRevenue: revenue,
        meetingRateFromLeads: outboundUtils.safeRate(meetings, leads),
        opportunityRateFromLeads: outboundUtils.safeRate(opportunities, leads),
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
    attributedRevenue: outboundUtils.round2(Number(row.attributed_revenue || 0)),
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
      meetingRateFromImported: outboundUtils.safeRate(meetingLeads, importedLeads),
      opportunityRateFromImported: outboundUtils.safeRate(opportunityLeads, importedLeads),
      replyRateFromContacted: outboundUtils.safeRate(repliedLeads, contactedLeads),
      valuePerImportedLead: importedLeads > 0 ? outboundUtils.round2(attributedRevenue / importedLeads) : 0,
      valuePerOpportunity: opportunityLeads > 0 ? outboundUtils.round2(attributedRevenue / opportunityLeads) : 0,
      estimatedSpend: 0,
    },
    bySource,
    bySequence,
    byPersona,
    lineage,
    assumptions: {
      attributionModel: 'event_touchpoints',
      stageOrder: outboundUtils.ATTRIBUTION_STAGE_ORDER,
      opportunityValueFallback: outboundUtils.round2(baselineValue),
      estimatedSpendModel: 'manual_cost_tracking_pending',
    },
  };
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

module.exports = { buildOutboundForecastSummary, buildOutboundAttributionSummary };
