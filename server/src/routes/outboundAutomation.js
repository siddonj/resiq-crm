const express = require('express');
const multer = require('multer');
const { db, sql, ownershipWhere, pool } = require('../db');
const auth = require('../middleware/auth');
const { scoreLead } = require('../services/outboundScoring');
const { logAction } = require('../services/auditLogger');
const { getSetting } = require('../services/appSettings');
const outboundUtils = require('../utils/outboundUtils');
const leadService = require('../services/outbound/leadService');
const draftService = require('../services/outbound/draftService');
const sequenceService = require('../services/outbound/sequenceService');
const campaignService = require('../services/outbound/campaignService');
const { validateBody, validateQuery } = require('../middleware/validateZod');
const {
  ImportCsvSchema,
  LeadFiltersSchema,
  CreateCampaignSchema,
  UpdateCampaignStatusSchema,
  CreateDraftSchema,
  EnrollSequenceSchema,
  ChangeSequenceStateSchema,
  BulkActionSchema,
  SuppressionSchema,
  CreateWorkflowRuleSchema,
  CreateMultifamilyObjectSchema,
  AssociateToObjectSchema,
  SaveGoalsSchema,
  WorkspaceConfigSchema,
} = require('../utils/outboundSchemas');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

async function logLeadEvent({
  userId,
  leadId,
  eventType,
  channel = null,
  metadata = {},
  runRules = true,
}) {
  const insertedEvent = await sql`
    INSERT INTO lead_source_events (user_id, lead_id, event_type, channel, metadata)
    VALUES (${userId}, ${leadId}, ${eventType}, ${channel}, ${JSON.stringify(metadata)})
    RETURNING id, created_at
  `.execute(db);
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

  const attributionStage = outboundUtils.deriveAttributionStage(eventType, metadata);
  if (!attributionStage) return;

  const leadRes = await sql`
    SELECT source_type, source_reference
    FROM outbound_leads
    WHERE id = ${leadId}
      AND user_id = ${userId}
    LIMIT 1
  `.execute(db);
  const lead = leadRes.rows[0];
  if (!lead) return;

  const campaignId = outboundUtils.sanitizeUuidValue(metadata.campaignId || metadata.campaign_id);
  const sequenceId = outboundUtils.sanitizeUuidValue(metadata.sequenceId || metadata.sequence_id);
  let attributedValue = 0;

  if (attributionStage === 'opportunity') {
    const explicitValue = outboundUtils.toFiniteNumber(
      metadata.attributedValue ?? metadata.attributed_value ?? metadata.revenue ?? metadata.expectedRevenue,
      0
    );
    attributedValue = explicitValue > 0 ? outboundUtils.round2(explicitValue) : outboundUtils.round2(await getAverageClosedWonValue(userId));
  }

  await sql`
    INSERT INTO attribution_touchpoints
      (lead_event_id, user_id, lead_id, source_type, source_reference, campaign_id, sequence_id,
       event_type, attribution_stage, channel, touch_weight, attributed_value, metadata, occurred_at)
     VALUES
      (${eventId}, ${userId}, ${leadId}, ${lead.source_type || 'other'}, ${lead.source_reference || null}, ${campaignId}, ${sequenceId}, ${eventType}, ${attributionStage}, ${channel}, 1, ${attributedValue}, ${JSON.stringify(metadata || {})}::jsonb, ${occurredAt || new Date().toISOString()})
     ON CONFLICT (lead_event_id) DO NOTHING
  `.execute(db);
}

async function computeEngagementSignals(userId, leadId) {
  const result = await sql`
    SELECT
      COUNT(*) FILTER (WHERE event_type IN ('draft_generated', 'draft_approved'))::int AS prep_events,
      COUNT(*) FILTER (WHERE event_type IN ('draft_sent', 'linkedin_task_completed'))::int AS contact_events,
      COUNT(*) FILTER (WHERE event_type IN ('lead_replied', 'meeting_booked', 'opportunity_created'))::int AS positive_events,
      MAX(created_at) AS last_event_at
    FROM lead_source_events
    WHERE user_id = ${userId}
      AND lead_id = ${leadId}
  `.execute(db);

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
  await sql`
    INSERT INTO lead_score_history
      (user_id, lead_id, fit_score, intent_score, engagement_score, total_score, status, next_recommended_action, reasons, source)
     VALUES (${userId}, ${leadId}, ${score.fitScore}, ${score.intentScore}, ${score.engagementScore || 0}, ${score.totalScore}, ${score.status}, ${score.nextRecommendedAction}, ${JSON.stringify(score.reasons || {})}::jsonb, ${source})
  `.execute(db);
}

