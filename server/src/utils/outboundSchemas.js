const { z } = require('zod')

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// --- Enums ---
const SourceType = z.enum(['csv', 'manual', 'api', 'other'])
const OutboundLeadStatus = z.enum([
  'new', 'qualified', 'queued', 'contacted', 'replied',
  'meeting', 'opportunity', 'disqualified', 'suppressed',
])
const CampaignStatus = z.enum(['draft', 'active', 'paused', 'completed', 'archived'])
const CampaignChannel = z.enum(['email', 'linkedin'])
const CampaignMemberStatus = z.enum([
  'queued', 'contacted', 'replied', 'meeting', 'opportunity', 'suppressed', 'dropped',
])
const SequenceEnrollmentState = z.enum(['active', 'paused', 'stopped', 'completed', 'error'])
const DraftStatus = z.enum(['drafted', 'approved', 'sent', 'archived'])
const DraftChannel = z.enum(['email', 'linkedin'])
const LinkedInTaskStatus = z.enum(['pending', 'drafted', 'approved', 'completed', 'skipped', 'blocked'])
const DataQualityStatus = z.enum(['open', 'resolved', 'dismissed'])
const DataQualityIssueType = z.enum([
  'missing_contact_channel', 'missing_company', 'missing_title',
  'low_source_confidence', 'stale_lead', 'potential_duplicate',
])
const MultifamilyObjectType = z.enum(['portfolio', 'property', 'tech_stack', 'initiative'])
const MultifamilyEntityType = z.enum(['outbound_lead', 'contact', 'deal', 'company'])
const ForecastPeriodType = z.enum(['weekly', 'monthly'])
const RuleTriggerEvent = z.enum([
  'lead_imported', 'draft_generated', 'draft_approved', 'draft_sent',
  'linkedin_task_completed', 'lead_suppressed', 'lead_unsuppressed',
  'lead_replied', 'meeting_booked', 'hard_bounce', 'sequence_enrolled',
  'sequence_state_changed', 'campaign_created', 'campaign_member_status_changed',
  'manual_test',
])
const RuleActionType = z.enum([
  'update_lead_status', 'set_next_recommended_action', 'create_reminder',
  'suppress_lead', 'log_event', 'enroll_sequence',
])
const SavedViewScope = z.enum(['outbound_leads'])
const BulkActionType = z.enum(['set_status', 'suppress', 'unsuppress', 'rescore'])

// --- Schemas ---

const ImportCsvSchema = z.object({
  sourceType: SourceType.default('csv'),
  sourceReference: z.string().trim().max(500).optional().nullable(),
  sourceConfidence: z.coerce.number().int().min(0).max(100).default(80),
})

const LeadFiltersSchema = z.object({
  status: OutboundLeadStatus.optional(),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  search: z.string().trim().max(200).optional(),
  objectType: MultifamilyObjectType.optional(),
  objectId: z.string().regex(uuidRegex).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().trim().optional(),
})

const CreateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(300),
  channels: z.array(CampaignChannel).min(1),
  audienceFilter: z.record(z.any()).optional(),
  leadIds: z.array(z.string().regex(uuidRegex)).optional(),
})

const UpdateCampaignStatusSchema = z.object({
  status: CampaignStatus,
})

const CreateDraftSchema = z.object({
  leadId: z.string().regex(uuidRegex),
  channel: DraftChannel,
})

const EnrollSequenceSchema = z.object({
  leadId: z.string().regex(uuidRegex),
})

const ChangeSequenceStateSchema = z.object({
  state: SequenceEnrollmentState,
  reason: z.string().trim().max(500).optional(),
})

const BulkActionSchema = z.object({
  leadIds: z.array(z.string().regex(uuidRegex)).min(1),
  actionType: BulkActionType,
  payload: z.record(z.any()),
})

const BulkSequenceEnrollSchema = z.object({
  leadIds: z.array(z.string().regex(uuidRegex)).min(1),
  sequenceId: z.string().regex(uuidRegex),
})

const SuppressionSchema = z.object({
  suppressed: z.boolean(),
  reason: z.string().trim().max(500).optional().nullable(),
})

const CreateWorkflowRuleSchema = z.object({
  name: z.string().trim().min(1).max(300),
  triggerEvent: RuleTriggerEvent,
  conditions: z.record(z.any()),
  trueActions: z.array(z.record(z.any())).min(1),
  falseActions: z.array(z.record(z.any())).default([]),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(100),
})

const CreateMultifamilyObjectSchema = z.object({
  objectType: MultifamilyObjectType,
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).optional(),
  metadata: z.record(z.any()).default({}),
})

const AssociateToObjectSchema = z.object({
  entityType: MultifamilyEntityType,
  entityId: z.string().regex(uuidRegex).optional(),
  companyName: z.string().trim().max(300).optional(),
  metadata: z.record(z.any()).default({}),
})

const SaveGoalsSchema = z.object({
  periodType: ForecastPeriodType,
  targetMeetings: z.coerce.number().int().min(0),
  targetOpportunities: z.coerce.number().int().min(0),
  targetRevenue: z.coerce.number().int().min(0),
  notes: z.string().trim().max(2000).optional(),
})

const WorkspaceConfigSchema = z.object({
  senderName: z.string().trim().max(200).optional(),
  emailSignature: z.string().trim().max(2000).optional(),
  dailyEmailLimit: z.coerce.number().int().min(1).max(1000).optional(),
  dailyLinkedinLimit: z.coerce.number().int().min(1).max(1000).optional(),
  slaDraftStaleHours: z.coerce.number().int().min(1).optional(),
  slaLinkedinOverdueHours: z.coerce.number().int().min(1).optional(),
  slaPausedStaleDays: z.coerce.number().int().min(1).optional(),
  slaHighScoreNotContactedDays: z.coerce.number().int().min(1).optional(),
})

module.exports = {
  SourceType,
  OutboundLeadStatus,
  CampaignStatus,
  CampaignChannel,
  CampaignMemberStatus,
  SequenceEnrollmentState,
  DraftStatus,
  DraftChannel,
  LinkedInTaskStatus,
  DataQualityStatus,
  DataQualityIssueType,
  MultifamilyObjectType,
  MultifamilyEntityType,
  ForecastPeriodType,
  RuleTriggerEvent,
  RuleActionType,
  SavedViewScope,
  BulkActionType,

  ImportCsvSchema,
  LeadFiltersSchema,
  CreateCampaignSchema,
  UpdateCampaignStatusSchema,
  CreateDraftSchema,
  EnrollSequenceSchema,
  ChangeSequenceStateSchema,
  BulkActionSchema,
  BulkSequenceEnrollSchema,
  SuppressionSchema,
  CreateWorkflowRuleSchema,
  CreateMultifamilyObjectSchema,
  AssociateToObjectSchema,
  SaveGoalsSchema,
  WorkspaceConfigSchema,
}