async function getDailySendUsage(userId, channel) {
  const eventTypes = outboundUtils.SEND_EVENT_TYPES[channel] || [];
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

  const result = await sql`
    SELECT COUNT(*)::int AS used
    FROM lead_source_events
    WHERE user_id = ${userId}
      AND channel = ${channel}
      AND event_type = ANY(${eventTypes}::text[])
      AND created_at >= date_trunc('day', NOW())
  `.execute(db);

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












async function syncDataQualityIssuesForUser(userId) {
  const leadsRes = await sql`
    SELECT id, name, email, linkedin_url, company, title, source_confidence, created_at, updated_at
    FROM outbound_leads
    WHERE user_id = ${userId}
  `.execute(db);
  const leads = leadsRes.rows;
  const duplicateGroupByLead = outboundUtils.buildDuplicateGroupIndex(leads);

  const detectedIssues = [];
  for (const lead of leads) {
    const duplicateGroup = duplicateGroupByLead.get(lead.id) || null;
    detectedIssues.push(...outboundUtils.buildLeadDataQualityIssueCandidates(lead, { duplicateGroup }));
  }

  await sequenceService.upsertDataQualityIssues(userId, detectedIssues);

  const activeIssueKeys = detectedIssues.map((issue) => issue.issueKey);
  await sql`
    UPDATE data_quality_issues
    SET status = 'resolved',
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE user_id = ${userId}
      AND status = 'open'
      AND NOT (issue_key = ANY(${activeIssueKeys}::text[]))
  `.execute(db);
}

















async function verifyMultifamilyAssociationTarget(userId, entityType, entityId) {
  if (entityType === 'outbound_lead') {
    const result = await sql`
      SELECT id, name, email, company, title
      FROM outbound_leads
      WHERE id = ${entityId}
        AND user_id = ${userId}
      LIMIT 1
    `.execute(db);
    return result.rows[0] || null;
  }

  if (entityType === 'contact') {
    const result = await sql`
      SELECT id, name, email, company, NULL::text AS title
      FROM contacts
      WHERE id = ${entityId}
        AND user_id = ${userId}
      LIMIT 1
    `.execute(db);
    return result.rows[0] || null;
  }

  if (entityType === 'deal') {
    const result = await sql`
      SELECT d.id, d.title AS name, NULL::text AS email, c.company AS company, d.service_line AS title
      FROM deals d
      LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE d.id = ${entityId}
        AND d.user_id = ${userId}
      LIMIT 1
    `.execute(db);
    return result.rows[0] || null;
  }

  return null;
}


async function getAverageClosedWonValue(userId) {
  const result = await sql`
    SELECT
      COALESCE(AVG(value), 0)::numeric(14,2) AS avg_closed_won_value
    FROM deals
    WHERE user_id = ${userId}
      AND stage = 'closed_won'
      AND value IS NOT NULL
      AND value > 0
  `.execute(db);
  const value = Number(result.rows[0]?.avg_closed_won_value || 0);
  return value > 0 ? value : 25000;
}





async function upsertSequenceEnrollmentForRule({ userId, sequenceId, leadId }) {
  const sequenceRes = await sql`
    SELECT id, name
    FROM sequences
    WHERE id = ${sequenceId}
      AND user_id = ${userId}
  `.execute(db);
  if (!sequenceRes.rows.length) {
    throw new Error('Sequence not found for enroll_sequence action');
  }

  const stepsRes = await sql`
    SELECT COUNT(*)::int AS total_steps
    FROM sequence_steps
    WHERE sequence_id = ${sequenceId}
  `.execute(db);
  const totalSteps = Number(stepsRes.rows[0]?.total_steps || 0);
  if (totalSteps === 0) {
    throw new Error('Sequence has no steps for enroll_sequence action');
  }

  const openRes = await sql`
    SELECT id
    FROM outbound_sequence_enrollments
    WHERE user_id = ${userId}
      AND lead_id = ${leadId}
      AND status IN ('active', 'paused')
    LIMIT 1
  `.execute(db);
  if (openRes.rows.length) {
    return {
      skipped: true,
      message: 'Lead already has an open sequence enrollment',
      enrollmentId: openRes.rows[0].id,
    };
  }

  const insertedRes = await sql`
    INSERT INTO outbound_sequence_enrollments
      (user_id, sequence_id, lead_id, status, current_step, next_step_due_at)
    VALUES (${userId}, ${sequenceId}, ${leadId}, 'active', 1, NOW())
    RETURNING id
  `.execute(db);
  const enrollmentId = insertedRes.rows[0].id;

  await sequenceService.recordSequenceTransition({
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
        if (!outboundUtils.VALID_OUTBOUND_LEAD_STATUSES.has(nextStatus)) {
          throw new Error('Invalid lead status in update_lead_status action');
        }
        if (!dryRun) {
          await sql`
            UPDATE outbound_leads
            SET status = ${nextStatus},
                updated_at = NOW()
            WHERE id = ${lead.id}
              AND user_id = ${userId}
          `.execute(db);
        }
        result.nextStatus = nextStatus;
      } else if (action.type === 'set_next_recommended_action') {
        if (!lead?.id) throw new Error('set_next_recommended_action requires lead context');
        const nextAction = String(action.config.value || action.config.nextRecommendedAction || '').trim();
        if (!nextAction) throw new Error('set_next_recommended_action requires a value');
        if (!dryRun) {
          await sql`
            UPDATE outbound_leads
            SET next_recommended_action = ${nextAction},
                updated_at = NOW()
            WHERE id = ${lead.id}
              AND user_id = ${userId}
          `.execute(db);
        }
        result.value = nextAction;
      } else if (action.type === 'create_reminder') {
        const message = String(action.config.message || action.config.title || '').trim();
        const dueDays = Math.max(0, Number(action.config.dueDays ?? action.config.due_days ?? 1));
        if (!message) throw new Error('create_reminder requires message');
        if (!dryRun) {
          await sql`
            INSERT INTO reminders (user_id, message, remind_at)
            VALUES (${userId}, ${message}, NOW() + (${String(dueDays)} || ' days')::interval)
          `.execute(db);
        }
        result.message = message;
        result.dueDays = dueDays;
      } else if (action.type === 'suppress_lead') {
        if (!lead?.id) throw new Error('suppress_lead requires lead context');
        const reason = String(action.config.reason || 'Suppressed by workflow rule').trim();
        if (!dryRun) {
          await sql`
            UPDATE outbound_leads
            SET status = 'suppressed',
                suppression_reason = ${reason},
                updated_at = NOW()
            WHERE id = ${lead.id}
              AND user_id = ${userId}
          `.execute(db);
          await sequenceService.autoStopOpenSequenceEnrollments({
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
              ...(outboundUtils.isPlainObject(action.config.metadata) ? action.config.metadata : {}),
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
  const normalizedStatus = outboundUtils.VALID_RULE_RUN_STATUSES.has(status) ? status : 'failed';
  await sql`
    INSERT INTO workflow_rule_runs
      (rule_id, user_id, trigger_source, input_context, matched, status, actions_executed, error_message)
    VALUES (${ruleId}, ${userId}, ${triggerSource}, ${JSON.stringify(inputContext || {})}::jsonb, ${matched}, ${normalizedStatus}, ${JSON.stringify(actionsExecuted || [])}::jsonb, ${errorMessage})
  `.execute(db);
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

  const filters = [sql`user_id = ${userId}`];
  if (!includeDisabled) {
    filters.push(sql`enabled = TRUE`);
  }

  if (limitToRuleId) {
    filters.push(sql`id = ${limitToRuleId}`);
  } else {
    filters.push(sql`trigger_event = ${eventName}`);
  }

  const rulesRes = await sql`
    SELECT *
    FROM workflow_rules
    WHERE ${sql.join(filters, sql` AND `)}
    ORDER BY priority ASC, created_at ASC
  `.execute(db);

  if (!rulesRes.rows.length) return [];

  const lead = leadId
    ? (
        await sql`
          SELECT *
          FROM outbound_leads
          WHERE id = ${leadId}
            AND user_id = ${userId}
          LIMIT 1
        `.execute(db)
      ).rows[0] || null
    : null;

  const context = {
    lead,
    event: {
      type: eventName,
      data: outboundUtils.isPlainObject(eventData) ? eventData : {},
    },
    now: new Date().toISOString(),
  };

  const outputs = [];
  for (const rule of rulesRes.rows) {
    const matched = outboundUtils.evaluateRuleConditions(rule.conditions || {}, context);
    const trueActions = outboundUtils.normalizeRuleActions(rule.true_actions);
    const falseActions = outboundUtils.normalizeRuleActions(rule.false_actions);
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
  const normalizedPeriodType = outboundUtils.VALID_FORECAST_PERIOD_TYPES.has(periodType) ? periodType : 'monthly';
  const period = outboundUtils.getCurrentPeriodWindow(normalizedPeriodType);
  const progress = outboundUtils.calculatePeriodProgress(period.periodStart, period.periodEnd);

  const [bucketRes, activityRes, revenueRes, avgDealRes, goalRes] = await Promise.all([
    sql`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'opportunity' THEN 1 ELSE 0 END), 0)::int AS closed_count,
        COALESCE(SUM(CASE WHEN status = 'meeting' THEN 1 ELSE 0 END), 0)::int AS commit_only_count,
        COALESCE(SUM(CASE WHEN status IN ('contacted', 'replied') THEN 1 ELSE 0 END), 0)::int AS best_case_only_count
      FROM outbound_leads
      WHERE user_id = ${userId}
    `.execute(db),
    sql`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'meeting_booked')::int AS meetings_actual,
        COUNT(*) FILTER (
          WHERE event_type = 'opportunity_created'
             OR (event_type = 'campaign_member_status_changed' AND COALESCE(metadata->>'memberStatus', '') = 'opportunity')
        )::int AS opportunities_actual
      FROM lead_source_events
      WHERE user_id = ${userId}
        AND created_at >= ${period.periodStart}::date
        AND created_at < (${period.periodEnd}::date + INTERVAL '1 day')
    `.execute(db),
    sql`
      SELECT
        COALESCE(SUM(value), 0)::numeric(14,2) AS revenue_actual,
        COUNT(*)::int AS deals_won_actual
      FROM deals
      WHERE user_id = ${userId}
        AND stage = 'closed_won'
        AND COALESCE(close_date::timestamptz, updated_at, created_at) >= ${period.periodStart}::date
        AND COALESCE(close_date::timestamptz, updated_at, created_at) < (${period.periodEnd}::date + INTERVAL '1 day')
    `.execute(db),
    sql`
      SELECT
        COALESCE(AVG(value), 0)::numeric(14,2) AS avg_closed_won_value
      FROM deals
      WHERE user_id = ${userId}
        AND stage = 'closed_won'
        AND value IS NOT NULL
        AND value > 0
    `.execute(db),
    sql`
      SELECT *
      FROM sales_goals
      WHERE user_id = ${userId}
        AND period_type = ${period.periodType}
        AND period_start = ${period.periodStart}::date
        AND period_end = ${period.periodEnd}::date
      LIMIT 1
    `.execute(db),
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

  await sql`
    INSERT INTO pipeline_forecasts
      (user_id, period_type, period_start, period_end, snapshot_date,
       commit_count, best_case_count, closed_count,
       commit_value, best_case_value, closed_value, total_forecast_value, metadata)
    VALUES (${userId}, ${period.periodType}, ${period.periodStart}::date, ${period.periodEnd}::date, CURRENT_DATE, ${commitCount}, ${bestCaseCount}, ${closedCount}, ${commitValue}, ${bestCaseValue}, ${closedValue}, ${totalForecastValue}, ${JSON.stringify(metadata)}::jsonb)
    ON CONFLICT (user_id, period_type, period_start, period_end, snapshot_date)
    DO UPDATE SET
      commit_count = EXCLUDED.commit_count,
      best_case_count = EXCLUDED.best_case_count,
      closed_count = EXCLUDED.closed_count,
      commit_value = EXCLUDED.commit_value,
      best_case_value = EXCLUDED.best_case_value,
      closed_value = EXCLUDED.closed_value,
      total_forecast_value = EXCLUDED.total_forecast_value,
      metadata = EXCLUDED.metadata
  `.execute(db);

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
    sql`
      SELECT
        COUNT(DISTINCT lead_id) FILTER (WHERE attribution_stage = 'imported')::int AS imported_leads,
        COUNT(DISTINCT lead_id) FILTER (WHERE attribution_stage = 'contacted')::int AS contacted_leads,
        COUNT(DISTINCT lead_id) FILTER (WHERE attribution_stage = 'replied')::int AS replied_leads,
        COUNT(DISTINCT lead_id) FILTER (WHERE attribution_stage = 'meeting')::int AS meeting_leads,
        COUNT(DISTINCT lead_id) FILTER (WHERE attribution_stage = 'opportunity')::int AS opportunity_leads,
        COALESCE(SUM(attributed_value) FILTER (WHERE attribution_stage = 'opportunity'), 0)::numeric(14,2) AS attributed_revenue
      FROM attribution_touchpoints
      WHERE user_id = ${userId}
        AND occurred_at >= ${period.periodStart}::date
        AND occurred_at < (${period.periodEnd}::date + INTERVAL '1 day')
    `.execute(db),
    sql`
      SELECT
        COALESCE(NULLIF(t.source_type, ''), 'other') AS source_type,
        COALESCE(NULLIF(t.source_reference, ''), 'unknown') AS source_reference,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'imported')::int AS imported_leads,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'contacted')::int AS contacted_leads,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'replied')::int AS replied_leads,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'meeting')::int AS meeting_leads,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'opportunity')::int AS opportunity_leads,
        COALESCE(SUM(t.attributed_value) FILTER (WHERE t.attribution_stage = 'opportunity'), 0)::numeric(14,2) AS attributed_revenue
      FROM attribution_touchpoints t
      WHERE t.user_id = ${userId}
        AND t.occurred_at >= ${period.periodStart}::date
        AND t.occurred_at < (${period.periodEnd}::date + INTERVAL '1 day')
      GROUP BY 1, 2
      ORDER BY attributed_revenue DESC, opportunity_leads DESC, meeting_leads DESC, contacted_leads DESC
      LIMIT 25
    `.execute(db),
    sql`
      SELECT
        t.sequence_id,
        COALESCE(s.name, 'Unknown sequence') AS sequence_name,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'contacted')::int AS contacted_leads,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'replied')::int AS replied_leads,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'meeting')::int AS meeting_leads,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'opportunity')::int AS opportunity_leads,
        COALESCE(SUM(t.attributed_value) FILTER (WHERE t.attribution_stage = 'opportunity'), 0)::numeric(14,2) AS attributed_revenue
      FROM attribution_touchpoints t
      LEFT JOIN sequences s ON s.id = t.sequence_id
      WHERE t.user_id = ${userId}
        AND t.sequence_id IS NOT NULL
        AND t.occurred_at >= ${period.periodStart}::date
        AND t.occurred_at < (${period.periodEnd}::date + INTERVAL '1 day')
      GROUP BY t.sequence_id, s.name
      ORDER BY attributed_revenue DESC, opportunity_leads DESC, meeting_leads DESC
      LIMIT 25
    `.execute(db),
    sql`
      SELECT
        t.lead_id,
        t.attribution_stage,
        t.attributed_value,
        l.title
      FROM attribution_touchpoints t
      LEFT JOIN outbound_leads l ON l.id = t.lead_id
      WHERE t.user_id = ${userId}
        AND t.occurred_at >= ${period.periodStart}::date
        AND t.occurred_at < (${period.periodEnd}::date + INTERVAL '1 day')
    `.execute(db),
    sql`
      SELECT
        COALESCE(NULLIF(t.source_type, ''), 'other') AS source_type,
        COALESCE(NULLIF(t.source_reference, ''), 'unknown') AS source_reference,
        COALESCE(t.sequence_id::text, 'unsequenced') AS sequence_key,
        COALESCE(s.name, 'Unsequenced') AS sequence_name,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'meeting')::int AS meetings,
        COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage = 'opportunity')::int AS opportunities,
        COALESCE(SUM(t.attributed_value) FILTER (WHERE t.attribution_stage = 'opportunity'), 0)::numeric(14,2) AS attributed_revenue
      FROM attribution_touchpoints t
      LEFT JOIN sequences s ON s.id = t.sequence_id
      WHERE t.user_id = ${userId}
        AND t.occurred_at >= ${period.periodStart}::date
        AND t.occurred_at < (${period.periodEnd}::date + INTERVAL '1 day')
      GROUP BY 1, 2, 3, 4
      HAVING COUNT(DISTINCT t.lead_id) FILTER (WHERE t.attribution_stage IN ('meeting', 'opportunity')) > 0
      ORDER BY attributed_revenue DESC, opportunities DESC, meetings DESC
      LIMIT 20
    `.execute(db),
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

router.use(auth);

/**
 * POST /api/outbound/leads/import/csv
 */
const MAX_CSV_ROWS = 10000;

router.post('/leads/import/csv', upload.single('file'), validateBody(ImportCsvSchema), async (req, res) => {
  const { sourceType, sourceReference, sourceConfidence } = req.validatedBody;

  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required.' });
  }

  // Validate MIME type
  const allowedMimeTypes = ['text/csv', 'application/vnd.ms-excel', 'application/csv'];
  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Invalid file type. Only CSV files are allowed.' });
  }

  const csvText = req.file.buffer.toString('utf8');
  const rows = outboundUtils.parseCSV(csvText);

  if (rows.length === 0) {
    return res.status(400).json({ error: 'CSV file is empty or has no data rows.' });
  }

  if (rows.length > MAX_CSV_ROWS) {
    return res.status(400).json({ error: `CSV exceeds maximum of ${MAX_CSV_ROWS} rows.` });
  }

  const importJob = await sql`
    INSERT INTO lead_import_jobs (user_id, filename, status)
    VALUES (${req.user.id}, ${req.file.originalname || 'upload.csv'}, 'processing')
    RETURNING id
  `.execute(db);

  const jobId = importJob.rows[0].id;
  const client = await pool.connect();

  try {
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
          [req.user.id, dedupeKey]
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
        await client.query(
          `INSERT INTO lead_score_history
            (user_id, lead_id, fit_score, intent_score, engagement_score, total_score, status, next_recommended_action, reasons, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
          [
            req.user.id,
            inserted.rows[0].id,
            score.fitScore,
            score.intentScore,
            0,
            score.totalScore,
            score.status,
            score.nextRecommendedAction,
            JSON.stringify(score.reasons || {}),
            'import',
          ]
        );
        await client.query(
          `INSERT INTO lead_source_events (user_id, lead_id, event_type, channel, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.user.id, inserted.rows[0].id, 'lead_imported', null, JSON.stringify({ sourceType, sourceReference })]
        );
      } catch (err) {
        failedRows++;
        if (errorSample.length < 20) {
          errorSample.push({ row, error: err.message });
        }
      }
    }

    await client.query('COMMIT');

    await sql`
      UPDATE lead_import_jobs
      SET status = 'completed',
          total_rows = ${rows.length},
          imported_rows = ${importedRows},
          duplicate_rows = ${duplicateRows},
          failed_rows = ${failedRows},
          error_sample = ${JSON.stringify(errorSample)}::jsonb,
          completed_at = NOW()
      WHERE id = ${jobId}
    `.execute(db);

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
    await client.query('ROLLBACK').catch(() => {});
    await sql`
      UPDATE lead_import_jobs
      SET status = 'failed',
          failed_rows = failed_rows + 1,
          error_sample = jsonb_build_array(jsonb_build_object('error', ${err.message})),
          completed_at = NOW()
      WHERE id = ${jobId}
    `.execute(db);
    return res.status(500).json({
      error: 'Failed to import CSV',
      message: err.message,
      jobId,
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/outbound/leads/import/:jobId/status
 */
router.get('/leads/import/:jobId/status', async (req, res) => {
  const result = await sql`
    SELECT id, status, filename, total_rows, imported_rows, duplicate_rows, failed_rows,
           error_sample, created_at, completed_at
    FROM lead_import_jobs
    WHERE id = ${req.params.jobId} AND user_id = ${req.user.id}
  `.execute(db);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Import job not found.' });
  }

  return res.json(result.rows[0]);
});

/**
 * GET /api/outbound/multifamily/summary
 */
router.get('/multifamily/summary', async (req, res) => {
  const [objectsRes, associationsRes] = await Promise.all([
    sql`
      SELECT
        object_type,
        COUNT(*)::int AS count
      FROM multifamily_objects
      WHERE user_id = ${req.user.id}
      GROUP BY object_type
    `.execute(db),
    sql`
      SELECT
        entity_type,
        COUNT(*)::int AS count
      FROM multifamily_object_associations
      WHERE user_id = ${req.user.id}
      GROUP BY entity_type
    `.execute(db),
  ]);

  const objectCounts = {
    portfolio: 0,
    property: 0,
    tech_stack: 0,
    initiative: 0,
  };
  for (const row of objectsRes.rows) {
    objectCounts[row.object_type] = Number(row.count || 0);
  }

  const associationCounts = {
    outbound_lead: 0,
    contact: 0,
    deal: 0,
    company: 0,
  };
  for (const row of associationsRes.rows) {
    associationCounts[row.entity_type] = Number(row.count || 0);
  }

  return res.json({
    objectCounts,
    associationCounts,
  });
});

/**
 * GET /api/outbound/multifamily/entities
 * Query: entityType=contact|deal|company, search, limit
 */
router.get('/multifamily/entities', async (req, res) => {
  const entityType = outboundUtils.normalizeMultifamilyExplorerEntityType(req.query.entityType || 'contact');
  const search = String(req.query.search || '').trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));

  if (!entityType) {
    return res.status(400).json({ error: 'Invalid entityType. Use contact, deal, or company.' });
  }

  const userId = req.user.id;
  const searchPattern = search ? `%${search}%` : null;

  if (entityType === 'contact') {
    const result = await sql`
SELECT
         c.id,
         c.name,
         c.email,
         c.company,
         COALESCE(c.job_title, NULL) AS title,
         c.created_at,
         (
           SELECT COUNT(*)::int
           FROM multifamily_object_associations moa
           WHERE moa.user_id = c.user_id
             AND moa.entity_type = 'contact'
             AND moa.entity_id = c.id
         ) AS association_count
       FROM contacts c
       WHERE c.user_id = ${userId}
       ${search ? sql`
         AND (
           c.name ILIKE ${searchPattern}
           OR COALESCE(c.email, '') ILIKE ${searchPattern}
           OR COALESCE(c.company, '') ILIKE ${searchPattern}
         )
       ` : sql``}
       ORDER BY association_count DESC, c.created_at DESC
       LIMIT ${sql.raw(String(limit))}
`.execute(db);

    return res.json({
      entityType,
      total: result.rows.length,
      entities: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email || null,
        company: row.company || null,
        title: row.title || null,
        associationCount: Number(row.association_count || 0),
        createdAt: row.created_at,
      })),
    });
  }

  if (entityType === 'deal') {
    const result = await sql`
SELECT
         d.id,
         d.title,
         d.stage,
         d.service_line,
         d.value,
         d.created_at,
         c.name AS contact_name,
         c.company AS contact_company,
         (
           SELECT COUNT(*)::int
           FROM multifamily_object_associations moa
           WHERE moa.user_id = d.user_id
             AND moa.entity_type = 'deal'
             AND moa.entity_id = d.id
         ) AS association_count
       FROM deals d
       LEFT JOIN contacts c ON c.id = d.contact_id
       WHERE d.user_id = ${userId}
       ${search ? sql`
         AND (
           d.title ILIKE ${searchPattern}
           OR COALESCE(c.name, '') ILIKE ${searchPattern}
           OR COALESCE(c.company, '') ILIKE ${searchPattern}
           OR COALESCE(d.service_line, '') ILIKE ${searchPattern}
         )
       ` : sql``}
       ORDER BY association_count DESC, d.created_at DESC
       LIMIT ${sql.raw(String(limit))}
`.execute(db);

    return res.json({
      entityType,
      total: result.rows.length,
      entities: result.rows.map((row) => ({
        id: row.id,
        name: row.title,
        stage: row.stage,
        serviceLine: row.service_line || null,
        value: Number(row.value || 0),
        contactName: row.contact_name || null,
        company: row.contact_company || null,
        associationCount: Number(row.association_count || 0),
        createdAt: row.created_at,
      })),
    });
  }

  const result = await sql`
WITH company_rollup AS (
       SELECT
         LOWER(BTRIM(company)) AS company_key,
         MAX(BTRIM(company)) AS company_name,
         COUNT(*) FILTER (WHERE source = 'contact')::int AS contact_count,
         COUNT(*) FILTER (WHERE source = 'outbound_lead')::int AS lead_count
       FROM (
         SELECT company, 'contact'::text AS source
         FROM contacts
         WHERE user_id = ${userId}
           AND company IS NOT NULL
           AND BTRIM(company) <> ''
         UNION ALL
         SELECT company, 'outbound_lead'::text AS source
         FROM outbound_leads
         WHERE user_id = ${userId}
           AND company IS NOT NULL
           AND BTRIM(company) <> ''
       ) companies
       GROUP BY LOWER(BTRIM(company))
     )
     SELECT
       company_name,
       contact_count,
       lead_count,
       (
         SELECT COUNT(*)::int
         FROM multifamily_object_associations moa
         WHERE moa.user_id = ${userId}
           AND moa.entity_type = 'company'
           AND LOWER(BTRIM(moa.company_name)) = company_rollup.company_key
       ) AS association_count
     FROM company_rollup
     WHERE 1 = 1
     ${search ? sql`AND company_name ILIKE ${searchPattern}` : sql``}
     ORDER BY association_count DESC, (contact_count + lead_count) DESC, company_name ASC
     LIMIT ${sql.raw(String(limit))}
`.execute(db);

  return res.json({
    entityType,
    total: result.rows.length,
    entities: result.rows.map((row) => ({
      id: row.company_name,
      companyName: row.company_name,
      contactCount: Number(row.contact_count || 0),
      leadCount: Number(row.lead_count || 0),
      associationCount: Number(row.association_count || 0),
    })),
  });
});

/**
 * GET /api/outbound/multifamily/objects
 * Query: objectType
 */
router.get('/multifamily/objects', async (req, res) => {
  const objectType = req.query.objectType ? outboundUtils.normalizeMultifamilyObjectType(req.query.objectType) : null;
  if (req.query.objectType && !objectType) {
    return res.status(400).json({ error: 'Invalid objectType.' });
  }

  const conditions = [sql`o.user_id = ${req.user.id}`];
  if (objectType) {
    conditions.push(sql`o.object_type = ${objectType}`);
  }

  const result = await sql`
    SELECT
      o.*,
      COUNT(a.id)::int AS total_association_count,
      COUNT(a.id) FILTER (WHERE a.entity_type = 'outbound_lead')::int AS outbound_lead_count,
      COUNT(a.id) FILTER (WHERE a.entity_type = 'contact')::int AS contact_count,
      COUNT(a.id) FILTER (WHERE a.entity_type = 'deal')::int AS deal_count,
      COUNT(a.id) FILTER (WHERE a.entity_type = 'company')::int AS company_count
    FROM multifamily_objects o
    LEFT JOIN multifamily_object_associations a
      ON a.object_id = o.id
     AND a.user_id = o.user_id
    WHERE ${sql.join(conditions, sql` AND `)}
    GROUP BY o.id
    ORDER BY o.object_type, o.updated_at DESC
  `.execute(db);

  return res.json({
    total: result.rows.length,
    objects: result.rows.map(outboundUtils.mapMultifamilyObjectRow),
  });
});

/**
 * POST /api/outbound/multifamily/objects
 * Body: { objectType, name, description?, metadata? }
 */
router.post('/multifamily/objects', validateBody(CreateMultifamilyObjectSchema), async (req, res) => {
  const { objectType, name, description, metadata } = req.validatedBody;

  const insertedRes = await sql`
INSERT INTO multifamily_objects
      (user_id, object_type, name, description, metadata, updated_at)
     VALUES
      (${req.user.id}, ${objectType}, ${name}, ${description}, ${JSON.stringify(metadata)}::jsonb, NOW())
     RETURNING *
`.execute(db);

  const inserted = insertedRes.rows[0];
  logAction(req.user.id, req.user.email, 'multifamily_object_created', 'multifamily_object', inserted.id, inserted.name, {
    objectType: inserted.object_type,
  });

  return res.status(201).json(
    outboundUtils.mapMultifamilyObjectRow({
      ...inserted,
      total_association_count: 0,
      outbound_lead_count: 0,
      contact_count: 0,
      deal_count: 0,
      company_count: 0,
    })
  );
});

/**
 * PATCH /api/outbound/multifamily/objects/:id
 * Body: { name?, description?, metadata? }
 */
router.patch('/multifamily/objects/:id', async (req, res) => {
  const existingRes = await sql`
SELECT *
     FROM multifamily_objects
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     LIMIT 1
`.execute(db);
  if (!existingRes.rows.length) {
    return res.status(404).json({ error: 'Multifamily object not found.' });
  }

  const existing = existingRes.rows[0];
  const nextName = req.body.name == null ? existing.name : String(req.body.name).trim();
  const nextDescription =
    req.body.description == null ? existing.description : String(req.body.description).trim() || null;
  const nextMetadata = req.body.metadata == null ? existing.metadata || {} : outboundUtils.isPlainObject(req.body.metadata) ? req.body.metadata : {};

  if (!nextName) {
    return res.status(400).json({ error: 'name cannot be empty.' });
  }

  const updatedRes = await sql`
UPDATE multifamily_objects
     SET name = ${nextName},
         description = ${nextDescription},
         metadata = ${JSON.stringify(nextMetadata)}::jsonb,
         updated_at = NOW()
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     RETURNING *
`.execute(db);

  const updated = updatedRes.rows[0];
  logAction(req.user.id, req.user.email, 'multifamily_object_updated', 'multifamily_object', updated.id, updated.name, {
    objectType: updated.object_type,
  });

  return res.json(
    outboundUtils.mapMultifamilyObjectRow({
      ...updated,
      total_association_count: 0,
      outbound_lead_count: 0,
      contact_count: 0,
      deal_count: 0,
      company_count: 0,
    })
  );
});

/**
 * DELETE /api/outbound/multifamily/objects/:id
 */
router.delete('/multifamily/objects/:id', async (req, res) => {
  const deletedRes = await sql`
DELETE FROM multifamily_objects
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     RETURNING id, name, object_type
`.execute(db);
  if (!deletedRes.rows.length) {
    return res.status(404).json({ error: 'Multifamily object not found.' });
  }

  const deleted = deletedRes.rows[0];
  logAction(req.user.id, req.user.email, 'multifamily_object_deleted', 'multifamily_object', deleted.id, deleted.name, {
    objectType: deleted.object_type,
  });
  return res.status(204).send();
});

/**
 * GET /api/outbound/multifamily/objects/:id/associations
 * Query: entityType
 */
router.get('/multifamily/objects/:id/associations', async (req, res) => {
  const entityType = req.query.entityType ? outboundUtils.normalizeMultifamilyEntityType(req.query.entityType) : null;
  if (req.query.entityType && !entityType) {
    return res.status(400).json({ error: 'Invalid entityType.' });
  }

  const objectRes = await sql`
SELECT id
     FROM multifamily_objects
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     LIMIT 1
`.execute(db);
  if (!objectRes.rows.length) {
    return res.status(404).json({ error: 'Multifamily object not found.' });
  }

  const params = [req.user.id, req.params.id];
  const conditions = [
    sql`a.user_id = ${req.user.id}`,
    sql`a.object_id = ${req.params.id}`
  ];
  if (entityType) {
    conditions.push(sql`a.entity_type = ${entityType}`);
  }

  const result = await sql`
    SELECT
      a.*,
      CASE
        WHEN a.entity_type = 'outbound_lead' THEN l.name
        WHEN a.entity_type = 'contact' THEN c.name
        WHEN a.entity_type = 'deal' THEN d.title
        WHEN a.entity_type = 'company' THEN a.company_name
        ELSE NULL
      END AS target_name,
      CASE
        WHEN a.entity_type = 'outbound_lead' THEN l.email
        WHEN a.entity_type = 'contact' THEN c.email
        ELSE NULL
      END AS target_email,
      CASE
        WHEN a.entity_type = 'outbound_lead' THEN l.company
        WHEN a.entity_type = 'contact' THEN c.company
        ELSE NULL
      END AS target_company,
      CASE
        WHEN a.entity_type = 'outbound_lead' THEN l.title
        WHEN a.entity_type = 'deal' THEN d.service_line
        ELSE NULL
      END AS target_title
    FROM multifamily_object_associations a
    LEFT JOIN outbound_leads l
      ON a.entity_type = 'outbound_lead'
     AND l.id = a.entity_id
    LEFT JOIN contacts c
      ON a.entity_type = 'contact'
     AND c.id = a.entity_id
    LEFT JOIN deals d
      ON a.entity_type = 'deal'
     AND d.id = a.entity_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY a.updated_at DESC
  `.execute(db);

  return res.json({
    total: result.rows.length,
    associations: result.rows.map(outboundUtils.mapMultifamilyAssociationRow),
  });
});

/**
 * POST /api/outbound/multifamily/objects/:id/associations
 * Body: { entityType, entityId?, companyName?, metadata? }
 */
router.post('/multifamily/objects/:id/associations', async (req, res) => {
  const objectRes = await sql`
SELECT id, object_type, name
     FROM multifamily_objects
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     LIMIT 1
`.execute(db);
  if (!objectRes.rows.length) {
    return res.status(404).json({ error: 'Multifamily object not found.' });
  }
  const object = objectRes.rows[0];

  const entityType = outboundUtils.normalizeMultifamilyEntityType(req.body.entityType);
  const entityId = outboundUtils.sanitizeUuidValue(req.body.entityId || '');
  const companyName = String(req.body.companyName || '').trim();
  const metadata = outboundUtils.isPlainObject(req.body.metadata) ? req.body.metadata : {};

  if (!entityType) {
    return res.status(400).json({ error: 'Valid entityType is required.' });
  }

  let targetKey = '';
  let targetRecord = null;

  if (entityType === 'company') {
    if (!companyName) {
      return res.status(400).json({ error: 'companyName is required for company associations.' });
    }
    targetKey = companyName.toLowerCase();
  } else {
    if (!entityId) {
      return res.status(400).json({ error: 'entityId is required for non-company associations.' });
    }
    targetRecord = await verifyMultifamilyAssociationTarget(req.user.id, entityType, entityId);
    if (!targetRecord) {
      return res.status(404).json({ error: `${entityType} target not found.` });
    }
    targetKey = entityId;
  }

  const associationRes = await sql`
INSERT INTO multifamily_object_associations
      (user_id, object_id, object_type, entity_type, entity_id, company_name, target_key, metadata, updated_at)
     VALUES
      (${req.user.id}, ${object.id}, ${object.object_type}, ${entityType}, ${entityType === 'company' ? null : entityId}, ${entityType === 'company' ? companyName : null}, ${targetKey}, ${JSON.stringify(metadata)}::jsonb, NOW())
     ON CONFLICT (user_id, object_id, entity_type, target_key)
     DO UPDATE SET
       metadata = EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING *
`.execute(db);

  const association = associationRes.rows[0];
  logAction(
    req.user.id,
    req.user.email,
    'multifamily_object_association_upserted',
    'multifamily_object_association',
    association.id,
    object.name,
    {
      objectType: object.object_type,
      entityType,
      entityId: association.entity_id,
      companyName: association.company_name,
    }
  );

  return res.status(201).json(
    outboundUtils.mapMultifamilyAssociationRow({
      ...association,
      target_name: entityType === 'company' ? companyName : targetRecord?.name || null,
      target_email: targetRecord?.email || null,
      target_company: targetRecord?.company || null,
      target_title: targetRecord?.title || null,
    })
  );
});

/**
 * POST /api/outbound/multifamily/objects/:id/associations/bulk
 * Body: { entityType, entityIds?, companyNames?, metadata? }
 */
router.post('/multifamily/objects/:id/associations/bulk', async (req, res) => {
  const objectRes = await sql`
SELECT id, object_type, name
     FROM multifamily_objects
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     LIMIT 1
`.execute(db);
  if (!objectRes.rows.length) {
    return res.status(404).json({ error: 'Multifamily object not found.' });
  }
  const object = objectRes.rows[0];

  const entityType = outboundUtils.normalizeMultifamilyEntityType(req.body.entityType);
  const metadata = outboundUtils.isPlainObject(req.body.metadata) ? req.body.metadata : {};

  if (!entityType) {
    return res.status(400).json({ error: 'Valid entityType is required.' });
  }

  if (entityType === 'outbound_lead') {
    return res.status(400).json({ error: 'Use lead-level tagging controls for outbound_lead bulk operations.' });
  }

  const associations = [];

  if (entityType === 'company') {
    const companyNames = Array.isArray(req.body.companyNames)
      ? [...new Set(req.body.companyNames.map((value) => String(value || '').trim()).filter(Boolean))]
      : [];

    if (!companyNames.length) {
      return res.status(400).json({ error: 'companyNames[] is required for company bulk associations.' });
    }

    for (const name of companyNames) {
      const associationRes = await sql`
INSERT INTO multifamily_object_associations
          (user_id, object_id, object_type, entity_type, entity_id, company_name, target_key, metadata, updated_at)
         VALUES
          (${req.user.id}, ${object.id}, ${object.object_type}, 'company', NULL, ${name}, ${name.toLowerCase()}, ${JSON.stringify(metadata)}::jsonb, NOW())
         ON CONFLICT (user_id, object_id, entity_type, target_key)
         DO UPDATE SET
           metadata = EXCLUDED.metadata,
           updated_at = NOW()
         RETURNING *
`.execute(db);

      associations.push(
        outboundUtils.mapMultifamilyAssociationRow({
          ...associationRes.rows[0],
          target_name: name,
          target_email: null,
          target_company: name,
          target_title: null,
        })
      );
    }

    logAction(req.user.id, req.user.email, 'multifamily_object_association_bulk_upserted', 'multifamily_object', object.id, object.name, {
      objectType: object.object_type,
      entityType,
      upsertedCount: associations.length,
    });

    return res.status(201).json({
      objectId: object.id,
      objectType: object.object_type,
      entityType,
      upsertedCount: associations.length,
      associations,
    });
  }

  const entityIds = outboundUtils.sanitizeUuidList(req.body.entityIds);
  if (!entityIds.length) {
    return res.status(400).json({ error: 'entityIds[] is required for contact/deal bulk associations.' });
  }

  const missingIds = [];
  for (const entityId of entityIds) {
    const targetRecord = await verifyMultifamilyAssociationTarget(req.user.id, entityType, entityId);
    if (!targetRecord) {
      missingIds.push(entityId);
      continue;
    }

    const associationRes = await sql`
INSERT INTO multifamily_object_associations
        (user_id, object_id, object_type, entity_type, entity_id, company_name, target_key, metadata, updated_at)
       VALUES
        (${req.user.id}, ${object.id}, ${object.object_type}, ${entityType}, ${entityId}, NULL, ${entityId}, ${JSON.stringify(metadata)}::jsonb, NOW())
       ON CONFLICT (user_id, object_id, entity_type, target_key)
       DO UPDATE SET
         metadata = EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING *
`.execute(db);

    associations.push(
      outboundUtils.mapMultifamilyAssociationRow({
        ...associationRes.rows[0],
        target_name: targetRecord.name || null,
        target_email: targetRecord.email || null,
        target_company: targetRecord.company || null,
        target_title: targetRecord.title || null,
      })
    );
  }

  if (associations.length === 0) {
    return res.status(404).json({
      error: `No valid ${entityType} targets were found for this account.`,
      missingIds,
    });
  }

  logAction(req.user.id, req.user.email, 'multifamily_object_association_bulk_upserted', 'multifamily_object', object.id, object.name, {
    objectType: object.object_type,
    entityType,
    upsertedCount: associations.length,
    missingCount: missingIds.length,
  });

  return res.status(201).json({
    objectId: object.id,
    objectType: object.object_type,
    entityType,
    upsertedCount: associations.length,
    missingIds,
    associations,
  });
});

/**
 * DELETE /api/outbound/multifamily/objects/:id/associations/:associationId
 */
router.delete('/multifamily/objects/:id/associations/:associationId', async (req, res) => {
  const deletedRes = await sql`
DELETE FROM multifamily_object_associations
     WHERE id = ${req.params.associationId}
       AND object_id = ${req.params.id}
       AND user_id = ${req.user.id}
     RETURNING id, object_id, entity_type, entity_id, company_name
`.execute(db);
  if (!deletedRes.rows.length) {
    return res.status(404).json({ error: 'Multifamily association not found.' });
  }

  const deleted = deletedRes.rows[0];
  logAction(
    req.user.id,
    req.user.email,
    'multifamily_object_association_deleted',
    'multifamily_object_association',
    deleted.id,
    null,
    {
      objectId: deleted.object_id,
      entityType: deleted.entity_type,
      entityId: deleted.entity_id,
      companyName: deleted.company_name,
    }
  );

  return res.status(204).send();
});

/**
 * GET /api/outbound/leads
 */
router.get('/leads', validateQuery(LeadFiltersSchema), async (req, res) => {
  const { status, minScore = 0, search = '', limit = 100, cursor } = req.validatedQuery;
  await syncDataQualityIssuesForUser(req.user.id);

  const objectTypeFilter = outboundUtils.normalizeMultifamilyObjectType(req.query.objectType || '');
  const objectIdFilter = outboundUtils.sanitizeUuidValue(req.query.objectId || '');
  const specificObjectFilters = [
    { objectType: 'portfolio', objectId: outboundUtils.sanitizeUuidValue(req.query.portfolioId || '') },
    { objectType: 'property', objectId: outboundUtils.sanitizeUuidValue(req.query.propertyId || '') },
    { objectType: 'tech_stack', objectId: outboundUtils.sanitizeUuidValue(req.query.techStackId || '') },
    { objectType: 'initiative', objectId: outboundUtils.sanitizeUuidValue(req.query.initiativeId || '') },
  ].filter((entry) => entry.objectId);

  if ((req.query.objectType || req.query.objectId) && (!objectTypeFilter || !objectIdFilter)) {
    return res.status(400).json({ error: 'objectType and objectId must both be valid when provided.' });
  }

  const conditions = [
    sql`l.user_id = ${req.user.id}`,
    sql`l.total_score >= ${Number(minScore)}`,
  ];

  if (status) {
    conditions.push(sql`l.status = ${status}`);
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(sql`(
      l.name ILIKE ${searchPattern}
      OR COALESCE(l.company, '') ILIKE ${searchPattern}
      OR COALESCE(l.title, '') ILIKE ${searchPattern}
      OR COALESCE(l.email, '') ILIKE ${searchPattern}
    )`);
  }

  if (objectTypeFilter && objectIdFilter) {
    conditions.push(sql`
      EXISTS (
        SELECT 1
        FROM multifamily_object_associations moa
        WHERE moa.user_id = l.user_id
          AND moa.entity_type = 'outbound_lead'
          AND moa.entity_id = l.id
          AND moa.object_type = ${objectTypeFilter}
          AND moa.object_id = ${objectIdFilter}
      )
    `);
  }

  for (const objectFilter of specificObjectFilters) {
    conditions.push(sql`
      EXISTS (
        SELECT 1
        FROM multifamily_object_associations moa
        WHERE moa.user_id = l.user_id
          AND moa.entity_type = 'outbound_lead'
          AND moa.entity_id = l.id
          AND moa.object_type = ${objectFilter.objectType}
          AND moa.object_id = ${objectFilter.objectId}
      )
    `);
  }

  let cursorClause = null;
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
      if (typeof parsed.score === 'number' && parsed.id) {
        cursorClause = sql`AND (l.total_score < ${parsed.score} OR (l.total_score = ${parsed.score} AND l.id < ${parsed.id}::uuid))`;
      }
    } catch {
      return res.status(400).json({ error: 'Invalid cursor.' });
    }
  }

  const safeLimit = Math.min(500, Math.max(1, Number(limit)));

  const query = sql`
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
      WHERE user_id = ${req.user.id}
      GROUP BY lead_id
    ) issue_counts ON issue_counts.lead_id = l.id
    WHERE ${sql.join(conditions, sql` AND `)}
    ${cursorClause || sql``}
    ORDER BY l.total_score DESC, l.id DESC
    LIMIT ${safeLimit + 1}
  `;

  const result = await query.execute(db);
  const rows = result.rows;
  const hasMore = rows.length > safeLimit;
  const leads = hasMore ? rows.slice(0, safeLimit) : rows;

  let nextCursor = null;
  if (hasMore && leads.length > 0) {
    const last = leads[leads.length - 1];
    nextCursor = Buffer.from(JSON.stringify({ score: last.total_score, id: last.id })).toString('base64');
  }

  return res.json({ total: leads.length, leads, nextCursor });
});

/**
 * DELETE /api/outbound/leads/:id
 * Hard-deletes a lead and all cascade-related records.
 */
router.delete('/leads/:id', async (req, res) => {
  const deletedRes = await sql`
DELETE FROM outbound_leads
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     RETURNING id, name, email, company
`.execute(db);

  if (!deletedRes.rows.length) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  const deleted = deletedRes.rows[0];
  logAction(req.user.id, req.user.email, 'outbound_lead_deleted', 'outbound_lead', deleted.id, deleted.name, {
    email: deleted.email,
    company: deleted.company,
  });
  return res.status(204).send();
});

/**
 * GET /api/outbound/saved-views
 * Query: scope=outbound_leads
 */
router.get('/saved-views', async (req, res) => {
  const scope = String(req.query.scope || 'outbound_leads').trim().toLowerCase();
  if (!outboundUtils.VALID_OUTBOUND_SAVED_VIEW_SCOPES.has(scope)) {
    return res.status(400).json({ error: 'Invalid saved view scope.' });
  }

  const result = await sql`
SELECT *
     FROM outbound_saved_views
     WHERE user_id = ${req.user.id}
       AND scope = ${scope}
     ORDER BY is_default DESC, updated_at DESC
`.execute(db);

  return res.json({
    total: result.rows.length,
    views: result.rows.map(outboundUtils.mapSavedViewRow),
  });
});

/**
 * POST /api/outbound/saved-views
 * Body: { scope?, name, filters?, displayOptions?, isDefault? }
 */
router.post('/saved-views', async (req, res) => {
  const scope = String(req.body.scope || 'outbound_leads').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const isDefault = Boolean(req.body.isDefault);
  const filters = outboundUtils.normalizeSavedViewFilters(req.body.filters);
  const displayOptions = outboundUtils.isPlainObject(req.body.displayOptions) ? req.body.displayOptions : {};

  if (!outboundUtils.VALID_OUTBOUND_SAVED_VIEW_SCOPES.has(scope)) {
    return res.status(400).json({ error: 'Invalid saved view scope.' });
  }
  if (!name) {
    return res.status(400).json({ error: 'Saved view name is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (isDefault) {
      await client.query(
        `UPDATE outbound_saved_views
         SET is_default = FALSE,
             updated_at = NOW()
         WHERE user_id = $1
           AND scope = $2
           AND is_default = TRUE`,
        [req.user.id, scope]
      );
    }

    const insertedRes = await client.query(
      `INSERT INTO outbound_saved_views
        (user_id, scope, name, is_default, filters, display_options, updated_at)
       VALUES
        ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
       RETURNING *`,
      [req.user.id, scope, name, isDefault, JSON.stringify(filters), JSON.stringify(displayOptions)]
    );

    await client.query('COMMIT');

    logAction(req.user.id, req.user.email, 'outbound_saved_view_created', 'outbound_saved_view', insertedRes.rows[0].id, name, {
      scope,
      isDefault,
    });

    return res.status(201).json(outboundUtils.mapSavedViewRow(insertedRes.rows[0]));
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    if (String(err.message || '').toLowerCase().includes('duplicate') || String(err.code || '') === '23505') {
      return res.status(409).json({ error: 'A saved view with this name already exists.' });
    }
    return res.status(500).json({ error: 'Failed to create saved view.', message: err.message });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/outbound/saved-views/:id
 * Body: { name?, filters?, displayOptions?, isDefault? }
 */
router.patch('/saved-views/:id', async (req, res) => {
  const existingRes = await sql`
SELECT *
     FROM outbound_saved_views
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     LIMIT 1
`.execute(db);
  if (!existingRes.rows.length) {
    return res.status(404).json({ error: 'Saved view not found.' });
  }

  const existing = existingRes.rows[0];
  const nextName = req.body.name == null ? existing.name : String(req.body.name).trim();
  const nextIsDefault = req.body.isDefault == null ? Boolean(existing.is_default) : Boolean(req.body.isDefault);
  const nextFilters = req.body.filters == null ? existing.filters || {} : outboundUtils.normalizeSavedViewFilters(req.body.filters);
  const nextDisplayOptions =
    req.body.displayOptions == null ? existing.display_options || {} : outboundUtils.isPlainObject(req.body.displayOptions) ? req.body.displayOptions : {};

  if (!nextName) {
    return res.status(400).json({ error: 'Saved view name cannot be empty.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (nextIsDefault) {
      await client.query(
        `UPDATE outbound_saved_views
         SET is_default = FALSE,
             updated_at = NOW()
         WHERE user_id = $1
           AND scope = $2
           AND id <> $3
           AND is_default = TRUE`,
        [req.user.id, existing.scope, existing.id]
      );
    }

    const updatedRes = await client.query(
      `UPDATE outbound_saved_views
       SET name = $1,
           is_default = $2,
           filters = $3::jsonb,
           display_options = $4::jsonb,
           updated_at = NOW()
       WHERE id = $5
         AND user_id = $6
       RETURNING *`,
      [nextName, nextIsDefault, JSON.stringify(nextFilters), JSON.stringify(nextDisplayOptions), req.params.id, req.user.id]
    );

    await client.query('COMMIT');

    logAction(req.user.id, req.user.email, 'outbound_saved_view_updated', 'outbound_saved_view', req.params.id, nextName, {
      isDefault: nextIsDefault,
    });

    return res.json(outboundUtils.mapSavedViewRow(updatedRes.rows[0]));
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    if (String(err.message || '').toLowerCase().includes('duplicate') || String(err.code || '') === '23505') {
      return res.status(409).json({ error: 'A saved view with this name already exists.' });
    }
    return res.status(500).json({ error: 'Failed to update saved view.', message: err.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/outbound/saved-views/:id
 */
router.delete('/saved-views/:id', async (req, res) => {
  const deletedRes = await sql`
DELETE FROM outbound_saved_views
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     RETURNING id, name, scope
`.execute(db);

  if (!deletedRes.rows.length) {
    return res.status(404).json({ error: 'Saved view not found.' });
  }

  const deleted = deletedRes.rows[0];
  logAction(req.user.id, req.user.email, 'outbound_saved_view_deleted', 'outbound_saved_view', deleted.id, deleted.name, {
    scope: deleted.scope,
  });

  return res.status(204).send();
});

/**
 * POST /api/outbound/leads/bulk
 * Body: { leadIds: string[], actionType: set_status|suppress|unsuppress|rescore, payload?: {} }
 */
router.post('/leads/bulk', validateBody(BulkActionSchema), async (req, res) => {
  const { leadIds, actionType, payload } = req.validatedBody;

  const leadsRes = await sql`
SELECT id, name, status, suppression_reason
     FROM outbound_leads
     WHERE user_id = ${req.user.id}
       AND id = ANY(${leadIds}::uuid[])
`.execute(db);
  const foundLeadIds = new Set(leadsRes.rows.map((lead) => lead.id));
  const missingLeadIds = leadIds.filter((leadId) => !foundLeadIds.has(leadId));

  if (!leadsRes.rows.length) {
    return res.status(404).json({ error: 'No leads found for this action.' });
  }

  const updatedLeadIds = [];
  const autoStoppedEnrollmentIds = [];
  const statusTarget = String(payload.status || '').trim().toLowerCase();
  const suppressionReason = String(payload.reason || '').trim();

  if (actionType === 'set_status' && !outboundUtils.VALID_OUTBOUND_LEAD_STATUSES.has(statusTarget)) {
    return res.status(400).json({ error: 'payload.status must be a valid lead status for set_status action.' });
  }
  if (actionType === 'suppress' && !suppressionReason) {
    return res.status(400).json({ error: 'payload.reason is required for suppress bulk action.' });
  }

  for (const lead of leadsRes.rows) {
    if (actionType === 'set_status') {
      await sql`
UPDATE outbound_leads
         SET status = ${statusTarget},
             updated_at = NOW()
         WHERE id = ${lead.id}
           AND user_id = ${req.user.id}
`.execute(db);
      await logLeadEvent({
        userId: req.user.id,
        leadId: lead.id,
        eventType: 'bulk_status_updated',
        metadata: {
          fromStatus: lead.status,
          toStatus: statusTarget,
        },
      });
      updatedLeadIds.push(lead.id);
      continue;
    }

    if (actionType === 'suppress') {
      await sql`
UPDATE outbound_leads
         SET status = 'suppressed',
             suppression_reason = ${suppressionReason},
             updated_at = NOW()
         WHERE id = ${lead.id}
           AND user_id = ${req.user.id}
`.execute(db);
      await logLeadEvent({
        userId: req.user.id,
        leadId: lead.id,
        eventType: 'lead_suppressed',
        metadata: {
          reason: suppressionReason,
          bulkAction: true,
        },
      });
      const stoppedIds = await sequenceService.autoStopOpenSequenceEnrollments({
        userId: req.user.id,
        leadId: lead.id,
        reason: 'Auto-stopped after bulk suppression',
        triggerSource: 'bulk_action',
        metadata: {
          actionType,
        },
      });
      autoStoppedEnrollmentIds.push(...stoppedIds);
      updatedLeadIds.push(lead.id);
      continue;
    }

    if (actionType === 'unsuppress') {
      await sql`
UPDATE outbound_leads
         SET status = CASE WHEN status = 'suppressed' THEN 'new' ELSE status END,
             suppression_reason = NULL,
             updated_at = NOW()
         WHERE id = ${lead.id}
           AND user_id = ${req.user.id}
`.execute(db);
      await logLeadEvent({
        userId: req.user.id,
        leadId: lead.id,
        eventType: 'lead_unsuppressed',
        metadata: {
          bulkAction: true,
        },
      });
      updatedLeadIds.push(lead.id);
      continue;
    }

    if (actionType === 'rescore') {
      const leadFullRes = await sql`
SELECT * FROM outbound_leads WHERE id = ${lead.id} AND user_id = ${req.user.id}
`.execute(db);
      if (!leadFullRes.rows.length) continue;
      const fullLead = leadFullRes.rows[0];
      const engagement = await computeEngagementSignals(req.user.id, fullLead.id);
      const score = scoreLead(fullLead, engagement);

      await sql`
UPDATE outbound_leads
         SET fit_score = ${score.fitScore},
             intent_score = ${score.intentScore},
             total_score = ${score.totalScore},
             status = ${score.status},
             next_recommended_action = ${score.nextRecommendedAction},
             updated_at = NOW()
         WHERE id = ${lead.id}
           AND user_id = ${req.user.id}
`.execute(db);
      await logLeadEvent({
        userId: req.user.id,
        leadId: lead.id,
        eventType: 'lead_scored',
        metadata: {
          ...score,
          bulkAction: true,
        },
      });
      await recordLeadScoreHistory({
        userId: req.user.id,
        leadId: lead.id,
        score,
        source: 'bulk_rescore',
      });
      updatedLeadIds.push(lead.id);
    }
  }

  logAction(req.user.id, req.user.email, 'outbound_bulk_action_executed', 'outbound_lead', null, actionType, {
    actionType,
    requestedCount: leadIds.length,
    updatedCount: updatedLeadIds.length,
    missingCount: missingLeadIds.length,
  });

  return res.json({
    actionType,
    requestedCount: leadIds.length,
    updatedCount: updatedLeadIds.length,
    updatedLeadIds,
    missingLeadIds,
    autoStoppedEnrollmentIds: [...new Set(autoStoppedEnrollmentIds)],
  });
});

/**
 * GET /api/outbound/sla/alerts
 */
router.get('/sla/alerts', async (req, res) => {
  const [overdueLinkedInRes, staleEmailDraftsRes, stalePausedEnrollmentsRes, highScoreUncontactedRes] = await Promise.all([
    sql`
SELECT
         t.id AS alert_id,
         'linkedin_overdue'::text AS alert_type,
         'high'::text AS severity,
         t.id AS task_id,
         t.lead_id,
         t.due_at,
         l.name AS lead_name,
         l.company AS lead_company,
         l.total_score,
         EXTRACT(EPOCH FROM (NOW() - t.due_at))::bigint AS age_seconds
       FROM linkedin_outreach_tasks t
       JOIN outbound_leads l ON l.id = t.lead_id
       WHERE t.user_id = ${req.user.id}
         AND t.status IN ('pending', 'drafted', 'approved', 'blocked')
         AND t.due_at IS NOT NULL
         AND t.due_at < NOW()
       ORDER BY t.due_at ASC
       LIMIT 50
`.execute(db),
    sql`
SELECT
         d.id AS alert_id,
         'email_draft_stale'::text AS alert_type,
         'medium'::text AS severity,
         d.id AS draft_id,
         d.lead_id,
         d.approved_at AS due_at,
         l.name AS lead_name,
         l.company AS lead_company,
         l.total_score,
         EXTRACT(EPOCH FROM (NOW() - d.approved_at))::bigint AS age_seconds
       FROM outbound_message_drafts d
       JOIN outbound_leads l ON l.id = d.lead_id
       WHERE d.user_id = ${req.user.id}
         AND d.channel = 'email'
         AND d.status = 'approved'
         AND d.approved_at < NOW() - INTERVAL '24 hours'
       ORDER BY d.approved_at ASC
       LIMIT 50
`.execute(db),
    sql`
SELECT
         e.id AS alert_id,
         'sequence_paused_stale'::text AS alert_type,
         'medium'::text AS severity,
         e.id AS enrollment_id,
         e.lead_id,
         e.paused_at AS due_at,
         l.name AS lead_name,
         l.company AS lead_company,
         l.total_score,
         EXTRACT(EPOCH FROM (NOW() - COALESCE(e.paused_at, e.updated_at)))::bigint AS age_seconds
       FROM outbound_sequence_enrollments e
       JOIN outbound_leads l ON l.id = e.lead_id
       WHERE e.user_id = ${req.user.id}
         AND e.status = 'paused'
         AND COALESCE(e.paused_at, e.updated_at) < NOW() - INTERVAL '48 hours'
       ORDER BY COALESCE(e.paused_at, e.updated_at) ASC
       LIMIT 50
`.execute(db),
    sql`
SELECT
         l.id AS alert_id,
         'high_score_not_contacted'::text AS alert_type,
         'high'::text AS severity,
         l.id AS lead_id,
         l.updated_at AS due_at,
         l.name AS lead_name,
         l.company AS lead_company,
         l.total_score,
         EXTRACT(EPOCH FROM (NOW() - l.updated_at))::bigint AS age_seconds
       FROM outbound_leads l
       WHERE l.user_id = ${req.user.id}
         AND l.total_score >= 75
         AND l.status IN ('new', 'qualified', 'queued')
         AND l.updated_at < NOW() - INTERVAL '72 hours'
       ORDER BY l.total_score DESC, l.updated_at ASC
       LIMIT 50
`.execute(db),
  ]);

  const allAlerts = [
    ...overdueLinkedInRes.rows,
    ...staleEmailDraftsRes.rows,
    ...stalePausedEnrollmentsRes.rows,
    ...highScoreUncontactedRes.rows,
  ]
    .map((row) => ({
      id: row.alert_id,
      type: row.alert_type,
      severity: row.severity,
      leadId: row.lead_id || null,
      dueAt: row.due_at || null,
      ageHours: row.age_seconds != null ? outboundUtils.round2(Number(row.age_seconds) / 3600) : null,
      lead: {
        id: row.lead_id || null,
        name: row.lead_name || null,
        company: row.lead_company || null,
        totalScore: Number(row.total_score || 0),
      },
      taskId: row.task_id || null,
      draftId: row.draft_id || null,
      enrollmentId: row.enrollment_id || null,
    }))
    .sort((a, b) => {
      const severityRank = { high: 1, medium: 2, low: 3 };
      if (severityRank[a.severity] !== severityRank[b.severity]) {
        return (severityRank[a.severity] || 99) - (severityRank[b.severity] || 99);
      }
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });

  return res.json({
    summary: {
      totalAlerts: allAlerts.length,
      overdueLinkedIn: overdueLinkedInRes.rows.length,
      staleApprovedEmailDrafts: staleEmailDraftsRes.rows.length,
      stalePausedEnrollments: stalePausedEnrollmentsRes.rows.length,
      highScoreNotContacted: highScoreUncontactedRes.rows.length,
    },
    alerts: allAlerts.slice(0, 120),
  });
});

/**
 * GET /api/outbound/data-quality/issues
 * Query: status=open|resolved|dismissed, issueType, limit
 */
router.get('/data-quality/issues', async (req, res) => {
  const status = String(req.query.status || 'open').trim().toLowerCase();
  const issueType = String(req.query.issueType || '').trim().toLowerCase();
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

  if (status && !outboundUtils.VALID_DATA_QUALITY_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid data quality status filter.' });
  }
  if (issueType && !outboundUtils.VALID_DATA_QUALITY_ISSUE_TYPES.has(issueType)) {
    return res.status(400).json({ error: 'Invalid data quality issueType filter.' });
  }

  await syncDataQualityIssuesForUser(req.user.id);

  const baseQuery = sql`
SELECT
         i.*,
         l.name AS lead_name,
         l.email AS lead_email,
         l.company AS lead_company,
         l.title AS lead_title,
         l.status AS lead_status
       FROM data_quality_issues i
       LEFT JOIN outbound_leads l ON l.id = i.lead_id
       WHERE i.user_id = ${req.user.id}
         ${status ? sql`AND i.status = ${status}` : sql``}
         ${issueType ? sql`AND i.issue_type = ${issueType}` : sql``}
       ORDER BY
         CASE i.severity
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           ELSE 3
         END,
         i.updated_at DESC
       LIMIT ${limit}
`;

  const [issuesRes, summaryRes] = await Promise.all([
    baseQuery.execute(db),
    sql`
SELECT
         COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
         COUNT(*) FILTER (WHERE status = 'open' AND is_blocking = TRUE)::int AS open_blocking_count,
         COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved_count,
         COUNT(*) FILTER (WHERE status = 'dismissed')::int AS dismissed_count,
         (
           SELECT COUNT(*)::int
           FROM data_quality_merge_operations m
           WHERE m.user_id = ${req.user.id}
             AND m.created_at >= NOW() - INTERVAL '30 days'
         ) AS merge_count_30d
       FROM data_quality_issues
       WHERE user_id = ${req.user.id}
`.execute(db),
  ]);

  return res.json({
    total: issuesRes.rows.length,
    issues: issuesRes.rows.map(outboundUtils.mapDataQualityIssueRow),
    summary: summaryRes.rows[0] || {
      open_count: 0,
      open_blocking_count: 0,
      resolved_count: 0,
      dismissed_count: 0,
      merge_count_30d: 0,
    },
  });
});

/**
 * GET /api/outbound/data-quality/merge-operations
 * Query: limit
 */
router.get('/data-quality/merge-operations', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const result = await sql`
SELECT
       m.*,
       l.name AS primary_lead_name,
       l.email AS primary_lead_email,
       l.company AS primary_lead_company
     FROM data_quality_merge_operations m
     LEFT JOIN outbound_leads l ON l.id = m.primary_lead_id
     WHERE m.user_id = ${req.user.id}
     ORDER BY m.created_at DESC
     LIMIT ${limit}
`.execute(db);

  return res.json({
    total: result.rows.length,
    mergeOperations: result.rows.map(outboundUtils.mapDataQualityMergeOperationRow),
  });
});

/**
 * POST /api/outbound/data-quality/issues/:id/merge
 * Body: { primaryLeadId?, duplicateLeadIds?[] }
 */
router.post('/data-quality/issues/:id/merge', async (req, res) => {
  const issueRes = await sql`
SELECT id, issue_type, status, details, lead_id
     FROM data_quality_issues
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     LIMIT 1
`.execute(db);
  if (!issueRes.rows.length) {
    return res.status(404).json({ error: 'Data quality issue not found.' });
  }

  const issue = issueRes.rows[0];
  if (issue.issue_type !== 'potential_duplicate') {
    return res.status(400).json({ error: 'Merge is only supported for potential_duplicate issues.' });
  }

  const issueDetails = outboundUtils.isPlainObject(issue.details) ? issue.details : {};
  const candidateLeadIdsFromIssue = outboundUtils.sanitizeUuidList(issueDetails.candidateLeadIds || issueDetails.candidate_lead_ids || []);
  const bodyDuplicateLeadIds = outboundUtils.sanitizeUuidList(req.body.duplicateLeadIds || []);
  const primaryLeadId = outboundUtils.sanitizeUuidValue(req.body.primaryLeadId || issueDetails.suggestedPrimaryLeadId || issue.lead_id || '');

  if (!primaryLeadId) {
    return res.status(400).json({ error: 'primaryLeadId is required for duplicate merge.' });
  }

  const fallbackDuplicates = candidateLeadIdsFromIssue.filter((leadId) => leadId !== primaryLeadId);
  const duplicateLeadIds = [...new Set((bodyDuplicateLeadIds.length ? bodyDuplicateLeadIds : fallbackDuplicates).filter((leadId) => leadId !== primaryLeadId))];

  if (!duplicateLeadIds.length) {
    return res.status(400).json({ error: 'At least one duplicate lead id is required for merge.' });
  }

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
      [req.user.id, mergeLeadIds]
    );

    const leadById = new Map(leadsRes.rows.map((lead) => [lead.id, lead]));
    if (!leadById.has(primaryLeadId)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Primary lead not found for this account.' });
    }

    const missingDuplicates = duplicateLeadIds.filter((leadId) => !leadById.has(leadId));
    if (missingDuplicates.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'One or more duplicate leads were not found for this account.',
        missingDuplicateLeadIds: missingDuplicates,
      });
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
        req.user.id,
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
      [`Merged into primary lead ${primaryLeadId}`, req.user.id, duplicateLeadIds]
    );

    await client.query(
      `UPDATE outbound_sequence_enrollments
       SET lead_id = $1,
           updated_at = NOW()
       WHERE user_id = $2
         AND lead_id = ANY($3::uuid[])`,
      [primaryLeadId, req.user.id, duplicateLeadIds]
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
      req.user.id,
      duplicateLeadIds,
    ]);
    await client.query(`UPDATE lead_score_history SET lead_id = $1 WHERE user_id = $2 AND lead_id = ANY($3::uuid[])`, [
      primaryLeadId,
      req.user.id,
      duplicateLeadIds,
    ]);
    await client.query(`UPDATE attribution_touchpoints SET lead_id = $1 WHERE user_id = $2 AND lead_id = ANY($3::uuid[])`, [
      primaryLeadId,
      req.user.id,
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
      [req.user.id, duplicateLeadIds, primaryLeadId]
    );

    await client.query(
      `UPDATE multifamily_object_associations
       SET entity_id = $1::uuid,
           target_key = $1::text,
           updated_at = NOW()
       WHERE user_id = $2
         AND entity_type = 'outbound_lead'
         AND entity_id = ANY($3::uuid[])`,
      [primaryLeadId, req.user.id, duplicateLeadIds]
    );

    await client.query(
      `UPDATE data_quality_issues
       SET lead_id = $1,
           updated_at = NOW()
       WHERE user_id = $2
         AND lead_id = ANY($3::uuid[])`,
      [primaryLeadId, req.user.id, duplicateLeadIds]
    );

    const mergeOpRes = await client.query(
      `INSERT INTO data_quality_merge_operations
        (user_id, issue_id, primary_lead_id, merged_lead_ids, merged_lead_count, field_updates, metadata)
       VALUES
        ($1, $2, $3, $4::uuid[], $5, $6::jsonb, $7::jsonb)
       RETURNING *`,
      [
        req.user.id,
        issue.id,
        primaryLeadId,
        duplicateLeadIds,
        duplicateLeadIds.length,
        JSON.stringify(fieldUpdates),
        JSON.stringify({
          issueStatusAtMerge: issue.status,
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
      [mergeOperation.id, req.user.id, issue.id, primaryLeadId, duplicateLeadIds]
    );

    await client.query(
      `DELETE FROM outbound_leads
       WHERE user_id = $1
         AND id = ANY($2::uuid[])`,
      [req.user.id, duplicateLeadIds]
    );

    await client.query('COMMIT');

    await syncDataQualityIssuesForUser(req.user.id);

    logAction(req.user.id, req.user.email, 'outbound_data_quality_duplicates_merged', 'outbound_lead', primaryLeadId, updatedPrimaryRes.rows[0]?.name || null, {
      issueId: issue.id,
      mergedLeadIds: duplicateLeadIds,
      mergeOperationId: mergeOperation.id,
    });

    return res.json({
      mergeOperation: outboundUtils.mapDataQualityMergeOperationRow(mergeOperation),
      primaryLead: updatedPrimaryRes.rows[0],
      mergedLeadIds: duplicateLeadIds,
      resolvedIssueId: issue.id,
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    return res.status(500).json({ error: 'Failed to merge duplicate leads.', message: err.message });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/outbound/data-quality/issues/:id/status
 * Body: { status: 'open'|'resolved'|'dismissed' }
 */
router.patch('/data-quality/issues/:id/status', async (req, res) => {
  const status = String(req.body.status || '').trim().toLowerCase();
  if (!outboundUtils.VALID_DATA_QUALITY_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  const updatedRes = await sql`
UPDATE data_quality_issues
     SET status = $1,
         resolved_at = CASE WHEN ${status} IN ('resolved', 'dismissed') THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     RETURNING *
`.execute(db);

  if (!updatedRes.rows.length) {
    return res.status(404).json({ error: 'Data quality issue not found.' });
  }

  logAction(req.user.id, req.user.email, 'outbound_data_quality_issue_status_updated', 'data_quality_issue', req.params.id, null, {
    status,
  });

  const issueRow = updatedRes.rows[0];
  const leadRes = issueRow.lead_id
    ? await sql`
SELECT id AS lead_id, name AS lead_name, email AS lead_email, company AS lead_company, title AS lead_title, status AS lead_status
         FROM outbound_leads
         WHERE id = ${issueRow.lead_id}
           AND user_id = ${req.user.id}
         LIMIT 1
`.execute(db)
    : { rows: [] };

  return res.json(outboundUtils.mapDataQualityIssueRow({ ...issueRow, ...(leadRes.rows[0] || {}) }));
});

/**
 * GET /api/outbound/sequences
 */
router.get('/sequences', async (req, res) => {
  const result = await sequenceService.listSequences(req.user.id);
  return res.json(result);
});

/**
 * GET /api/outbound/sequences/enrollments
 * Query: status, limit
 */
router.get('/sequences/enrollments', async (req, res) => {
  try {
    const result = await sequenceService.listEnrollments(
      req.user.id,
      req.query.status,
      req.query.limit
    );
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/outbound/sequences/:id/enroll
 * Body: { leadId }
 */
router.post('/sequences/:id/enroll', validateBody(EnrollSequenceSchema), async (req, res) => {
  try {
    const enrollment = await sequenceService.enrollLead({
      userId: req.user.id,
      sequenceId: req.params.id,
      leadId: req.validatedBody.leadId,
      logLeadEventFn: logLeadEvent,
    });
    return res.status(201).json(enrollment);
  } catch (err) {
    if (err.code === 'data_quality_block') {
      return res.status(409).json({
        error: err.message,
        code: err.code,
        blockers: err.blockers,
      });
    }
    if (err.enrollmentId) {
      return res.status(409).json({
        error: err.message,
        enrollmentId: err.enrollmentId,
        sequenceId: err.sequenceId,
        sequenceName: err.sequenceName,
      });
    }
    const statusCode = err.message.includes('not found') ? 404 : 409;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * PATCH /api/outbound/sequences/enrollments/:id/state
 * Body: { state, reason? }
 */
router.patch('/sequences/enrollments/:id/state', validateBody(ChangeSequenceStateSchema), async (req, res) => {
  try {
    const updated = await sequenceService.changeEnrollmentState({
      userId: req.user.id,
      enrollmentId: req.params.id,
      nextState: req.validatedBody.state,
      reason: req.validatedBody.reason,
      logLeadEventFn: logLeadEvent,
    });
    return res.json(updated);
  } catch (err) {
    const statusCode = err.message.includes('not found') ? 404 : 409;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/outbound/workflows/rules
 */
router.get('/workflows/rules', async (req, res) => {
  const includeDisabled = String(req.query.includeDisabled || '').trim().toLowerCase() === 'true';

  let query;
  if (includeDisabled) {
    query = sql`
      SELECT id, user_id, name, description, enabled, trigger_event, priority, conditions, true_actions, false_actions,
             last_tested_at, created_at, updated_at
       FROM workflow_rules
       WHERE user_id = ${req.user.id}
       ORDER BY priority ASC, created_at DESC
    `;
  } else {
    query = sql`
      SELECT id, user_id, name, description, enabled, trigger_event, priority, conditions, true_actions, false_actions,
             last_tested_at, created_at, updated_at
       FROM workflow_rules
       WHERE user_id = ${req.user.id} AND enabled = TRUE
       ORDER BY priority ASC, created_at DESC
    `;
  }
  
  const result = await query.execute(db);

  return res.json({
    total: result.rows.length,
    rules: result.rows,
  });
});

/**
 * POST /api/outbound/workflows/rules
 */
router.post('/workflows/rules', validateBody(CreateWorkflowRuleSchema), async (req, res) => {
  const { name, triggerEvent, conditions, trueActions, falseActions, enabled, priority } = req.validatedBody;
  const description = req.body.description ? String(req.body.description).trim() : null;
  const rawTrueActions = Array.isArray(req.body.trueActions) ? req.body.trueActions : [];
  const rawFalseActions = Array.isArray(req.body.falseActions) ? req.body.falseActions : [];
  if (rawTrueActions.length !== trueActions.length || rawFalseActions.length !== falseActions.length) {
    return res.status(400).json({ error: 'One or more actions are invalid.' });
  }

  const result = await sql`
INSERT INTO workflow_rules
      (user_id, name, description, enabled, trigger_event, priority, conditions, true_actions, false_actions)
     VALUES (${req.user.id}, ${name}, ${description}, ${enabled}, ${triggerEvent}, ${priority}, ${JSON.stringify(conditions)}::jsonb, ${JSON.stringify(trueActions)}::jsonb, ${JSON.stringify(falseActions)}::jsonb)
     RETURNING *
`.execute(db);

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
  const existingRes = await sql`
SELECT *
     FROM workflow_rules
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
`.execute(db);
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
  const conditions = req.body.conditions == null ? current.conditions : outboundUtils.isPlainObject(req.body.conditions) ? req.body.conditions : {};

  if (!name) {
    return res.status(400).json({ error: 'Rule name is required.' });
  }
  if (!outboundUtils.VALID_RULE_TRIGGER_EVENTS.has(triggerEvent)) {
    return res.status(400).json({ error: 'Invalid triggerEvent for outbound workflow rule.' });
  }

  const rawTrueActions = req.body.trueActions == null ? current.true_actions : req.body.trueActions;
  const rawFalseActions = req.body.falseActions == null ? current.false_actions : req.body.falseActions;
  const trueActions = outboundUtils.normalizeRuleActions(rawTrueActions);
  const falseActions = outboundUtils.normalizeRuleActions(rawFalseActions);

  if (
    (Array.isArray(rawTrueActions) && rawTrueActions.length !== trueActions.length) ||
    (Array.isArray(rawFalseActions) && rawFalseActions.length !== falseActions.length)
  ) {
    return res.status(400).json({ error: 'One or more actions are invalid.' });
  }

  const updatedRes = await sql`
UPDATE workflow_rules
     SET name = ${name},
         description = ${description || null},
         enabled = ${enabled},
         trigger_event = ${triggerEvent},
         priority = ${priority},
         conditions = ${JSON.stringify(conditions)}::jsonb,
         true_actions = ${JSON.stringify(trueActions)}::jsonb,
         false_actions = ${JSON.stringify(falseActions)}::jsonb,
         updated_at = NOW()
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     RETURNING *
`.execute(db);

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
  const existingRes = await sql`
SELECT id
     FROM workflow_rules
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
`.execute(db);
  if (!existingRes.rows.length) {
    return res.status(404).json({ error: 'Workflow rule not found.' });
  }

  const runsRes = await sql`
SELECT *
     FROM workflow_rule_runs
     WHERE rule_id = ${req.params.id}
       AND user_id = ${req.user.id}
     ORDER BY created_at DESC
     LIMIT ${limit}
`.execute(db);

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
  const ruleRes = await sql`
SELECT *
     FROM workflow_rules
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
`.execute(db);
  if (!ruleRes.rows.length) {
    return res.status(404).json({ error: 'Workflow rule not found.' });
  }

  const rule = ruleRes.rows[0];
  const triggerEvent = req.body.triggerEvent
    ? String(req.body.triggerEvent).trim()
    : String(rule.trigger_event || '').trim();
  if (!outboundUtils.VALID_RULE_TRIGGER_EVENTS.has(triggerEvent)) {
    return res.status(400).json({ error: 'Invalid triggerEvent for test run.' });
  }

  const leadId = req.body.leadId ? String(req.body.leadId).trim() : null;
  const applyActions = Boolean(req.body.applyActions);
  const eventData = outboundUtils.isPlainObject(req.body.eventData) ? req.body.eventData : {};

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

  await sql`
UPDATE workflow_rules
     SET last_tested_at = NOW(),
         updated_at = NOW()
     WHERE id = ${rule.id}
       AND user_id = ${req.user.id}
`.execute(db);

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
router.post('/campaigns', validateBody(CreateCampaignSchema), async (req, res) => {
  try {
    const campaign = await campaignService.createCampaign({
      userId: req.user.id,
      name: req.validatedBody.name,
      channels: req.validatedBody.channels,
      audienceFilter: req.body.audienceFilter,
      notes: req.body.notes,
      leadIds: req.body.leadIds,
      logLeadEventFn: logLeadEvent,
    });
    return res.status(201).json(campaign);
  } catch (err) {
    const statusCode = err.message.includes('not found') ? 404 : 400;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/outbound/campaigns
 */
router.get('/campaigns', async (req, res) => {
  const result = await campaignService.listCampaigns(
    req.user.id,
    req.query.status,
    req.query.limit
  );
  return res.json(result);
});

/**
 * GET /api/outbound/campaigns/:id
 */
router.get('/campaigns/:id', async (req, res) => {
  try {
    const result = await campaignService.getCampaign(req.user.id, req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

/**
 * POST /api/outbound/campaigns/:id/members/add
 * Body: { leadIds: [] }
 */
router.post('/campaigns/:id/members/add', async (req, res) => {
  try {
    const result = await campaignService.addMembers({
      userId: req.user.id,
      campaignId: req.params.id,
      leadIds: req.body.leadIds,
    });
    return res.status(201).json(result);
  } catch (err) {
    const statusCode = err.message.includes('not found') ? 404 : 400;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * PATCH /api/outbound/campaigns/:id/status
 * Body: { status }
 */
router.patch('/campaigns/:id/status', validateBody(UpdateCampaignStatusSchema), async (req, res) => {
  try {
    const campaign = await campaignService.updateCampaignStatus({
      userId: req.user.id,
      campaignId: req.params.id,
      nextStatus: req.validatedBody.status,
    });
    return res.json(campaign);
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

/**
 * PATCH /api/outbound/campaigns/:campaignId/members/:memberId/status
 * Body: { memberStatus, lastChannel }
 */
router.patch('/campaigns/:campaignId/members/:memberId/status', async (req, res) => {
  try {
    const result = await campaignService.updateMemberStatus({
      userId: req.user.id,
      campaignId: req.params.campaignId,
      memberId: req.params.memberId,
      memberStatus: req.body.memberStatus,
      lastChannel: req.body.lastChannel,
      statusReason: req.body.reason,
      logLeadEventFn: logLeadEvent,
    });
    return res.json(result);
  } catch (err) {
    const statusCode = err.message.includes('not found') ? 404 : 400;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/outbound/leads/:id/score
 */
router.post('/leads/:id/score', async (req, res) => {
  const leadRes = await sql`
SELECT * FROM outbound_leads WHERE id = ${req.params.id} AND user_id = ${req.user.id}
`.execute(db);

  if (leadRes.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  const lead = leadRes.rows[0];
  const engagement = await computeEngagementSignals(req.user.id, lead.id);
  const score = scoreLead(lead, engagement);

  const updated = await sql`
UPDATE outbound_leads
     SET fit_score = ${score.fitScore},
         intent_score = ${score.intentScore},
         total_score = ${score.totalScore},
         status = ${score.status},
         next_recommended_action = ${score.nextRecommendedAction},
         updated_at = NOW()
     WHERE id = ${req.params.id}
     RETURNING *
`.execute(db);

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
  const leadRes = await sql`
SELECT * FROM outbound_leads WHERE id = ${req.params.leadId} AND user_id = ${req.user.id}
`.execute(db);
  if (leadRes.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  const lead = leadRes.rows[0];
  const engagement = await computeEngagementSignals(req.user.id, lead.id);
  const explanation = scoreLead(lead, engagement);

  const historyRes = await sql`
SELECT id, fit_score, intent_score, engagement_score, total_score, status, next_recommended_action, reasons, source, created_at
     FROM lead_score_history
     WHERE user_id = ${req.user.id} AND lead_id = ${lead.id}
     ORDER BY created_at DESC
     LIMIT 30
`.execute(db);

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
router.patch('/leads/:id/suppression', validateBody(SuppressionSchema), async (req, res) => {
  const { suppressed, reason } = req.validatedBody;

  const leadRes = await sql`
SELECT * FROM outbound_leads WHERE id = ${req.params.id} AND user_id = ${req.user.id}
`.execute(db);

  if (leadRes.rows.length === 0) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  if (suppressed && !reason) {
    return res.status(400).json({ error: 'Suppression reason is required.' });
  }

  const updatedRes = await sql`
UPDATE outbound_leads
     SET status = CASE
          WHEN $1::boolean = TRUE THEN 'suppressed'
          WHEN status = 'suppressed' THEN 'new'
          ELSE status
        END,
        suppression_reason = CASE WHEN ${suppressed}::boolean = TRUE THEN ${reason} ELSE NULL END,
        updated_at = NOW()
     WHERE id = ${req.params.id} AND user_id = ${req.user.id}
     RETURNING *
`.execute(db);

  const updatedLead = updatedRes.rows[0];
  await logLeadEvent({
    userId: req.user.id,
    leadId: updatedLead.id,
    eventType: suppressed ? 'lead_suppressed' : 'lead_unsuppressed',
    metadata: { reason: suppressed ? reason : null },
  });
  const autoStoppedEnrollmentIds = suppressed
    ? await sequenceService.autoStopOpenSequenceEnrollments({
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
  const config = outboundUtils.LEAD_OUTCOME_EVENT_MAP[outcome];

  if (!config) {
    return res.status(400).json({
      error: 'Invalid outcome. Use replied, meeting, opportunity, or hard_bounce.',
    });
  }

  const leadRes = await sql`
SELECT id, name
     FROM outbound_leads
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
`.execute(db);
  if (!leadRes.rows.length) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  const updatedRes = await sql`
UPDATE outbound_leads
     SET status = $1,
         suppression_reason = CASE
           WHEN ${config.leadStatus} = 'disqualified' THEN COALESCE(${note}, suppression_reason, 'Hard bounce')
           WHEN status = 'suppressed' THEN NULL
           ELSE suppression_reason
         END,
         updated_at = NOW()
     WHERE id = ${req.params.id}
       AND user_id = ${req.user.id}
     RETURNING *
`.execute(db);
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

  const autoStoppedEnrollmentIds = await sequenceService.autoStopOpenSequenceEnrollments({
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
router.post('/drafts/generate', validateBody(CreateDraftSchema), async (req, res) => {
  try {
    const result = await draftService.generateDraft({
      userId: req.user.id,
      leadId: req.validatedBody.leadId,
      channel: req.validatedBody.channel,
      logLeadEventFn: logLeadEvent,
    });
    return res.status(201).json(result);
  } catch (err) {
    const statusCode = err.message.includes('not found') ? 404 : err.message.includes('suppressed') ? 409 : 500;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/outbound/drafts/inbox
 * Query: status, channel, leadId, limit
 */
router.get('/drafts/inbox', async (req, res) => {
  try {
    const result = await draftService.getDraftInbox({
      userId: req.user.id,
      status: req.query.status ? String(req.query.status).trim().toLowerCase() : '',
      channel: req.query.channel ? String(req.query.channel).trim().toLowerCase() : '',
      leadId: req.query.leadId ? outboundUtils.sanitizeUuidValue(req.query.leadId) : null,
      limit: Number(req.query.limit || 100),
    });
    return res.json({
      total: result.drafts.length,
      drafts: result.drafts,
      summary: result.summary || {
        total_count: 0,
        drafted_count: 0,
        approved_count: 0,
        sent_count: 0,
        pending_linkedin_count: 0,
      },
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/outbound/linkedin/tasks/board
 * Query: status, limit
 */
router.get('/linkedin/tasks/board', async (req, res) => {
  const status = req.query.status ? String(req.query.status).trim().toLowerCase() : '';
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

  if (status && !outboundUtils.VALID_LINKEDIN_TASK_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid linkedin task status filter.' });
  }

  const conditions = [sql`t.user_id = ${req.user.id}`];
  if (status) {
    conditions.push(sql`t.status = ${status}`);
  }

  const tasksRes = await sql`
    SELECT
      t.*,
      l.name AS lead_name,
      l.email AS lead_email,
      l.company AS lead_company,
      l.title AS lead_title,
      l.total_score AS lead_total_score,
      l.status AS lead_status,
      l.suppression_reason AS lead_suppression_reason,
      d.channel AS draft_channel,
      d.status AS draft_status,
      d.subject AS draft_subject
    FROM linkedin_outreach_tasks t
    LEFT JOIN outbound_leads l ON l.id = t.lead_id
    LEFT JOIN outbound_message_drafts d ON d.id = t.draft_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY
      CASE t.status
        WHEN 'approved' THEN 1
        WHEN 'drafted' THEN 2
        WHEN 'pending' THEN 3
        WHEN 'blocked' THEN 4
        WHEN 'completed' THEN 5
        ELSE 6
      END,
      t.due_at ASC NULLS LAST,
      t.updated_at DESC
    LIMIT ${limit}
  `.execute(db);

  const boardBuckets = outboundUtils.mapTaskBoardBuckets(tasksRes.rows);
  const usage = await getDailySendUsage(req.user.id, 'linkedin');
  const openStatuses = new Set(['pending', 'drafted', 'approved', 'blocked']);
  const openTasks = tasksRes.rows.filter((row) => openStatuses.has(row.status));
  const overdueCount = openTasks.filter((row) => row.due_at && new Date(row.due_at).getTime() < Date.now()).length;
  const approvedReadyCount = openTasks.filter((row) => row.status === 'approved').length;
  const draftedCount = openTasks.filter((row) => row.status === 'drafted').length;
  const recommendedToday = Math.max(0, Math.min(usage.remaining, approvedReadyCount + Math.ceil(draftedCount * 0.5)));
  const referenceDailyCapacity = usage.limit > 0 ? usage.limit : Math.max(1, usage.remaining);
  const estimatedDaysToClearOpen = referenceDailyCapacity > 0 ? Math.ceil(openTasks.length / referenceDailyCapacity) : null;

  return res.json({
    total: tasksRes.rows.length,
    tasks: tasksRes.rows.map(outboundUtils.mapLinkedinTaskBoardRow),
    board: boardBuckets,
    workload: {
      openCount: openTasks.length,
      approvedReadyCount,
      draftedCount,
      overdueCount,
      dailyUsage: usage,
      recommendedToday,
      estimatedDaysToClearOpen,
    },
  });
});

/**
 * POST /api/outbound/linkedin/tasks/rebalance
 * Body: { dailyCapacity? }
 */
router.post('/linkedin/tasks/rebalance', async (req, res) => {
  const usage = await getDailySendUsage(req.user.id, 'linkedin');
  const requestedCapacity = Number(req.body?.dailyCapacity || 0);
  const fallbackCapacity = usage.limit > 0 ? usage.limit : 20;
  const dailyCapacity = Math.max(1, Math.min(500, Number.isFinite(requestedCapacity) && requestedCapacity > 0 ? requestedCapacity : fallbackCapacity));

  const openRes = await sql`
SELECT
       t.id,
       t.status,
       t.due_at,
       t.created_at,
       l.total_score AS lead_total_score
     FROM linkedin_outreach_tasks t
     LEFT JOIN outbound_leads l ON l.id = t.lead_id
     WHERE t.user_id = ${req.user.id}
       AND t.status IN ('pending', 'drafted', 'approved', 'blocked')
     ORDER BY t.created_at ASC
`.execute(db);

  const openTasks = openRes.rows
    .map((row) => ({ ...row, priority_score: outboundUtils.computeLinkedinTaskPriority(row) }))
    .sort((a, b) => {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  if (openTasks.length === 0) {
    return res.json({
      rebalancedCount: 0,
      dailyCapacity,
      windowDays: 0,
      updatedTaskIds: [],
      workload: {
        openCount: 0,
        recommendedToday: 0,
      },
    });
  }

  const start = new Date();
  start.setHours(9, 0, 0, 0);

  const updatedTaskIds = [];
  for (let index = 0; index < openTasks.length; index++) {
    const task = openTasks[index];
    const dayOffset = Math.floor(index / dailyCapacity);
    const slot = index % dailyCapacity;
    const nextDueAt = new Date(start.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    nextDueAt.setHours(9 + Math.min(8, slot), 0, 0, 0);

    await sql`
UPDATE linkedin_outreach_tasks
       SET due_at = ${nextDueAt.toISOString()},
           updated_at = NOW()
       WHERE id = ${task.id}
         AND user_id = ${req.user.id}
`.execute(db);
    updatedTaskIds.push(task.id);
  }

  logAction(req.user.id, req.user.email, 'outbound_linkedin_workload_rebalanced', 'linkedin_task', null, null, {
    rebalancedCount: updatedTaskIds.length,
    dailyCapacity,
  });

  const windowDays = Math.ceil(openTasks.length / dailyCapacity);
  return res.json({
    rebalancedCount: updatedTaskIds.length,
    dailyCapacity,
    windowDays,
    updatedTaskIds,
    workload: {
      openCount: openTasks.length,
      recommendedToday: Math.max(0, Math.min(usage.remaining, dailyCapacity)),
      dailyUsage: usage,
    },
  });
});

/**
 * PATCH /api/outbound/drafts/:id/approve
 */
router.patch('/drafts/:id/approve', async (req, res) => {
  try {
    const draft = await draftService.approveDraft({
      userId: req.user.id,
      draftId: req.params.id,
      logLeadEventFn: logLeadEvent,
    });
    return res.json(draft);
  } catch (err) {
    const statusCode = err.message.includes('not found') ? 404 : 409;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/outbound/drafts/:id/send
 * Manual send confirmation for email drafts
 */
router.post('/drafts/:id/send', async (req, res) => {
  try {
    const result = await draftService.sendDraft({
      userId: req.user.id,
      draftId: req.params.id,
      logLeadEventFn: logLeadEvent,
    });
    return res.json(result);
  } catch (err) {
    if (err.statusCode === 429) {
      return res.status(429).json({
        error: err.message,
        dailyUsage: err.dailyUsage,
      });
    }
    const statusCode = err.message.includes('not found') ? 404 : err.message.includes('must be approved') || err.message.includes('already sent') || err.message.includes('suppressed') ? 409 : 400;
    return res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/outbound/linkedin/tasks/:id/complete
 */
router.post('/linkedin/tasks/:id/complete', async (req, res) => {
  const { notes = null } = req.body;
  const existingTaskRes = await sql`
SELECT t.*, d.status AS draft_status, l.status AS lead_status, l.suppression_reason
     FROM linkedin_outreach_tasks t
     LEFT JOIN outbound_message_drafts d ON d.id = t.draft_id
     LEFT JOIN outbound_leads l ON l.id = t.lead_id
     WHERE t.id = ${req.params.id} AND t.user_id = ${req.user.id}
`.execute(db);

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

  const taskRes = await sql`
UPDATE linkedin_outreach_tasks
     SET status = 'completed',
         completed_at = NOW(),
         notes = ${notes},
         updated_at = NOW()
     WHERE id = ${req.params.id} AND user_id = ${req.user.id}
     RETURNING *
`.execute(db);

  const task = taskRes.rows[0];

  if (task.draft_id) {
    await sql`
UPDATE outbound_message_drafts
       SET status = 'sent',
           sent_at = COALESCE(sent_at, NOW()),
           updated_at = NOW()
       WHERE id = ${task.draft_id}
         AND user_id = ${req.user.id}
         AND status = 'approved'
`.execute(db);
  }

  await sql`
UPDATE outbound_leads
     SET status = CASE WHEN status IN ('new', 'qualified', 'queued') THEN 'contacted' ELSE status END,
         last_outreach_channel = 'linkedin',
         updated_at = NOW()
     WHERE id = ${task.lead_id} AND user_id = ${req.user.id}
`.execute(db);

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

  const filters = [
    sql`e.user_id = ${req.user.id}`,
    sql`e.created_at >= NOW() - (${String(days)}::text || ' days')::interval`,
  ];

  if (req.query.channel) {
    filters.push(sql`e.channel = ${String(req.query.channel)}`);
  }

  if (req.query.eventType) {
    filters.push(sql`e.event_type = ${String(req.query.eventType)}`);
  }

  const query = sql`
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
    WHERE ${sql.join(filters, sql` AND `)}
    ORDER BY e.created_at DESC
    LIMIT ${limit}
  `;

  const result = await query.execute(db);

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
        .map(outboundUtils.csvEscape)
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

  const result = await sql`
SELECT id, created_at, action, resource_type, resource_id, resource_name, metadata
     FROM audit_logs
     WHERE user_id = ${req.user.id}
       AND action LIKE 'outbound_%'
       AND created_at >= NOW() - (${days}::text || ' days')::interval
     ORDER BY created_at DESC
     LIMIT ${limit}
`.execute(db);

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
        .map(outboundUtils.csvEscape)
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
router.put('/forecast/goals', validateBody(SaveGoalsSchema), async (req, res) => {
  const { periodType, targetMeetings, targetOpportunities, targetRevenue, notes } = req.validatedBody;
  const period = outboundUtils.getCurrentPeriodWindow(periodType);

  const goalRes = await sql`
INSERT INTO sales_goals
      (user_id, period_type, period_start, period_end, target_meetings, target_opportunities, target_revenue, notes, updated_at)
     VALUES (${req.user.id}, ${period.periodType}, ${period.periodStart}::date, ${period.periodEnd}::date, ${targetMeetings}, ${targetOpportunities}, ${targetRevenue}, ${notes}, NOW())
     ON CONFLICT (user_id, period_type, period_start, period_end)
     DO UPDATE SET
       target_meetings = EXCLUDED.target_meetings,
       target_opportunities = EXCLUDED.target_opportunities,
       target_revenue = EXCLUDED.target_revenue,
       notes = EXCLUDED.notes,
       updated_at = NOW()
     RETURNING *
`.execute(db);

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
      targetRevenue: outboundUtils.round2(targetRevenue),
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
      targetRevenue: outboundUtils.round2(Number(goal.target_revenue || 0)),
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
  if (!outboundUtils.VALID_FORECAST_PERIOD_TYPES.has(periodType)) {
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
  if (!outboundUtils.VALID_FORECAST_PERIOD_TYPES.has(periodType)) {
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
    sql`
SELECT
         COUNT(*) AS total_leads,
         SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified_count,
         SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) AS contacted_count,
         SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied_count,
         SUM(CASE WHEN status = 'meeting' THEN 1 ELSE 0 END) AS meeting_count,
         SUM(CASE WHEN status = 'opportunity' THEN 1 ELSE 0 END) AS opportunity_count,
         AVG(total_score)::numeric(10,2) AS avg_total_score
       FROM outbound_leads
       WHERE user_id = ${req.user.id}
`.execute(db),
    sql`
SELECT channel, event_type, COUNT(*) AS event_count
       FROM lead_source_events
       WHERE user_id = ${req.user.id}
         AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY channel, event_type
       ORDER BY event_count DESC
`.execute(db),
    sql`
SELECT COUNT(*) AS pending_count
       FROM linkedin_outreach_tasks
       WHERE user_id = ${req.user.id}
         AND status IN ('pending', 'drafted', 'approved')
`.execute(db),
    getDailySendUsage(req.user.id, 'email'),
    getDailySendUsage(req.user.id, 'linkedin'),
    sql`
SELECT
         COUNT(*)::int AS total_campaigns,
         COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0)::int AS active_campaigns
       FROM outbound_campaigns
       WHERE user_id = ${req.user.id}
`.execute(db),
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

// ─── WORKSPACE CONFIG ─────────────────────────────────────────────────────────

const WORKSPACE_CONFIG_DEFAULTS = {
  sender_name: '',
  email_signature: '',
  daily_email_limit: 50,
  daily_linkedin_limit: 20,
  sla_draft_stale_hours: 24,
  sla_linkedin_overdue_hours: 24,
  sla_paused_stale_days: 3,
  sla_high_score_not_contacted_days: 2,
};

async function getOrCreateWorkspaceConfig(userId) {
  const existing = await sql`SELECT * FROM outbound_workspace_config WHERE user_id = ${userId}`.execute(db);
  if (existing.rows.length > 0) return existing.rows[0];
  const ins = await sql`
INSERT INTO outbound_workspace_config
       (user_id, sender_name, email_signature, daily_email_limit, daily_linkedin_limit,
        sla_draft_stale_hours, sla_linkedin_overdue_hours, sla_paused_stale_days,
        sla_high_score_not_contacted_days)
     VALUES (${userId},${WORKSPACE_CONFIG_DEFAULTS.sender_name},${WORKSPACE_CONFIG_DEFAULTS.email_signature},${WORKSPACE_CONFIG_DEFAULTS.daily_email_limit},${WORKSPACE_CONFIG_DEFAULTS.daily_linkedin_limit},${WORKSPACE_CONFIG_DEFAULTS.sla_draft_stale_hours},${WORKSPACE_CONFIG_DEFAULTS.sla_linkedin_overdue_hours},${WORKSPACE_CONFIG_DEFAULTS.sla_paused_stale_days},${WORKSPACE_CONFIG_DEFAULTS.sla_high_score_not_contacted_days})
     RETURNING *
`.execute(db);
  return ins.rows[0];
}

function formatWorkspaceConfig(row) {
  return {
    senderName: row.sender_name,
    emailSignature: row.email_signature,
    dailyEmailLimit: Number(row.daily_email_limit),
    dailyLinkedinLimit: Number(row.daily_linkedin_limit),
    slaDraftStaleHours: Number(row.sla_draft_stale_hours),
    slaLinkedinOverdueHours: Number(row.sla_linkedin_overdue_hours),
    slaPausedStaleDays: Number(row.sla_paused_stale_days),
    slaHighScoreNotContactedDays: Number(row.sla_high_score_not_contacted_days),
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/outbound/workspace/config
 */
router.get('/workspace/config', async (req, res) => {
  const cfg = await getOrCreateWorkspaceConfig(req.user.id);
  return res.json(formatWorkspaceConfig(cfg));
});

/**
 * PUT /api/outbound/workspace/config
 */
router.put('/workspace/config', validateBody(WorkspaceConfigSchema), async (req, res) => {
  const {
    senderName,
    emailSignature,
    dailyEmailLimit,
    dailyLinkedinLimit,
    slaDraftStaleHours,
    slaLinkedinOverdueHours,
    slaPausedStaleDays,
    slaHighScoreNotContactedDays,
  } = req.validatedBody;

  const emailLimitVal = Math.round(Number(dailyEmailLimit ?? 50));
  const linkedinLimitVal = Math.round(Number(dailyLinkedinLimit ?? 20));
  if (emailLimitVal < 1 || emailLimitVal > 500) {
    return res.status(400).json({ error: 'dailyEmailLimit must be between 1 and 500.' });
  }
  if (linkedinLimitVal < 1 || linkedinLimitVal > 100) {
    return res.status(400).json({ error: 'dailyLinkedinLimit must be between 1 and 100.' });
  }

  const result = await sql`
INSERT INTO outbound_workspace_config
       (user_id, sender_name, email_signature, daily_email_limit, daily_linkedin_limit,
        sla_draft_stale_hours, sla_linkedin_overdue_hours, sla_paused_stale_days,
        sla_high_score_not_contacted_days, updated_at)
     VALUES (${req.user.id},${String(senderName ?? '').slice(0, 200)},${String(emailSignature ?? '').slice(0, 2000)},${emailLimitVal},${linkedinLimitVal},${Math.max(1, Math.round(Number(slaDraftStaleHours ?? 24)))},${Math.max(1, Math.round(Number(slaLinkedinOverdueHours ?? 24)))},${Math.max(1, Math.round(Number(slaPausedStaleDays ?? 3)))},${Math.max(1, Math.round(Number(slaHighScoreNotContactedDays ?? 2)))},NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       sender_name = EXCLUDED.sender_name,
       email_signature = EXCLUDED.email_signature,
       daily_email_limit = EXCLUDED.daily_email_limit,
       daily_linkedin_limit = EXCLUDED.daily_linkedin_limit,
       sla_draft_stale_hours = EXCLUDED.sla_draft_stale_hours,
       sla_linkedin_overdue_hours = EXCLUDED.sla_linkedin_overdue_hours,
       sla_paused_stale_days = EXCLUDED.sla_paused_stale_days,
       sla_high_score_not_contacted_days = EXCLUDED.sla_high_score_not_contacted_days,
       updated_at = NOW()
     RETURNING *
`.execute(db);

  return res.json(formatWorkspaceConfig(result.rows[0]));
});

// ─── ADVANCED BULK ACTIONS ────────────────────────────────────────────────────

/**
 * POST /api/outbound/bulk/sequence-enroll
 * Body: { leadIds: string[], sequenceId: string }
 */
router.post('/bulk/sequence-enroll', async (req, res) => {
  const { leadIds, sequenceId } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'leadIds must be a non-empty array.' });
  }
  if (leadIds.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 leads per bulk operation.' });
  }
  if (!sequenceId || typeof sequenceId !== 'string') {
    return res.status(400).json({ error: 'sequenceId is required.' });
  }

  const seqCheck = await sql`SELECT id FROM outbound_sequences WHERE id = ${sequenceId} AND user_id = ${req.user.id}`.execute(db);
  if (seqCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Sequence not found.' });
  }

  const results = { enrolled: [], skipped: [], errors: [] };

  for (const leadId of leadIds) {
    try {
      const leadRow = await sql`SELECT id, email, linkedin_url FROM outbound_leads WHERE id = ${leadId} AND user_id = ${req.user.id}`.execute(db);
      if (leadRow.rows.length === 0) {
        results.errors.push({ leadId, reason: 'Not found' });
        continue;
      }
      const lead = leadRow.rows[0];
      if (!lead.email && !lead.linkedin_url) {
        results.skipped.push({ leadId, reason: 'Missing contact channel (data quality block)' });
        continue;
      }
      const openCheck = await sql`
SELECT id FROM outbound_sequence_enrollments
         WHERE lead_id = ${leadId} AND user_id = ${req.user.id} AND state IN ('active','paused')
`.execute(db);
      if (openCheck.rows.length > 0) {
        results.skipped.push({ leadId, reason: 'Already enrolled in an active sequence' });
        continue;
      }
      const enroll = await sql`
INSERT INTO outbound_sequence_enrollments
           (user_id, lead_id, sequence_id, state, current_step, enrolled_at)
         VALUES (${req.user.id},${leadId},${sequenceId},'active',1,NOW()) RETURNING id
`.execute(db);
      await sql`
INSERT INTO outbound_sequence_enrollment_transitions
           (enrollment_id, from_state, to_state, reason)
         VALUES (${enroll.rows[0].id},NULL,'active','Bulk enrolled')
`.execute(db);
      await sql`
INSERT INTO lead_source_events (user_id, lead_id, event_type, channel, metadata)
         VALUES (${req.user.id},${leadId},'sequence_enrolled','system',${JSON.stringify({ sequenceId, enrollmentId: enroll.rows[0].id, bulk: true })})
`.execute(db);
      results.enrolled.push(leadId);
    } catch (err) {
      results.errors.push({ leadId, reason: err.message });
    }
  }

  return res.json({
    enrolledCount: results.enrolled.length,
    skippedCount: results.skipped.length,
    errorCount: results.errors.length,
    enrolled: results.enrolled,
    skipped: results.skipped,
    errors: results.errors,
  });
});

/**
 * POST /api/outbound/bulk/sequence-unenroll
 * Body: { leadIds: string[] }
 */
router.post('/bulk/sequence-unenroll', async (req, res) => {
  const { leadIds } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'leadIds must be a non-empty array.' });
  }
  if (leadIds.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 leads per bulk operation.' });
  }

  const results = { stopped: [], skipped: [], errors: [] };

  for (const leadId of leadIds) {
    try {
      const enrollment = await sql`
SELECT id, state FROM outbound_sequence_enrollments
         WHERE lead_id = ${leadId} AND user_id = ${req.user.id} AND state IN ('active','paused')
         ORDER BY enrolled_at DESC LIMIT 1
`.execute(db);
      if (enrollment.rows.length === 0) {
        results.skipped.push({ leadId, reason: 'No active enrollment found' });
        continue;
      }
      const fromState = enrollment.rows[0].state;
      await sql`
UPDATE outbound_sequence_enrollments SET state = 'stopped', stopped_at = NOW()
         WHERE id = ${enrollment.rows[0].id}
`.execute(db);
      await sql`
INSERT INTO outbound_sequence_enrollment_transitions
           (enrollment_id, from_state, to_state, reason)
         VALUES (${enrollment.rows[0].id},${fromState},'stopped','Bulk unenroll')
`.execute(db);
      results.stopped.push(leadId);
    } catch (err) {
      results.errors.push({ leadId, reason: err.message });
    }
  }

  return res.json({
    stoppedCount: results.stopped.length,
    skippedCount: results.skipped.length,
    errorCount: results.errors.length,
    stopped: results.stopped,
    skipped: results.skipped,
    errors: results.errors,
  });
});

/**
 * POST /api/outbound/bulk/multifamily-tag
 * Body: { leadIds: string[], objectId: string }
 */
router.post('/bulk/multifamily-tag', async (req, res) => {
  const { leadIds, objectId } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'leadIds must be a non-empty array.' });
  }
  if (leadIds.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 leads per bulk operation.' });
  }
  if (!objectId || typeof objectId !== 'string') {
    return res.status(400).json({ error: 'objectId is required.' });
  }

  const objCheck = await sql`SELECT id FROM multifamily_objects WHERE id = ${objectId} AND user_id = ${req.user.id}`.execute(db);
  if (objCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Multifamily object not found.' });
  }

  const results = { tagged: [], errors: [] };

  for (const leadId of leadIds) {
    try {
      await sql`
INSERT INTO multifamily_object_associations (object_id, target_type, target_id, user_id)
         VALUES (${objectId},'outbound_lead',${leadId},${req.user.id})
         ON CONFLICT DO NOTHING
`.execute(db);
      results.tagged.push(leadId);
    } catch (err) {
      results.errors.push({ leadId, reason: err.message });
    }
  }

  return res.json({
    taggedCount: results.tagged.length,
    errorCount: results.errors.length,
    tagged: results.tagged,
    errors: results.errors,
  });
});

/**
 * POST /api/outbound/bulk/campaign-transition
 * Body: { memberIds: string[], status: string }
 */
router.post('/bulk/campaign-transition', async (req, res) => {
  const { memberIds, status } = req.body;
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: 'memberIds must be a non-empty array.' });
  }
  if (memberIds.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 members per bulk operation.' });
  }
  if (!outboundUtils.VALID_CAMPAIGN_MEMBER_STATUSES.has(status)) {
    return res.status(400).json({
      error: `Invalid status. Valid values: ${[...outboundUtils.VALID_CAMPAIGN_MEMBER_STATUSES].join(', ')}.`,
    });
  }

  const results = { updated: [], errors: [] };

  for (const memberId of memberIds) {
    try {
      const upd = await sql`
UPDATE outbound_campaign_members SET status = ${status}, updated_at = NOW()
         WHERE id = ${memberId} AND user_id = ${req.user.id} RETURNING id, lead_id
`.execute(db);
      if (upd.rows.length === 0) {
        results.errors.push({ memberId, reason: 'Not found or unauthorized' });
        continue;
      }
      const leadStatus = outboundUtils.CAMPAIGN_MEMBER_TO_LEAD_STATUS[status];
      if (leadStatus && upd.rows[0].lead_id) {
        await sql`
UPDATE outbound_leads SET status = ${leadStatus}, updated_at = NOW()
           WHERE id = ${upd.rows[0].lead_id} AND user_id = ${req.user.id}
`.execute(db);
      }
      results.updated.push(memberId);
    } catch (err) {
      results.errors.push({ memberId, reason: err.message });
    }
  }

  return res.json({
    updatedCount: results.updated.length,
    errorCount: results.errors.length,
    updated: results.updated,
    errors: results.errors,
  });
});

// ─── SLA ESCALATIONS ──────────────────────────────────────────────────────────

const VALID_ESCALATION_TYPES = new Set([
  'draft_stale',
  'linkedin_overdue',
  'paused_stale',
  'high_score_not_contacted',
]);
const VALID_ESCALATION_ACTIONS = new Set(['notify', 'log_event']);
const ESCALATION_TYPE_LABELS = {
  draft_stale: 'Stale Approved Email Draft',
  linkedin_overdue: 'Overdue LinkedIn Task',
  paused_stale: 'Stale Paused Sequence',
  high_score_not_contacted: 'High-Score Lead Not Contacted',
};

async function runEscalationChecks(userId) {
  const cfg = await getOrCreateWorkspaceConfig(userId);
  const escalations = await sql`SELECT * FROM outbound_sla_escalations WHERE user_id = ${userId} AND is_enabled = TRUE`.execute(db);

  const triggered = [];

  for (const rule of escalations.rows) {
    const type = rule.escalation_type;
    let items = [];

    if (type === 'draft_stale') {
      const hours = rule.threshold_override ?? Number(cfg.sla_draft_stale_hours);
      const res = await sql`
SELECT d.id, ol.name
         FROM outbound_message_drafts d
         JOIN outbound_leads ol ON ol.id = d.lead_id
         WHERE d.user_id = ${userId} AND d.status = 'approved'
           AND d.updated_at < NOW() - (${hours} || ' hours')::INTERVAL
`.execute(db);
      items = res.rows.map((r) => ({ id: r.id, label: r.name || 'Unknown lead' }));
    } else if (type === 'linkedin_overdue') {
      const hours = rule.threshold_override ?? Number(cfg.sla_linkedin_overdue_hours);
      const res = await sql`
SELECT t.id, ol.name
         FROM linkedin_outreach_tasks t
         JOIN outbound_leads ol ON ol.id = t.lead_id
         WHERE t.user_id = ${userId} AND t.status IN ('pending','drafted','approved')
           AND t.scheduled_for < NOW() - (${hours} || ' hours')::INTERVAL
`.execute(db);
      items = res.rows.map((r) => ({ id: r.id, label: r.name || 'Unknown lead' }));
    } else if (type === 'paused_stale') {
      const days = rule.threshold_override ?? Number(cfg.sla_paused_stale_days);
      const res = await sql`
SELECT e.id, ol.name
         FROM outbound_sequence_enrollments e
         JOIN outbound_leads ol ON ol.id = e.lead_id
         WHERE e.user_id = ${userId} AND e.state = 'paused'
           AND e.updated_at < NOW() - (${days} || ' days')::INTERVAL
`.execute(db);
      items = res.rows.map((r) => ({ id: r.id, label: r.name || 'Unknown lead' }));
    } else if (type === 'high_score_not_contacted') {
      const days = rule.threshold_override ?? Number(cfg.sla_high_score_not_contacted_days);
      const res = await sql`
SELECT id, name FROM outbound_leads
         WHERE user_id = ${userId} AND total_score >= 70
           AND status IN ('new','qualified')
           AND created_at < NOW() - (${days} || ' days')::INTERVAL
`.execute(db);
      items = res.rows.map((r) => ({ id: r.id, label: r.name || 'Unknown lead' }));
    }

    if (items.length > 0) {
      const title = ESCALATION_TYPE_LABELS[type] || type;
      const body = `${items.length} item${items.length === 1 ? '' : 's'} need attention: ${
        items
          .slice(0, 3)
          .map((i) => i.label)
          .join(', ')
      }${items.length > 3 ? ` and ${items.length - 3} more` : ''}.`;

      if (rule.action === 'notify') {
        await sql`
INSERT INTO outbound_notifications (user_id, notification_type, title, body)
           VALUES (${userId},${type},${title},${body})
`.execute(db);
      } else {
        await sql`
INSERT INTO lead_source_events (user_id, lead_id, event_type, channel, metadata)
           VALUES (${userId},NULL,'sla_escalation_triggered','system',${JSON.stringify({ escalationType: type, count: items.length })})
`.execute(db);
      }

      await sql`UPDATE outbound_sla_escalations SET last_run_at = NOW() WHERE id = ${rule.id}`.execute(db);
      triggered.push({ type, count: items.length, action: rule.action });
    }
  }

  return triggered;
}

function formatEscalationRule(r) {
  return {
    id: r.id,
    escalationType: r.escalation_type,
    label: ESCALATION_TYPE_LABELS[r.escalation_type] || r.escalation_type,
    thresholdOverride: r.threshold_override,
    action: r.action,
    isEnabled: r.is_enabled,
    lastRunAt: r.last_run_at,
    createdAt: r.created_at,
  };
}

/**
 * GET /api/outbound/sla/escalations
 */
router.get('/sla/escalations', async (req, res) => {
  const rows = await sql`SELECT * FROM outbound_sla_escalations WHERE user_id = ${req.user.id} ORDER BY created_at`.execute(db);
  return res.json(rows.rows.map(formatEscalationRule));
});

/**
 * POST /api/outbound/sla/escalations
 * Body: { escalationType, thresholdOverride?, action? }
 */
router.post('/sla/escalations', async (req, res) => {
  const { escalationType, thresholdOverride, action = 'notify' } = req.body;
  if (!VALID_ESCALATION_TYPES.has(escalationType)) {
    return res.status(400).json({
      error: `escalationType must be one of: ${[...VALID_ESCALATION_TYPES].join(', ')}.`,
    });
  }
  if (!VALID_ESCALATION_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'action must be notify or log_event.' });
  }

  const result = await sql`
INSERT INTO outbound_sla_escalations
       (user_id, escalation_type, threshold_override, action)
     VALUES (${req.user.id},${escalationType},${thresholdOverride != null ? Number(thresholdOverride) : null},${action})
     ON CONFLICT (user_id, escalation_type) DO UPDATE SET
       threshold_override = EXCLUDED.threshold_override,
       action = EXCLUDED.action,
       is_enabled = TRUE
     RETURNING *
`.execute(db);

  return res.status(201).json(formatEscalationRule(result.rows[0]));
});

/**
 * PATCH /api/outbound/sla/escalations/:id
 * Body: { isEnabled?, thresholdOverride?, action? }
 */
router.patch('/sla/escalations/:id', async (req, res) => {
  const { isEnabled, thresholdOverride, action } = req.body;

  const setClauses = [];
  if (typeof isEnabled === 'boolean') {
    setClauses.push(sql`is_enabled = ${isEnabled}`);
  }
  if (thresholdOverride !== undefined) {
    setClauses.push(sql`threshold_override = ${thresholdOverride !== null ? Number(thresholdOverride) : null}`);
  }
  if (action !== undefined) {
    if (!VALID_ESCALATION_ACTIONS.has(action)) {
      return res.status(400).json({ error: 'action must be notify or log_event.' });
    }
    setClauses.push(sql`action = ${action}`);
  }
  if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update.' });

  const result = await sql`
UPDATE outbound_sla_escalations
     SET ${setClauses.reduce((acc, clause, i) => sql`${acc}${i > 0 ? sql`, ` : sql``}${clause}`, sql``)}
     WHERE id = ${req.params.id} AND user_id = ${req.user.id} RETURNING *
`.execute(db);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Escalation rule not found.' });
  return res.json(formatEscalationRule(result.rows[0]));
});

/**
 * POST /api/outbound/sla/escalations/run
 */
router.post('/sla/escalations/run', async (req, res) => {
  const triggered = await runEscalationChecks(req.user.id);
  return res.json({ triggered, triggeredCount: triggered.length });
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

/**
 * GET /api/outbound/notifications
 * Query: unreadOnly=true
 */
router.get('/notifications', async (req, res) => {
  const unreadOnly = req.query.unreadOnly === 'true';
  const rows = await sql`
SELECT * FROM outbound_notifications
     WHERE user_id = ${req.user.id} ${unreadOnly ? sql`AND is_read = FALSE` : sql``}
     ORDER BY is_read ASC, created_at DESC
     LIMIT 100
`.execute(db);
  const unreadCount = rows.rows.filter((r) => !r.is_read).length;
  return res.json({
    unreadCount,
    notifications: rows.rows.map((r) => ({
      id: r.id,
      type: r.notification_type,
      title: r.title,
      body: r.body,
      relatedEntityType: r.related_entity_type,
      relatedEntityId: r.related_entity_id,
      isRead: r.is_read,
      createdAt: r.created_at,
    })),
  });
});

/**
 * PATCH /api/outbound/notifications/:id/read
 */
router.patch('/notifications/:id/read', async (req, res) => {
  const result = await sql`
UPDATE outbound_notifications SET is_read = TRUE
     WHERE id = ${req.params.id} AND user_id = ${req.user.id} RETURNING id
`.execute(db);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Notification not found.' });
  return res.json({ id: result.rows[0].id, isRead: true });
});

/**
 * POST /api/outbound/notifications/read-all
 */
router.post('/notifications/read-all', async (req, res) => {
  const result = await sql`
UPDATE outbound_notifications SET is_read = TRUE
     WHERE user_id = ${req.user.id} AND is_read = FALSE RETURNING id
`.execute(db);
  return res.json({ markedRead: result.rows.length });
});

module.exports = router;
