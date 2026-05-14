import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  toInt,
  formatCurrency,
  renderStatusBadge,
  downloadBlobFile,
  MULTIFAMILY_OBJECT_TYPES,
} from '../features/outbound/utils/formatting.jsx'
import LeadTable from '../features/outbound/components/LeadTable'
import DraftInbox from '../features/outbound/components/DraftInbox'
import ForecastPanel from '../features/outbound/components/ForecastPanel'
import DataQualityPanel from '../features/outbound/components/DataQualityPanel'
import CampaignManager from '../features/outbound/components/CampaignManager'
import SequenceManager from '../features/outbound/components/SequenceManager'
import WorkflowRuleBuilder from '../features/outbound/components/WorkflowRuleBuilder'
import MultifamilyExplorer from '../features/outbound/components/MultifamilyExplorer'
import {
  useOutboundAnalytics,
  useOutboundLeads,
  useDraftInbox,
  useLinkedinTaskBoard,
  useSavedViews,
  useSlaAlerts,
  useCampaigns,
  useSequences,
  useSequenceEnrollments,
  useWorkflowRules,
  useForecastSummary,
  useAttributionSummary,
  useDataQualityIssues,
  useDataQualityMergeOperations,
  useMultifamilyObjects,
  useMultifamilySummary,
  useMultifamilyEntities,
  useObjectAssociations,
  useWorkspaceConfig,
  useEscalationRules,
  useNotifications,
  useRescoreLead,
  useBulkAction,
  useSuppressLead,
  useImportCsv,
  useGenerateDraft,
  useApproveDraft,
  useSendDraft,
  useCompleteLinkedinTask,
  useRebalanceLinkedinTasks,
  useCreateSavedView,
  useDeleteSavedView,
  useCreateEscalation,
  useToggleEscalation,
  useRunEscalations,
  useCreateCampaign,
  useUpdateCampaignStatus,
  useEnrollInSequence,
  useChangeSequenceState,
  useBulkSequenceEnroll,
  useBulkSequenceUnenroll,
  useCreateWorkflowRule,
  useToggleWorkflowRule,
  useTestWorkflowRule,
  useSaveForecastGoals,
  useUpdateDataQualityIssueStatus,
  useMergeDuplicateIssue,
  useCreateMultifamilyObject,
  useAssociateToObject,
  useBulkAssociateExplorerEntities,
  useBulkMultifamilyTag,
  useSaveWorkspaceConfig,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '../features/outbound/hooks/useOutboundQueries'

const LEAD_STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'queued', label: 'Queued' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'replied', label: 'Replied' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'suppressed', label: 'Suppressed' },
]

const SOURCE_TYPES = ['csv', 'manual', 'api', 'other']
const MULTIFAMILY_EXPLORER_ENTITY_TYPES = [
  { value: 'contact', label: 'Contacts' },
  { value: 'deal', label: 'Deals' },
  { value: 'company', label: 'Companies' },
]
const WORKFLOW_TRIGGER_EVENTS = [
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
]
const WORKFLOW_ACTION_TYPES = [
  { value: 'update_lead_status', label: 'Update Lead Status' },
  { value: 'set_next_recommended_action', label: 'Set Next Action' },
  { value: 'create_reminder', label: 'Create Reminder' },
  { value: 'suppress_lead', label: 'Suppress Lead' },
  { value: 'log_event', label: 'Log Event' },
  { value: 'enroll_sequence', label: 'Enroll Sequence' },
]
const CONDITION_OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'gte', label: 'Greater Than or Equal' },
  { value: 'lt', label: 'Less Than' },
  { value: 'lte', label: 'Less Than or Equal' },
  { value: 'contains', label: 'Contains' },
]

const OUTBOUND_WORKSPACES = [
  { id: 'overview', label: 'Overview' },
  { id: 'leads', label: 'Leads' },
  { id: 'execution', label: 'Execution' },
  { id: 'data', label: 'Data & Quality' },
  { id: 'admin', label: 'Admin' },
  { id: 'all', label: 'Show All' },
]

const OUTBOUND_BASE_SEGMENT = 'outbound-automation'
const WORKSPACE_IDS = new Set(OUTBOUND_WORKSPACES.map((workspace) => workspace.id))

function getWorkspaceSegment(pathname) {
  const segments = String(pathname || '')
    .split('/')
    .filter(Boolean)
  const outboundIndex = segments.indexOf(OUTBOUND_BASE_SEGMENT)
  if (outboundIndex < 0) return null
  return segments[outboundIndex + 1] || null
}

function getWorkspaceFromPath(pathname) {
  const segment = getWorkspaceSegment(pathname)
  if (!segment) return 'overview'
  return WORKSPACE_IDS.has(segment) ? segment : 'overview'
}

export default function OutboundAutomation() {
  const { token } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [csvFile, setCsvFile] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [, setSessionDrafts] = useState([])
  const [savedViewName, setSavedViewName] = useState('')
  const [selectedSavedViewId, setSelectedSavedViewId] = useState('')
  const [ruleTestLeadId, setRuleTestLeadId] = useState('')
  const [ruleTestResultById, setRuleTestResultById] = useState({})
  const [forecastPeriod, setForecastPeriod] = useState('monthly')
  const [dataQualityStatusFilter, setDataQualityStatusFilter] = useState('open')
  const [leadObjectSelection, setLeadObjectSelection] = useState({})
  const [multifamilyExplorer, setMultifamilyExplorer] = useState({
    objectId: '',
    entityType: 'contact',
    search: '',
  })
  const [multifamilyEntitySelection, setMultifamilyEntitySelection] = useState({})
  const [selectedObjectAssociations, setSelectedObjectAssociations] = useState([])
  const [, setLoadingSelectedObjectAssociations] = useState(false)
  const [multifamilyForm, setMultifamilyForm] = useState({
    objectType: 'portfolio',
    name: '',
    description: '',
  })
  const [goalForm, setGoalForm] = useState({
    targetMeetings: 10,
    targetOpportunities: 3,
    targetRevenue: 75000,
    notes: '',
  })
  const [workflowForm, setWorkflowForm] = useState({
    name: '',
    triggerEvent: 'draft_sent',
    conditionField: 'lead.total_score',
    conditionOp: 'gte',
    conditionValue: '70',
    trueActionType: 'update_lead_status',
    trueActionValue: 'qualified',
    falseActionType: '',
    falseActionValue: '',
  })
  const [filters, setFilters] = useState({
    status: '',
    minScore: 0,
    search: '',
    objectType: '',
    objectId: '',
    limit: 100,
  })
  const [selectedLeadMap, setSelectedLeadMap] = useState({})
  const [bulkActionForm, setBulkActionForm] = useState({
    actionType: 'set_status',
    status: 'qualified',
    reason: '',
  })
  const [importConfig, setImportConfig] = useState({
    sourceType: 'csv',
    sourceReference: 'internal-upload',
    sourceConfidence: 80,
  })
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    includeEmail: true,
    includeLinkedIn: true,
  })
  const [workspaceConfigForm, setWorkspaceConfigForm] = useState({
    senderName: '',
    emailSignature: '',
    dailyEmailLimit: 50,
    dailyLinkedinLimit: 20,
    slaDraftStaleHours: 24,
    slaLinkedinOverdueHours: 24,
    slaPausedStaleDays: 3,
    slaHighScoreNotContactedDays: 2,
  })
  const [newEscalationType, setNewEscalationType] = useState('draft_stale')
  const [bulkAdvancedForm, setBulkAdvancedForm] = useState({
    sequenceId: '',
    multifamilyObjectId: '',
    campaignMemberStatus: 'contacted',
  })
  const [selectedSequenceByLead, setSelectedSequenceByLead] = useState({})
  const activeWorkspace = getWorkspaceFromPath(location.pathname)

  // React Query hooks
  const analyticsQuery = useOutboundAnalytics(token)
  const leadsQuery = useOutboundLeads(token, filters)
  const draftInboxQuery = useDraftInbox(token)
  const linkedinTaskBoardQuery = useLinkedinTaskBoard(token)
  const savedViewsQuery = useSavedViews(token)
  const slaAlertsQuery = useSlaAlerts(token)
  const campaignsQuery = useCampaigns(token)
  const sequencesQuery = useSequences(token)
  const sequenceEnrollmentsQuery = useSequenceEnrollments(token)
  const workflowRulesQuery = useWorkflowRules(token)
  const forecastQuery = useForecastSummary(token, forecastPeriod)
  const attributionQuery = useAttributionSummary(token, forecastPeriod)
  const dataQualityQuery = useDataQualityIssues(token, dataQualityStatusFilter)
  const mergeOpsQuery = useDataQualityMergeOperations(token)
  const mfObjectsQuery = useMultifamilyObjects(token)
  const mfSummaryQuery = useMultifamilySummary(token)
  const mfEntitiesQuery = useMultifamilyEntities(token, multifamilyExplorer.entityType, multifamilyExplorer.search)
  const objectAssociationsQuery = useObjectAssociations(token, multifamilyExplorer.objectId, multifamilyExplorer.entityType)
  const workspaceConfigQuery = useWorkspaceConfig(token)
  const escalationRulesQuery = useEscalationRules(token)
  const notificationsQuery = useNotifications(token)

  // Derived state from queries
  const analytics = analyticsQuery.data ?? null
  const leads = leadsQuery.data?.pages?.flatMap((page) => page.leads) ?? []
  const hasMoreLeads = Boolean(leadsQuery.hasNextPage)
  const fetchNextLeads = leadsQuery.fetchNextPage
  const loadingLeads = leadsQuery.isLoading
  const loadingAnalytics = analyticsQuery.isLoading
  const draftInbox = draftInboxQuery.data?.drafts ?? []
  const draftInboxSummary = draftInboxQuery.data?.summary ?? null
  const loadingDraftInbox = draftInboxQuery.isLoading
  const linkedinTaskBoard = linkedinTaskBoardQuery.data ?? null
  const loadingLinkedinTaskBoard = linkedinTaskBoardQuery.isLoading
  const savedViews = savedViewsQuery.data ?? []
  const loadingSavedViews = savedViewsQuery.isLoading
  const slaAlerts = slaAlertsQuery.data?.alerts ?? []
  const slaSummary = slaAlertsQuery.data?.summary ?? null
  const loadingSlaAlerts = slaAlertsQuery.isLoading
  const campaigns = campaignsQuery.data ?? []
  const loadingCampaigns = campaignsQuery.isLoading
  const sequences = sequencesQuery.data ?? []
  const loadingSequences = sequencesQuery.isLoading
  const sequenceEnrollments = sequenceEnrollmentsQuery.data ?? []
  const loadingSequenceEnrollments = sequenceEnrollmentsQuery.isLoading
  const workflowRules = workflowRulesQuery.data ?? []
  const loadingWorkflowRules = workflowRulesQuery.isLoading
  const forecastSummary = forecastQuery.data ?? null
  const loadingForecast = forecastQuery.isLoading
  const attributionSummary = attributionQuery.data ?? null
  const loadingAttribution = attributionQuery.isLoading
  const dataQualityIssues = dataQualityQuery.data?.issues ?? []
  const dataQualitySummary = dataQualityQuery.data?.summary ?? null
  const loadingDataQuality = dataQualityQuery.isLoading
  const dataQualityMergeOperations = mergeOpsQuery.data ?? []
  const loadingDataQualityMergeOperations = mergeOpsQuery.isLoading
  const multifamilyObjects = mfObjectsQuery.data ?? []
  const loadingMultifamily = mfObjectsQuery.isLoading
  const multifamilySummary = mfSummaryQuery.data ?? null
  const multifamilyEntities = mfEntitiesQuery.data ?? []
  const loadingMultifamilyEntities = mfEntitiesQuery.isLoading
  const workspaceConfig = workspaceConfigQuery.data ?? null
  const loadingWorkspaceConfig = workspaceConfigQuery.isLoading
  const escalationRules = escalationRulesQuery.data ?? []
  const loadingEscalations = escalationRulesQuery.isLoading
  const notifications = notificationsQuery.data?.notifications ?? []
  const notificationUnreadCount = toInt(notificationsQuery.data?.unreadCount)
  const loadingNotifications = notificationsQuery.isLoading

  // Derived stat aliases
  const slaCounts = slaSummary ?? {}
  const leadsStats = analytics?.leads ?? {}
  const campaignStats = analytics?.campaigns ?? {}
  const emailLimit = analytics?.dailySendLimits?.email ?? null
  const linkedinLimit = analytics?.dailySendLimits?.linkedin ?? null
  const linkedinWorkload = linkedinTaskBoard?.workload ?? {}
  const linkedinApprovedTasks = linkedinTaskBoard?.board?.approved ?? []
  const linkedinDraftedTasks = linkedinTaskBoard?.board?.drafted ?? []
  const linkedinPendingTasks = linkedinTaskBoard?.board?.pending ?? []
  const linkedinCompletedTasks = linkedinTaskBoard?.board?.completed ?? []
  const filterScopedObjects = filters.objectType
    ? multifamilyObjects.filter((o) => o.object_type === filters.objectType)
    : multifamilyObjects
  const allVisibleLeadsSelected =
    leads.length > 0 && leads.every((l) => selectedLeadMap[l.id])
  const openEnrollmentByLead = sequenceEnrollments.reduce((acc, e) => {
    if (e.status === 'active' || e.status === 'paused') acc[e.lead_id] = e
    return acc
  }, {})
  const multifamilyObjectsByType = multifamilyObjects.reduce((acc, o) => {
    if (!acc[o.object_type]) acc[o.object_type] = []
    acc[o.object_type].push(o)
    return acc
  }, {})

  // Effects for derived local state
  useEffect(() => {
    if (workspaceConfigQuery.data) {
      const data = workspaceConfigQuery.data
      setWorkspaceConfigForm({
        senderName: data.senderName || '',
        emailSignature: data.emailSignature || '',
        dailyEmailLimit: data.dailyEmailLimit ?? 50,
        dailyLinkedinLimit: data.dailyLinkedinLimit ?? 20,
        slaDraftStaleHours: data.slaDraftStaleHours ?? 24,
        slaLinkedinOverdueHours: data.slaLinkedinOverdueHours ?? 24,
        slaPausedStaleDays: data.slaPausedStaleDays ?? 3,
        slaHighScoreNotContactedDays: data.slaHighScoreNotContactedDays ?? 2,
      })
    }
  }, [workspaceConfigQuery.data])

  useEffect(() => {
    if (forecastQuery.data?.goals) {
      const g = forecastQuery.data.goals
      setGoalForm((prev) => ({
        ...prev,
        targetMeetings: toInt(g.targetMeetings, prev.targetMeetings),
        targetOpportunities: toInt(g.targetOpportunities, prev.targetOpportunities),
        targetRevenue: toInt(g.targetRevenue, prev.targetRevenue),
        notes: g.notes || '',
      }))
    }
  }, [forecastQuery.data])

  useEffect(() => {
    setSelectedLeadMap((prev) => {
      const next = {}
      for (const lead of leads) {
        if (prev[lead.id]) next[lead.id] = true
      }
      return next
    })
  }, [leads])

  useEffect(() => {
    const hasSelected = multifamilyObjects.some((o) => o.id === multifamilyExplorer.objectId)
    if ((!multifamilyExplorer.objectId || !hasSelected) && multifamilyObjects.length > 0) {
      setMultifamilyExplorer((prev) => ({ ...prev, objectId: multifamilyObjects[0].id }))
    }
  }, [multifamilyExplorer.objectId, multifamilyObjects])

  useEffect(() => {
    setMultifamilyEntitySelection({})
  }, [multifamilyExplorer.entityType, multifamilyExplorer.objectId])

  useEffect(() => {
    if (!ruleTestLeadId && leads.length > 0) {
      setRuleTestLeadId(leads[0].id)
    }
  }, [leads, ruleTestLeadId])

  useEffect(() => {
    const saved = savedViewsQuery.data ?? []
    if (!selectedSavedViewId && saved.length > 0) {
      const defaultView = saved.find((v) => v.isDefault) || saved[0]
      if (defaultView) setSelectedSavedViewId(defaultView.id)
    }
  }, [savedViewsQuery.data, selectedSavedViewId])

  useEffect(() => {
    if (objectAssociationsQuery.data) {
      setSelectedObjectAssociations(objectAssociationsQuery.data.associations ?? [])
    }
  }, [objectAssociationsQuery.data])

  useEffect(() => {
    const segment = getWorkspaceSegment(location.pathname)
    if (segment && !WORKSPACE_IDS.has(segment)) {
      navigate('/outbound-automation', { replace: true })
    }
  }, [location.pathname, navigate])

  // Mutations
  const rescoreLead = useRescoreLead(token)
  const bulkAction = useBulkAction(token)
  const suppressLead = useSuppressLead(token)
  const importCsv = useImportCsv(token)
  const generateDraft = useGenerateDraft(token)
  const approveDraft = useApproveDraft(token)
  const sendDraft = useSendDraft(token)
  const completeLinkedinTask = useCompleteLinkedinTask(token)
  const rebalanceLinkedinTasks = useRebalanceLinkedinTasks(token)
  const createSavedView = useCreateSavedView(token)
  const deleteSavedView = useDeleteSavedView(token)
  const createEscalation = useCreateEscalation(token)
  const toggleEscalation = useToggleEscalation(token)
  const runEscalations = useRunEscalations(token)
  const createCampaign = useCreateCampaign(token)
  const updateCampaignStatus = useUpdateCampaignStatus(token)
  const enrollInSequence = useEnrollInSequence(token)
  const changeSequenceState = useChangeSequenceState(token)
  const bulkSequenceEnroll = useBulkSequenceEnroll(token)
  const bulkSequenceUnenroll = useBulkSequenceUnenroll(token)
  const createWorkflowRule = useCreateWorkflowRule(token)
  const toggleWorkflowRule = useToggleWorkflowRule(token)
  const testWorkflowRule = useTestWorkflowRule(token)
  const saveForecastGoals = useSaveForecastGoals(token)
  const updateDataQualityIssueStatus = useUpdateDataQualityIssueStatus(token)
  const mergeDuplicateIssue = useMergeDuplicateIssue(token)
  const createMultifamilyObject = useCreateMultifamilyObject(token)
  const associateToObject = useAssociateToObject(token)
  const bulkAssociateExplorerEntities = useBulkAssociateExplorerEntities(token)
  const bulkMultifamilyTag = useBulkMultifamilyTag(token)
  const saveWorkspaceConfig = useSaveWorkspaceConfig(token)
  const markNotificationRead = useMarkNotificationRead(token)
  const markAllNotificationsRead = useMarkAllNotificationsRead(token)

  const qc = useQueryClient()
  const refreshLeads = () => qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
  const refreshDraftInbox = () => qc.invalidateQueries({ queryKey: ['outbound', 'draftInbox'] })
  const refreshLinkedinTaskBoard = () => qc.invalidateQueries({ queryKey: ['outbound', 'linkedinTaskBoard'] })
  const refreshSavedViews = () => qc.invalidateQueries({ queryKey: ['outbound', 'savedViews'] })
  const refreshSlaAlerts = () => qc.invalidateQueries({ queryKey: ['outbound', 'slaAlerts'] })
  const refreshAnalytics = () => qc.invalidateQueries({ queryKey: ['outbound', 'analytics'] })
  const refreshCampaigns = () => qc.invalidateQueries({ queryKey: ['outbound', 'campaigns'] })
  const refreshSequences = () => qc.invalidateQueries({ queryKey: ['outbound', 'sequences'] })
  const refreshSequenceEnrollments = () => qc.invalidateQueries({ queryKey: ['outbound', 'sequenceEnrollments'] })
  const refreshWorkflowRules = () => qc.invalidateQueries({ queryKey: ['outbound', 'workflowRules'] })
  const refreshForecastSummary = () => qc.invalidateQueries({ queryKey: ['outbound', 'forecast'] })
  const refreshAttributionSummary = () => qc.invalidateQueries({ queryKey: ['outbound', 'attribution'] })
  const refreshDataQualityIssues = () => qc.invalidateQueries({ queryKey: ['outbound', 'dataQualityIssues'] })
  const refreshDataQualityMergeOperations = () => qc.invalidateQueries({ queryKey: ['outbound', 'dataQualityMergeOps'] })
  const refreshMultifamilyObjects = () => qc.invalidateQueries({ queryKey: ['outbound', 'multifamilyObjects'] })
  const refreshMultifamilyEntities = () => qc.invalidateQueries({ queryKey: ['outbound', 'multifamilyEntities'] })
  const refreshNotifications = () => qc.invalidateQueries({ queryKey: ['outbound', 'notifications'] })

  const fetchSelectedObjectAssociations = async () => {
    setLoadingSelectedObjectAssociations(true)
    try {
      const result = await objectAssociationsQuery.refetch()
      setSelectedObjectAssociations(result.data?.associations ?? [])
    } finally {
      setLoadingSelectedObjectAssociations(false)
    }
  }

  const runAction = async (key, fn) => {
    setBusyKey(key)
    setError('')
    setMessage('')
    try {
      await fn()
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || err.message || 'Action failed.')
    } finally {
      setBusyKey('')
    }
  }

  const handleImportCsv = async (event) => {
    event.preventDefault()
    if (!csvFile) {
      setError('Select a CSV file first.')
      return
    }

    await runAction('import', async () => {
      const { data } = await importCsv.mutateAsync({ file: csvFile, importConfig })
      setImportResult(data)
      setMessage(`Import complete: ${data.importedRows} imported, ${data.duplicateRows} duplicate, ${data.failedRows} failed.`)
    })
  }

  const handleRescoreLead = async (leadId) => {
    await runAction(`score-${leadId}`, async () => {
      await rescoreLead.mutateAsync(leadId)
      setMessage('Lead rescored.')
    })
  }

  const handleGenerateDraft = async (lead, channel) => {
    await runAction(`draft-${channel}-${lead.id}`, async () => {
      const { data } = await generateDraft.mutateAsync({ leadId: lead.id, channel })
      const nextDraft = {
        id: data.id,
        leadId: lead.id,
        leadName: lead.name,
        channel: data.channel,
        status: data.status,
        subject: data.subject,
        body: data.body,
        linkedinTaskId: data.linkedinTaskId,
        linkedinTaskStatus: data.linkedinTaskStatus,
      }
      setSessionDrafts((prev) => [nextDraft, ...prev.filter((item) => item.id !== nextDraft.id)])
      setMessage(`${channel === 'email' ? 'Email' : 'LinkedIn'} draft generated.`)
    })
  }

  const handleApproveDraft = async (draftId) => {
    await runAction(`approve-${draftId}`, async () => {
      await approveDraft.mutateAsync(draftId)
      setMessage('Draft approved.')
    })
  }

  const handleCompleteLinkedInTask = async (draftOrTask) => {
    const taskId = draftOrTask.linkedinTaskId || draftOrTask.id
    if (!taskId) {
      setError('No LinkedIn task id is available for this draft.')
      return
    }
    await runAction(`complete-task-${taskId}`, async () => {
      await completeLinkedinTask.mutateAsync({ taskId, notes: 'Completed from outbound automation page.' })
      setMessage('LinkedIn task marked complete.')
    })
  }

  const handleSendEmailDraft = async (draft) => {
    await runAction(`send-email-${draft.id}`, async () => {
      await sendDraft.mutateAsync(draft.id)
      setMessage('Email draft marked as sent.')
    })
  }

  const handleRebalanceLinkedinTasks = async () => {
    await runAction('linkedin-rebalance', async () => {
      const { data } = await rebalanceLinkedinTasks.mutateAsync()
      setMessage(`LinkedIn queue rebalanced: ${toInt(data?.rebalancedCount)} tasks across ${toInt(data?.windowDays, 1)} day(s).`)
    })
  }

  const handleApplySavedView = async (viewId) => {
    const view = savedViews.find((item) => item.id === viewId)
    if (!view) {
      setError('Saved view not found.')
      return
    }
    const viewFilters = view.filters || {}
    const nextFilters = {
      status: viewFilters.status || '',
      minScore: toInt(viewFilters.minScore, 0),
      search: viewFilters.search || '',
      objectType: viewFilters.objectType || '',
      objectId: viewFilters.objectId || '',
      limit: toInt(viewFilters.limit, 100),
    }
    setSelectedSavedViewId(view.id)
    setFilters(nextFilters)
    setMessage(`Applied saved view: ${view.name}`)
  }

  const handleSaveCurrentView = async () => {
    const name = String(savedViewName || '').trim()
    if (!name) {
      setError('Saved view name is required.')
      return
    }
    await runAction('saved-view-create', async () => {
      await createSavedView.mutateAsync({
        scope: 'outbound_leads',
        name,
        filters,
        isDefault: false,
      })
      setSavedViewName('')
      setMessage('Saved outbound view created.')
    })
  }

  const handleDeleteSavedView = async (viewId) => {
    await runAction(`saved-view-delete-${viewId}`, async () => {
      await deleteSavedView.mutateAsync(viewId)
      if (selectedSavedViewId === viewId) {
        setSelectedSavedViewId('')
      }
      setMessage('Saved view deleted.')
    })
  }

  const handleToggleLeadSelected = (leadId, checked) => {
    setSelectedLeadMap((prev) => ({ ...prev, [leadId]: Boolean(checked) }))
  }

  const handleToggleSelectAllVisibleLeads = (checked) => {
    setSelectedLeadMap((prev) => {
      const next = { ...prev }
      for (const lead of leads) {
        next[lead.id] = Boolean(checked)
      }
      return next
    })
  }

  const selectedLeadIds = Object.keys(selectedLeadMap).filter((id) => selectedLeadMap[id])
  const showWorkspace = (workspaceId) => activeWorkspace === 'all' || activeWorkspace === workspaceId

  const handleWorkspaceChange = (workspaceId) => {
    if (workspaceId === 'overview') {
      navigate('/outbound-automation')
      return
    }
    navigate(`/outbound-automation/${workspaceId}`)
  }

  const handleRunBulkAction = async () => {
    if (!selectedLeadIds.length) {
      setError('Select at least one lead before running a bulk action.')
      return
    }
    const actionType = bulkActionForm.actionType
    const payload = {}
    if (actionType === 'set_status') {
      payload.status = bulkActionForm.status
    }
    if (actionType === 'suppress') {
      const reason = String(bulkActionForm.reason || '').trim()
      if (!reason) {
        setError('Suppression reason is required for bulk suppress action.')
        return
      }
      payload.reason = reason
    }
    await runAction(`bulk-action-${actionType}`, async () => {
      await bulkAction.mutateAsync({ leadIds: selectedLeadIds, actionType, payload })
      setMessage(`Bulk action "${actionType}" updated leads.`)
      setSelectedLeadMap({})
    })
  }

  const handleSaveWorkspaceConfig = async () => {
    await runAction('save-workspace-config', async () => {
      await saveWorkspaceConfig.mutateAsync(workspaceConfigForm)
      setMessage('Workspace configuration saved.')
    })
  }

  const handleCreateEscalation = async () => {
    await runAction('create-escalation', async () => {
      await createEscalation.mutateAsync(newEscalationType)
      setMessage(`Escalation rule for "${newEscalationType}" created.`)
    })
  }

  const handleToggleEscalation = async (rule) => {
    await runAction(`toggle-escalation-${rule.id}`, async () => {
      await toggleEscalation.mutateAsync({ ruleId: rule.id, isEnabled: !rule.isEnabled })
    })
  }

  const handleRunEscalations = async () => {
    await runAction('run-escalations', async () => {
      const { data } = await runEscalations.mutateAsync()
      setMessage(`Escalations run: ${toInt(data?.triggeredCount)} rule(s) triggered.`)
    })
  }

  const handleMarkNotificationRead = async (notifId) => {
    await runAction(`mark-read-${notifId}`, async () => {
      await markNotificationRead.mutateAsync(notifId)
    })
  }

  const handleMarkAllNotificationsRead = async () => {
    await runAction('mark-all-read', async () => {
      const { data } = await markAllNotificationsRead.mutateAsync()
      setMessage(`Marked ${toInt(data?.markedRead)} notification(s) as read.`)
    })
  }

  const handleBulkSequenceEnroll = async () => {
    if (!selectedLeadIds.length) {
      setError('Select at least one lead before enrolling.')
      return
    }
    if (!bulkAdvancedForm.sequenceId) {
      setError('Select a sequence to enroll into.')
      return
    }
    await runAction('bulk-seq-enroll', async () => {
      const { data } = await bulkSequenceEnroll.mutateAsync({
        leadIds: selectedLeadIds,
        sequenceId: bulkAdvancedForm.sequenceId,
      })
      setMessage(`Bulk enroll: ${toInt(data?.enrolledCount)} enrolled, ${toInt(data?.skippedCount)} skipped, ${toInt(data?.errorCount)} errors.`)
      setSelectedLeadMap({})
    })
  }

  const handleBulkSequenceUnenroll = async () => {
    if (!selectedLeadIds.length) {
      setError('Select at least one lead before unenrolling.')
      return
    }
    await runAction('bulk-seq-unenroll', async () => {
      const { data } = await bulkSequenceUnenroll.mutateAsync(selectedLeadIds)
      setMessage(`Bulk unenroll: ${toInt(data?.stoppedCount)} stopped, ${toInt(data?.skippedCount)} skipped.`)
      setSelectedLeadMap({})
    })
  }

  const handleBulkMultifamilyTag = async () => {
    if (!selectedLeadIds.length) {
      setError('Select at least one lead before tagging.')
      return
    }
    if (!bulkAdvancedForm.multifamilyObjectId) {
      setError('Select a multifamily object to tag leads with.')
      return
    }
    await runAction('bulk-mf-tag', async () => {
      const { data } = await bulkMultifamilyTag.mutateAsync({
        leadIds: selectedLeadIds,
        objectId: bulkAdvancedForm.multifamilyObjectId,
      })
      setMessage(`Bulk tag: ${toInt(data?.taggedCount)} lead(s) tagged.`)
      setSelectedLeadMap({})
    })
  }

  const handleCreateCampaign = async (event) => {
    event.preventDefault()
    if (!campaignForm.name.trim()) {
      setError('Campaign name is required.')
      return
    }
    const channels = [
      campaignForm.includeEmail ? 'email' : null,
      campaignForm.includeLinkedIn ? 'linkedin' : null,
    ].filter(Boolean)
    if (channels.length === 0) {
      setError('Select at least one campaign channel.')
      return
    }
    await runAction('campaign-create', async () => {
      const payload = {
        name: campaignForm.name.trim(),
        channels,
        audienceFilter: {
          status: filters.status || 'all',
          minScore: filters.minScore,
          search: filters.search || '',
          objectType: filters.objectType || null,
          objectId: filters.objectId || null,
        },
        leadIds: leads.map((lead) => lead.id),
      }
      const { data } = await createCampaign.mutateAsync(payload)
      setCampaignForm((prev) => ({ ...prev, name: '' }))
      setMessage(`Campaign created: ${data.name} (${data.addedMembers} members).`)
    })
  }

  const handleCampaignStatus = async (campaignId, status) => {
    await runAction(`campaign-status-${campaignId}-${status}`, async () => {
      await updateCampaignStatus.mutateAsync({ campaignId, status })
      setMessage(`Campaign status updated to ${status}.`)
    })
  }

  const handleEnrollLeadInSequence = async (leadId) => {
    const sequenceId = selectedSequenceByLead[leadId]
    if (!sequenceId) {
      setError('Select a sequence before enrolling.')
      return
    }
    await runAction(`enroll-sequence-${leadId}`, async () => {
      await enrollInSequence.mutateAsync({ sequenceId, leadId })
      setMessage('Lead enrolled in sequence.')
    })
  }

  const handleSequenceStateChange = async (enrollment, state) => {
    await runAction(`sequence-state-${enrollment.id}-${state}`, async () => {
      await changeSequenceState.mutateAsync({
        enrollmentId: enrollment.id,
        state,
        reason: state === 'paused' ? 'Paused from outbound automation UI' : undefined,
      })
      setMessage(`Sequence enrollment ${state}.`)
    })
  }

  const buildRuleAction = (type, value) => {
    const cleanedType = String(type || '').trim()
    const cleanedValue = String(value || '').trim()
    if (!cleanedType) return null
    if (cleanedType === 'update_lead_status') return { type: cleanedType, config: { status: cleanedValue } }
    if (cleanedType === 'set_next_recommended_action') return { type: cleanedType, config: { value: cleanedValue } }
    if (cleanedType === 'create_reminder') return { type: cleanedType, config: { message: cleanedValue, dueDays: 1 } }
    if (cleanedType === 'suppress_lead') {
      return { type: cleanedType, config: { reason: cleanedValue || 'Suppressed by workflow rule' } }
    }
    if (cleanedType === 'log_event') return { type: cleanedType, config: { eventType: cleanedValue || 'workflow_rule_event' } }
    if (cleanedType === 'enroll_sequence') return { type: cleanedType, config: { sequenceId: cleanedValue } }
    return null
  }

  const handleCreateWorkflowRule = async (event) => {
    event.preventDefault()
    if (!workflowForm.name.trim()) {
      setError('Workflow rule name is required.')
      return
    }
    const trueAction = buildRuleAction(workflowForm.trueActionType, workflowForm.trueActionValue)
    if (!trueAction) {
      setError('Primary (true) action is required.')
      return
    }
    const falseAction = buildRuleAction(workflowForm.falseActionType, workflowForm.falseActionValue)
    const rawConditionValue = String(workflowForm.conditionValue || '').trim()
    const parsedConditionValue =
      rawConditionValue !== '' && /^-?\d+(\.\d+)?$/.test(rawConditionValue)
        ? Number(rawConditionValue)
        : rawConditionValue
    const payload = {
      name: workflowForm.name.trim(),
      triggerEvent: workflowForm.triggerEvent,
      conditions: workflowForm.conditionField
        ? {
            operator: 'AND',
            rules: [
              {
                field: workflowForm.conditionField.trim(),
                op: workflowForm.conditionOp,
                value: parsedConditionValue,
              },
            ],
          }
        : {},
      trueActions: [trueAction],
      falseActions: falseAction ? [falseAction] : [],
      enabled: true,
      priority: 100,
    }
    await runAction('workflow-create', async () => {
      await createWorkflowRule.mutateAsync(payload)
      setMessage('Workflow rule created.')
      setWorkflowForm((prev) => ({ ...prev, name: '' }))
    })
  }

  const handleToggleWorkflowRule = async (rule) => {
    await runAction(`workflow-toggle-${rule.id}`, async () => {
      await toggleWorkflowRule.mutateAsync({ ruleId: rule.id, enabled: !rule.enabled })
      setMessage(`Workflow rule ${!rule.enabled ? 'enabled' : 'disabled'}.`)
    })
  }

  const handleTestWorkflowRule = async (rule, applyActions) => {
    await runAction(`workflow-test-${rule.id}-${applyActions ? 'live' : 'dry'}`, async () => {
      const { data } = await testWorkflowRule.mutateAsync({
        ruleId: rule.id,
        leadId: ruleTestLeadId || null,
        applyActions,
      })
      setRuleTestResultById((prev) => ({ ...prev, [rule.id]: data.result }))
      setMessage(applyActions ? `Rule executed (${data.result?.status || 'unknown'}).` : `Rule dry-run completed (${data.result?.status || 'unknown'}).`)
    })
  }

  const handleSaveGoal = async (event) => {
    event.preventDefault()
    await runAction(`goal-save-${forecastPeriod}`, async () => {
      await saveForecastGoals.mutateAsync({
        periodType: forecastPeriod,
        targetMeetings: toInt(goalForm.targetMeetings),
        targetOpportunities: toInt(goalForm.targetOpportunities),
        targetRevenue: toInt(goalForm.targetRevenue),
        notes: goalForm.notes || '',
      })
      setMessage('Forecast goals saved.')
    })
  }

  const handleSuppression = async (lead, suppressed) => {
    await runAction(`suppression-${lead.id}-${suppressed ? 'on' : 'off'}`, async () => {
      const reason = suppressed
        ? window.prompt('Suppression reason (required):', lead.suppression_reason || 'Unsubscribe request') || ''
        : ''
      if (suppressed && !reason.trim()) {
        throw new Error('Suppression reason is required.')
      }
      await suppressLead.mutateAsync({ leadId: lead.id, suppressed, reason: suppressed ? reason.trim() : null })
      setMessage(suppressed ? 'Lead suppressed.' : 'Lead unsuppressed.')
    })
  }

  const handleDataQualityIssueStatus = async (issueId, status) => {
    await runAction(`data-quality-${issueId}-${status}`, async () => {
      await updateDataQualityIssueStatus.mutateAsync({ issueId, status })
      setMessage(`Data quality issue marked as ${status}.`)
    })
  }

  const handleMergeDuplicateIssue = async (issue) => {
    const suggestedPrimaryLeadId = issue?.details?.suggestedPrimaryLeadId || issue?.leadId || null
    const candidateLeadIds = Array.isArray(issue?.details?.candidateLeadIds)
      ? issue.details.candidateLeadIds.filter((leadId) => leadId && leadId !== suggestedPrimaryLeadId)
      : []
    if (!suggestedPrimaryLeadId || candidateLeadIds.length === 0) {
      setError('Duplicate issue does not contain merge candidates yet. Refresh the queue and try again.')
      return
    }
    await runAction(`data-quality-merge-${issue.id}`, async () => {
      const { data } = await mergeDuplicateIssue.mutateAsync({
        issueId: issue.id,
        primaryLeadId: suggestedPrimaryLeadId,
        duplicateLeadIds: candidateLeadIds,
      })
      setMessage(`Merged ${toInt(data?.mergeOperation?.mergedLeadCount)} duplicate lead(s) into ${data?.primaryLead?.name || 'primary lead'}.`)
    })
  }

  const handleCreateMultifamilyObject = async (event) => {
    event.preventDefault()
    const name = String(multifamilyForm.name || '').trim()
    if (!name) {
      setError('Multifamily object name is required.')
      return
    }
    await runAction(`multifamily-create-${multifamilyForm.objectType}`, async () => {
      await createMultifamilyObject.mutateAsync({
        objectType: multifamilyForm.objectType,
        name,
        description: multifamilyForm.description || '',
        metadata: {},
      })
      setMultifamilyForm((prev) => ({ ...prev, name: '', description: '' }))
      setMessage('Multifamily object created.')
    })
  }

  const handleAssociateObjectToLead = async (leadId) => {
    const selection = leadObjectSelection[leadId] || {}
    if (!selection.objectType || !selection.objectId) {
      setError('Select object type and object before associating.')
      return
    }
    await runAction(`multifamily-associate-${leadId}`, async () => {
      await associateToObject.mutateAsync({
        objectId: selection.objectId,
        payload: { entityType: 'outbound_lead', entityId: leadId, metadata: { source: 'outbound_ui' } },
      })
      setMessage('Lead associated to multifamily object.')
    })
  }

  const handleToggleMultifamilyEntitySelection = (entityKey, checked) => {
    setMultifamilyEntitySelection((prev) => ({ ...prev, [entityKey]: Boolean(checked) }))
  }

  const handleBulkAssociateExplorerEntities = async () => {
    if (!multifamilyExplorer.objectId) {
      setError('Select a multifamily object first.')
      return
    }
    const selectedKeys = Object.keys(multifamilyEntitySelection).filter((k) => multifamilyEntitySelection[k])
    if (!selectedKeys.length) {
      setError('Select at least one entity to associate.')
      return
    }
    await runAction('bulk-mf-associate', async () => {
      await bulkAssociateExplorerEntities.mutateAsync({
        objectId: multifamilyExplorer.objectId,
        payload: {
          entityType: multifamilyExplorer.entityType,
          entityIds: selectedKeys,
          metadata: { source: 'outbound_ui' },
        },
      })
      setMessage(`Associated ${selectedKeys.length} entities.`)
      setMultifamilyEntitySelection({})
    })
  }

  const handleExport = async (type) => {
    // Keep axios import for blob exports until api layer supports it fully
    const axios = (await import('axios')).default
    await runAction(`export-${type}`, async () => {
      const endpoint =
        type === 'events'
          ? '/api/outbound/events/export?format=csv&days=30&limit=5000'
          : '/api/outbound/audit/export?format=csv&days=30&limit=5000'
      const response = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      })
      const filename = type === 'events' ? 'outbound-events.csv' : 'outbound-audit.csv'
      downloadBlobFile(response.data, filename)
      setMessage(`${type === 'events' ? 'Event' : 'Audit'} export downloaded.`)
    })
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-syne text-2xl font-bold text-navy">Outbound Automation</h2>
          <p className="text-xs text-brand-gray mt-0.5">
            Internal workflow for CSV import, lead scoring, drafting, and manual LinkedIn completion.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('events')}
            disabled={busyKey === 'export-events'}
            className="text-sm border border-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-60"
          >
            Export Events
          </button>
          <button
            onClick={() => handleExport('audit')}
            disabled={busyKey === 'export-audit'}
            className="text-sm border border-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-60"
          >
            Export Audit
          </button>
          <button
            onClick={() => {
              refreshLeads()
              refreshDraftInbox()
              refreshLinkedinTaskBoard()
              refreshSavedViews()
              refreshSlaAlerts()
              refreshAnalytics()
              refreshCampaigns()
              refreshSequences()
              refreshSequenceEnrollments()
              refreshWorkflowRules()
              refreshForecastSummary()
              refreshAttributionSummary()
              refreshDataQualityIssues()
              refreshDataQualityMergeOperations()
              refreshMultifamilyObjects()
              refreshMultifamilyEntities()
              objectAssociationsQuery.refetch()
            }}
            className="text-sm bg-teal text-white px-4 py-2 rounded-lg hover:bg-teal/90 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {(message || error) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}
        >
          {error || message}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-navy">Workspace View</h3>
            <p className="text-xs text-brand-gray mt-0.5">Focus on one outbound workflow at a time.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {OUTBOUND_WORKSPACES.map((workspace) => (
              <button
                key={workspace.id}
                onClick={() => handleWorkspaceChange(workspace.id)}
                className={`text-xs rounded-lg px-3 py-1.5 border transition-colors ${
                  activeWorkspace === workspace.id
                    ? 'border-navy bg-navy text-white'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {workspace.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showWorkspace('overview') && (
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">Saved Views</h3>
            <p className="text-xs text-brand-gray mt-0.5">Save and reapply outbound filters instantly.</p>
          </div>
          <button
            onClick={refreshSavedViews}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50"
          >
            {loadingSavedViews ? 'Refreshing...' : 'Refresh Views'}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select
            value={selectedSavedViewId}
            onChange={(event) => setSelectedSavedViewId(event.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Select saved view</option>
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
                {view.isDefault ? ' (Default)' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={() => handleApplySavedView(selectedSavedViewId)}
            disabled={!selectedSavedViewId || busyKey === `saved-view-apply-${selectedSavedViewId}`}
            className="border border-teal text-teal rounded-lg px-3 py-2 text-sm font-semibold hover:bg-teal/5 disabled:opacity-60"
          >
            Apply View
          </button>
          <button
            onClick={() => handleDeleteSavedView(selectedSavedViewId)}
            disabled={!selectedSavedViewId || busyKey === `saved-view-delete-${selectedSavedViewId}`}
            className="border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-rose-50 disabled:opacity-60"
          >
            Delete View
          </button>
          <div className="text-xs text-brand-gray flex items-center">Total views: {savedViews.length}</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            type="text"
            value={savedViewName}
            onChange={(event) => setSavedViewName(event.target.value)}
            placeholder="New view name"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleSaveCurrentView}
            disabled={busyKey === 'saved-view-create'}
            className="bg-navy text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-navy/90 disabled:opacity-60"
          >
            {busyKey === 'saved-view-create' ? 'Saving...' : 'Save Current Filters'}
          </button>
        </div>
      </div>
      )}

      {showWorkspace('overview') && (
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">SLA Alerts</h3>
            <p className="text-xs text-brand-gray mt-0.5">Highlights overdue work and at-risk outreach tasks.</p>
          </div>
          <button
            onClick={refreshSlaAlerts}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50"
          >
            {loadingSlaAlerts ? 'Refreshing...' : 'Refresh Alerts'}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Total</p>
            <p className="text-lg font-bold text-navy">{toInt(slaCounts.totalAlerts)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">LinkedIn Overdue</p>
            <p className="text-lg font-bold text-rose-700">{toInt(slaCounts.overdueLinkedIn)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Stale Email Drafts</p>
            <p className="text-lg font-bold text-amber-700">{toInt(slaCounts.staleApprovedEmailDrafts)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Paused Sequences</p>
            <p className="text-lg font-bold text-indigo-700">{toInt(slaCounts.stalePausedEnrollments)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">High Score Not Contacted</p>
            <p className="text-lg font-bold text-navy">{toInt(slaCounts.highScoreNotContacted)}</p>
          </div>
        </div>
        {slaAlerts.length > 0 && (
          <div className="space-y-1">
            {slaAlerts.slice(0, 6).map((alert) => (
              <p key={`${alert.type}-${alert.id}`} className="text-xs text-brand-gray">
                <span className={`font-semibold ${alert.severity === 'high' ? 'text-rose-700' : 'text-amber-700'}`}>
                  {alert.type}
                </span>{' '}
                {alert.lead?.name ? `- ${alert.lead.name}` : ''}{' '}
                {alert.ageHours != null ? `(${toInt(alert.ageHours)}h)` : ''}
              </p>
            ))}
          </div>
        )}
      </div>
      )}

      {showWorkspace('overview') && (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-brand-gray">Total Leads</p>
          <p className="text-2xl font-bold text-navy">{toInt(leadsStats.total_leads)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-brand-gray">Qualified</p>
          <p className="text-2xl font-bold text-navy">{toInt(leadsStats.qualified_count)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-brand-gray">Contacted</p>
          <p className="text-2xl font-bold text-navy">{toInt(leadsStats.contacted_count)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-brand-gray">Pending LinkedIn Tasks</p>
          <p className="text-2xl font-bold text-navy">{toInt(analytics?.pendingLinkedInTasks)}</p>
        </div>
      </div>
      )}

      {showWorkspace('overview') && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-brand-gray">Campaigns</p>
          <p className="text-2xl font-bold text-navy">{toInt(campaignStats.total_campaigns)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-brand-gray">Active Campaigns</p>
          <p className="text-2xl font-bold text-navy">{toInt(campaignStats.active_campaigns)}</p>
        </div>
      </div>
      )}

      {showWorkspace('overview') && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-brand-gray">Daily Email Sends</p>
          <p className="text-lg font-bold text-navy">
            {toInt(emailLimit?.used)} / {toInt(emailLimit?.limit)}
          </p>
          <p className="text-xs text-brand-gray">Remaining: {toInt(emailLimit?.remaining)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-brand-gray">Daily LinkedIn Completions</p>
          <p className="text-lg font-bold text-navy">
            {toInt(linkedinLimit?.used)} / {toInt(linkedinLimit?.limit)}
          </p>
          <p className="text-xs text-brand-gray">Remaining: {toInt(linkedinLimit?.remaining)}</p>
        </div>
      </div>
      )}

      {showWorkspace('execution') && (
      <ForecastPanel
        forecastPeriod={forecastPeriod}
        setForecastPeriod={setForecastPeriod}
        loadingForecast={loadingForecast}
        forecastBuckets={forecastSummary?.buckets ?? {}}
        forecastProgress={forecastSummary?.progress ?? null}
        goalForm={goalForm}
        setGoalForm={setGoalForm}
        busyKey={busyKey}
        handleSaveGoal={handleSaveGoal}
        forecastGoals={forecastSummary?.goals ?? null}
        forecastSummary={forecastSummary}
        forecastGap={forecastSummary?.gapToGoal ?? null}
        loadingAttribution={loadingAttribution}
        attributionSummary={attributionSummary}
        attributionSources={attributionSummary?.sources ?? []}
        attributionOverview={attributionSummary?.overview ?? {}}
        attributionSequences={attributionSummary?.sequences ?? []}
        attributionPersonas={attributionSummary?.personas ?? []}
      />
      )}

      {showWorkspace('data') && (
      <MultifamilyExplorer
        multifamilyObjects={multifamilyObjects}
        multifamilyObjectCounts={multifamilySummary?.objectCounts ?? {}}
        multifamilyAssociationCounts={multifamilySummary?.associationCounts ?? {}}
        multifamilyForm={multifamilyForm}
        setMultifamilyForm={setMultifamilyForm}
        multifamilyExplorer={multifamilyExplorer}
        setMultifamilyExplorer={setMultifamilyExplorer}
        multifamilyEntities={multifamilyEntities}
        multifamilyEntitySelection={multifamilyEntitySelection}
        selectedMultifamilyEntityKeys={Object.keys(multifamilyEntitySelection).filter((k) => multifamilyEntitySelection[k])}
        selectedMultifamilyObject={multifamilyObjects.find((o) => o.id === multifamilyExplorer.objectId) ?? null}
        selectedObjectAssociations={selectedObjectAssociations}
        objectAssociationsQuery={objectAssociationsQuery}
        loadingMultifamily={loadingMultifamily}
        loadingMultifamilyEntities={loadingMultifamilyEntities}
        busyKey={busyKey}
        refreshMultifamilyObjects={refreshMultifamilyObjects}
        refreshMultifamilyEntities={refreshMultifamilyEntities}
        fetchSelectedObjectAssociations={fetchSelectedObjectAssociations}
        handleCreateMultifamilyObject={handleCreateMultifamilyObject}
        handleBulkAssociateExplorerEntities={handleBulkAssociateExplorerEntities}
        handleToggleMultifamilyEntitySelection={handleToggleMultifamilyEntitySelection}
      />
      )}

      {showWorkspace('data') && (
      <DataQualityPanel
        dataQualityIssues={dataQualityIssues}
        dataQualityMergeOperations={dataQualityMergeOperations}
        dataQualityStatusFilter={dataQualityStatusFilter}
        setDataQualityStatusFilter={setDataQualityStatusFilter}
        dataQualityOpenCount={dataQualitySummary?.open_count ?? 0}
        dataQualityOpenBlockingCount={dataQualitySummary?.open_blocking_count ?? 0}
        dataQualityResolvedCount={dataQualitySummary?.resolved_count ?? 0}
        dataQualityMergeCount30d={dataQualitySummary?.merge_count_30d ?? 0}
        loadingDataQuality={loadingDataQuality}
        loadingDataQualityMergeOperations={loadingDataQualityMergeOperations}
        busyKey={busyKey}
        refreshDataQualityIssues={refreshDataQualityIssues}
        refreshDataQualityMergeOperations={refreshDataQualityMergeOperations}
        handleDataQualityIssueStatus={handleDataQualityIssueStatus}
        handleMergeDuplicateIssue={handleMergeDuplicateIssue}
      />
      )}

      {showWorkspace('execution') && (
      <CampaignManager
        campaigns={campaigns}
        campaignForm={campaignForm}
        setCampaignForm={setCampaignForm}
        leads={leads}
        loadingCampaigns={loadingCampaigns}
        busyKey={busyKey}
        handleCreateCampaign={handleCreateCampaign}
        handleCampaignStatus={handleCampaignStatus}
      />
      )}

      {showWorkspace('execution') && (
      <SequenceManager
        sequences={sequences}
        sequenceEnrollments={sequenceEnrollments}
        loadingSequences={loadingSequences}
        loadingSequenceEnrollments={loadingSequenceEnrollments}
        busyKey={busyKey}
        handleSequenceStateChange={handleSequenceStateChange}
      />
      )}

      {showWorkspace('execution') && (
      <WorkflowRuleBuilder
        workflowRules={workflowRules}
        workflowForm={workflowForm}
        setWorkflowForm={setWorkflowForm}
        sequences={sequences}
        leads={leads}
        loadingWorkflowRules={loadingWorkflowRules}
        busyKey={busyKey}
        ruleTestLeadId={ruleTestLeadId}
        setRuleTestLeadId={setRuleTestLeadId}
        ruleTestResultById={ruleTestResultById}
        handleCreateWorkflowRule={handleCreateWorkflowRule}
        handleToggleWorkflowRule={handleToggleWorkflowRule}
        handleTestWorkflowRule={handleTestWorkflowRule}
      />
      )}

      {showWorkspace('leads') && (
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-sm font-semibold text-navy mb-4">Import CSV</h3>
        <form onSubmit={handleImportCsv} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setCsvFile(event.target.files?.[0] || null)}
            className="md:col-span-2 border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />

          <select
            value={importConfig.sourceType}
            onChange={(event) => setImportConfig((prev) => ({ ...prev, sourceType: event.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {SOURCE_TYPES.map((sourceType) => (
              <option key={sourceType} value={sourceType}>
                {sourceType}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={importConfig.sourceReference}
            onChange={(event) => setImportConfig((prev) => ({ ...prev, sourceReference: event.target.value }))}
            placeholder="source reference"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />

          <button
            type="submit"
            disabled={busyKey === 'import'}
            className="bg-teal text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-teal/90 disabled:opacity-60"
          >
            {busyKey === 'import' ? 'Importing...' : 'Import CSV'}
          </button>
        </form>

        {importResult && (
          <div className="mt-4 text-xs text-gray-600">
            Last job {importResult.jobId}: {importResult.importedRows} imported, {importResult.duplicateRows} duplicate,{' '}
            {importResult.failedRows} failed.
          </div>
        )}
      </div>
      )}

      {showWorkspace('leads') && (
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h3 className="text-sm font-semibold text-navy">Leads</h3>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {LEAD_STATUSES.map((statusOption) => (
              <option key={statusOption.value || 'all'} value={statusOption.value}>
                {statusOption.label}
              </option>
            ))}
          </select>

          <input
            type="number"
            min="0"
            max="100"
            value={filters.minScore}
            onChange={(event) => setFilters((prev) => ({ ...prev, minScore: toInt(event.target.value) }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            placeholder="min score"
          />

          <input
            type="text"
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            placeholder="search lead/company/title"
          />

          <select
            value={filters.objectType}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                objectType: event.target.value,
                objectId: '',
              }))
            }
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All object types</option>
            {MULTIFAMILY_OBJECT_TYPES.map((typeOption) => (
              <option key={typeOption.value} value={typeOption.value}>
                {typeOption.label}
              </option>
            ))}
          </select>

          <select
            value={filters.objectId}
            onChange={(event) => setFilters((prev) => ({ ...prev, objectId: event.target.value }))}
            disabled={!filters.objectType}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
          >
            <option value="">{filters.objectType ? 'All objects' : 'Select type first'}</option>
            {filterScopedObjects.map((object) => (
              <option key={object.id} value={object.id}>
                {object.name}
              </option>
            ))}
          </select>

          <button
            onClick={refreshLeads}
            className="border border-teal text-teal rounded-lg px-3 py-2 text-sm font-semibold hover:bg-teal/5"
          >
            Apply Filters
          </button>
        </div>

        <div className="border border-gray-100 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-navy">Bulk Actions</p>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <select
              value={bulkActionForm.actionType}
              onChange={(event) => setBulkActionForm((prev) => ({ ...prev, actionType: event.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="set_status">Set Status</option>
              <option value="suppress">Suppress</option>
              <option value="unsuppress">Unsuppress</option>
              <option value="rescore">Rescore</option>
            </select>
            {bulkActionForm.actionType === 'set_status' && (
              <select
                value={bulkActionForm.status}
                onChange={(event) => setBulkActionForm((prev) => ({ ...prev, status: event.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                {LEAD_STATUSES.filter((status) => status.value).map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            )}
            {bulkActionForm.actionType === 'suppress' && (
              <input
                type="text"
                value={bulkActionForm.reason}
                onChange={(event) => setBulkActionForm((prev) => ({ ...prev, reason: event.target.value }))}
                placeholder="Suppression reason"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            )}
            <button
              onClick={handleRunBulkAction}
              disabled={selectedLeadIds.length === 0 || busyKey === `bulk-action-${bulkActionForm.actionType}`}
              className="bg-navy text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-navy/90 disabled:opacity-60"
            >
              {busyKey === `bulk-action-${bulkActionForm.actionType}` ? 'Running...' : `Run (${selectedLeadIds.length})`}
            </button>
            <p className="text-xs text-brand-gray flex items-center">
              {selectedLeadIds.length} lead(s) selected
            </p>
          </div>

          <div className="border-t border-gray-100 pt-2 space-y-2">
            <p className="text-xs font-semibold text-navy">Advanced Bulk Actions</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <select
                value={bulkAdvancedForm.sequenceId}
                onChange={(e) => setBulkAdvancedForm((prev) => ({ ...prev, sequenceId: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select sequence...</option>
                {sequences.map((seq) => (
                  <option key={seq.id} value={seq.id}>{seq.name}</option>
                ))}
              </select>
              <button
                onClick={handleBulkSequenceEnroll}
                disabled={selectedLeadIds.length === 0 || busyKey === 'bulk-seq-enroll'}
                className="border border-indigo-200 text-indigo-700 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-indigo-50 disabled:opacity-60"
              >
                {busyKey === 'bulk-seq-enroll' ? 'Enrolling...' : `Enroll Sequence (${selectedLeadIds.length})`}
              </button>
              <button
                onClick={handleBulkSequenceUnenroll}
                disabled={selectedLeadIds.length === 0 || busyKey === 'bulk-seq-unenroll'}
                className="border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-rose-50 disabled:opacity-60"
              >
                {busyKey === 'bulk-seq-unenroll' ? 'Unenrolling...' : `Unenroll (${selectedLeadIds.length})`}
              </button>
              <div className="flex gap-2">
                <select
                  value={bulkAdvancedForm.multifamilyObjectId}
                  onChange={(e) => setBulkAdvancedForm((prev) => ({ ...prev, multifamilyObjectId: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1"
                >
                  <option value="">Select object...</option>
                  {multifamilyObjects.map((obj) => (
                    <option key={obj.id} value={obj.id}>{obj.name} ({obj.objectType})</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkMultifamilyTag}
                  disabled={selectedLeadIds.length === 0 || busyKey === 'bulk-mf-tag'}
                  className="border border-teal text-teal rounded-lg px-3 py-2 text-sm font-semibold hover:bg-teal/5 disabled:opacity-60"
                >
                  {busyKey === 'bulk-mf-tag' ? 'Tagging...' : 'Tag'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {loadingLeads || loadingAnalytics ? (
          <div className="text-sm text-brand-gray">Loading outbound data...</div>
        ) : (
          <>
            <LeadTable
              leads={leads}
              selectedLeadMap={selectedLeadMap}
              onToggleLeadSelected={handleToggleLeadSelected}
              onToggleSelectAllVisibleLeads={handleToggleSelectAllVisibleLeads}
              allVisibleLeadsSelected={allVisibleLeadsSelected}
              sequences={sequences}
              openEnrollmentByLead={openEnrollmentByLead}
              selectedSequenceByLead={selectedSequenceByLead}
              onSelectSequenceByLead={(leadId, sequenceId) =>
                setSelectedSequenceByLead((prev) => ({ ...prev, [leadId]: sequenceId }))
              }
              multifamilyObjects={multifamilyObjects}
              multifamilyObjectsByType={multifamilyObjectsByType}
              leadObjectSelection={leadObjectSelection}
              onLeadObjectSelectionChange={(leadId, selection) =>
                setLeadObjectSelection((prev) => ({ ...prev, [leadId]: selection }))
              }
              busyKey={busyKey}
              onRescoreLead={handleRescoreLead}
              onEnrollLeadInSequence={handleEnrollLeadInSequence}
              onAssociateObjectToLead={handleAssociateObjectToLead}
              onGenerateDraft={handleGenerateDraft}
              onSuppression={handleSuppression}
            />
            {hasMoreLeads && (
              <div className="pt-4 text-center">
                <button
                  onClick={() => fetchNextLeads()}
                  disabled={leadsQuery.isFetchingNextPage}
                  className="text-sm border border-gray-200 rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {leadsQuery.isFetchingNextPage ? 'Loading...' : 'Load more leads'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      )}

      {showWorkspace('leads') && (
      <DraftInbox
        draftInbox={draftInbox}
        draftInboxCounts={draftInboxSummary ?? {}}
        loadingDraftInbox={loadingDraftInbox}
        busyKey={busyKey}
        refreshDraftInbox={refreshDraftInbox}
        handleApproveDraft={handleApproveDraft}
        handleSendEmailDraft={handleSendEmailDraft}
        handleCompleteLinkedInTask={handleCompleteLinkedInTask}
      />
      )}

      {showWorkspace('leads') && (
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">LinkedIn Task Board</h3>
            <p className="text-xs text-brand-gray mt-0.5">Workload balancing board for manual LinkedIn execution.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={refreshLinkedinTaskBoard}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              Refresh Board
            </button>
            <button
              onClick={handleRebalanceLinkedinTasks}
              disabled={busyKey === 'linkedin-rebalance'}
              className="text-xs border border-indigo-200 text-indigo-700 rounded-lg px-3 py-1.5 hover:bg-indigo-50 disabled:opacity-60"
            >
              {busyKey === 'linkedin-rebalance' ? 'Rebalancing...' : 'Rebalance Queue'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Open Tasks</p>
            <p className="text-lg font-bold text-navy">{toInt(linkedinWorkload.openCount)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Ready to Send</p>
            <p className="text-lg font-bold text-indigo-700">{toInt(linkedinWorkload.approvedReadyCount)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Overdue</p>
            <p className="text-lg font-bold text-rose-700">{toInt(linkedinWorkload.overdueCount)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Recommended Today</p>
            <p className="text-lg font-bold text-emerald-700">{toInt(linkedinWorkload.recommendedToday)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Days to Clear</p>
            <p className="text-lg font-bold text-navy">{toInt(linkedinWorkload.estimatedDaysToClearOpen)}</p>
          </div>
        </div>

        {loadingLinkedinTaskBoard ? (
          <p className="text-sm text-brand-gray">Loading LinkedIn task board...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="border border-gray-100 rounded-lg p-3">
              <p className="text-xs font-semibold text-navy mb-2">Approved ({linkedinApprovedTasks.length})</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {linkedinApprovedTasks.length === 0 ? (
                  <p className="text-xs text-brand-gray">No approved tasks.</p>
                ) : (
                  linkedinApprovedTasks.slice(0, 20).map((task) => (
                    <div key={task.id} className="rounded border border-gray-100 p-2">
                      <p className="text-xs font-semibold text-navy">{task.lead?.name || 'Unknown lead'}</p>
                      <p className="text-[11px] text-brand-gray">{task.lead?.company || task.lead?.email || 'No context'}</p>
                      <p className="text-[11px] text-brand-gray">Priority {toInt(task.priorityScore)}</p>
                      <button
                        onClick={() => handleCompleteLinkedInTask(task)}
                        disabled={busyKey === `complete-task-${task.id}`}
                        className="mt-1 text-[11px] border border-emerald-200 text-emerald-700 rounded px-2 py-0.5 hover:bg-emerald-50 disabled:opacity-60"
                      >
                        Complete
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border border-gray-100 rounded-lg p-3">
              <p className="text-xs font-semibold text-navy mb-2">Drafted ({linkedinDraftedTasks.length})</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {linkedinDraftedTasks.length === 0 ? (
                  <p className="text-xs text-brand-gray">No drafted tasks.</p>
                ) : (
                  linkedinDraftedTasks.slice(0, 20).map((task) => (
                    <div key={task.id} className="rounded border border-gray-100 p-2">
                      <p className="text-xs font-semibold text-navy">{task.lead?.name || 'Unknown lead'}</p>
                      <p className="text-[11px] text-brand-gray">{task.lead?.company || task.lead?.email || 'No context'}</p>
                      <p className="text-[11px] text-brand-gray">Approve the linked draft in Draft Inbox</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border border-gray-100 rounded-lg p-3">
              <p className="text-xs font-semibold text-navy mb-2">Pending ({linkedinPendingTasks.length})</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {linkedinPendingTasks.length === 0 ? (
                  <p className="text-xs text-brand-gray">No pending tasks.</p>
                ) : (
                  linkedinPendingTasks.slice(0, 20).map((task) => (
                    <div key={task.id} className="rounded border border-gray-100 p-2">
                      <p className="text-xs font-semibold text-navy">{task.lead?.name || 'Unknown lead'}</p>
                      <p className="text-[11px] text-brand-gray">{task.lead?.company || task.lead?.email || 'No context'}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border border-gray-100 rounded-lg p-3">
              <p className="text-xs font-semibold text-navy mb-2">Completed ({linkedinCompletedTasks.length})</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {linkedinCompletedTasks.length === 0 ? (
                  <p className="text-xs text-brand-gray">No completed tasks yet.</p>
                ) : (
                  linkedinCompletedTasks.slice(0, 20).map((task) => (
                    <div key={task.id} className="rounded border border-gray-100 p-2">
                      <p className="text-xs font-semibold text-navy">{task.lead?.name || 'Unknown lead'}</p>
                      <p className="text-[11px] text-brand-gray">{task.lead?.company || task.lead?.email || 'No context'}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Workspace Config ─────────────────────────────────────────────── */}
      {showWorkspace('admin') && (
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">Workspace Configuration</h3>
            <p className="text-xs text-brand-gray mt-0.5">Sender identity, daily limits, and SLA thresholds for this workspace.</p>
          </div>
          <button
            onClick={handleSaveWorkspaceConfig}
            disabled={loadingWorkspaceConfig || busyKey === 'save-workspace-config'}
            className="text-xs bg-navy text-white rounded-lg px-3 py-1.5 hover:bg-navy/90 disabled:opacity-60"
          >
            {busyKey === 'save-workspace-config' ? 'Saving...' : 'Save Config'}
          </button>
        </div>

        {loadingWorkspaceConfig ? (
          <p className="text-sm text-brand-gray">Loading workspace config...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-navy block mb-1">Sender Name</label>
                <input
                  type="text"
                  value={workspaceConfigForm.senderName}
                  onChange={(e) => setWorkspaceConfigForm((prev) => ({ ...prev, senderName: e.target.value }))}
                  placeholder="e.g. Your Name"
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-navy block mb-1">Email Signature</label>
                <textarea
                  value={workspaceConfigForm.emailSignature}
                  onChange={(e) => setWorkspaceConfigForm((prev) => ({ ...prev, emailSignature: e.target.value }))}
                  placeholder="Your email signature..."
                  rows={3}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full resize-none"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-navy block mb-1">Daily Email Limit</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={workspaceConfigForm.dailyEmailLimit}
                    onChange={(e) => setWorkspaceConfigForm((prev) => ({ ...prev, dailyEmailLimit: Number(e.target.value) }))}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-navy block mb-1">Daily LinkedIn Limit</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={workspaceConfigForm.dailyLinkedinLimit}
                    onChange={(e) => setWorkspaceConfigForm((prev) => ({ ...prev, dailyLinkedinLimit: Number(e.target.value) }))}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
              </div>
              <p className="text-xs font-semibold text-navy">SLA Thresholds</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-brand-gray block mb-1">Draft stale after (hours)</label>
                  <input
                    type="number"
                    min={1}
                    value={workspaceConfigForm.slaDraftStaleHours}
                    onChange={(e) => setWorkspaceConfigForm((prev) => ({ ...prev, slaDraftStaleHours: Number(e.target.value) }))}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-brand-gray block mb-1">LinkedIn overdue after (hours)</label>
                  <input
                    type="number"
                    min={1}
                    value={workspaceConfigForm.slaLinkedinOverdueHours}
                    onChange={(e) => setWorkspaceConfigForm((prev) => ({ ...prev, slaLinkedinOverdueHours: Number(e.target.value) }))}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-brand-gray block mb-1">Paused sequence stale after (days)</label>
                  <input
                    type="number"
                    min={1}
                    value={workspaceConfigForm.slaPausedStaleDays}
                    onChange={(e) => setWorkspaceConfigForm((prev) => ({ ...prev, slaPausedStaleDays: Number(e.target.value) }))}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-brand-gray block mb-1">High-score not contacted after (days)</label>
                  <input
                    type="number"
                    min={1}
                    value={workspaceConfigForm.slaHighScoreNotContactedDays}
                    onChange={(e) => setWorkspaceConfigForm((prev) => ({ ...prev, slaHighScoreNotContactedDays: Number(e.target.value) }))}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        {workspaceConfig && (
          <p className="text-[11px] text-brand-gray">
            Last saved: {new Date(workspaceConfig.updatedAt).toLocaleString()}
          </p>
        )}
      </div>
      )}

      {/* ── SLA Escalation Rules ─────────────────────────────────────────── */}
      {showWorkspace('admin') && (
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">SLA Escalation Rules</h3>
            <p className="text-xs text-brand-gray mt-0.5">Automatically create notifications when SLA thresholds are breached.</p>
          </div>
          <button
            onClick={handleRunEscalations}
            disabled={busyKey === 'run-escalations'}
            className="text-xs border border-amber-200 text-amber-700 rounded-lg px-3 py-1.5 hover:bg-amber-50 disabled:opacity-60"
          >
            {busyKey === 'run-escalations' ? 'Running...' : 'Run Escalation Check'}
          </button>
        </div>

        <div className="flex gap-2">
          <select
            value={newEscalationType}
            onChange={(e) => setNewEscalationType(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1"
          >
            <option value="draft_stale">Stale Approved Email Draft</option>
            <option value="linkedin_overdue">Overdue LinkedIn Task</option>
            <option value="paused_stale">Stale Paused Sequence</option>
            <option value="high_score_not_contacted">High-Score Lead Not Contacted</option>
          </select>
          <button
            onClick={handleCreateEscalation}
            disabled={busyKey === 'create-escalation'}
            className="text-xs bg-navy text-white rounded-lg px-3 py-2 hover:bg-navy/90 disabled:opacity-60"
          >
            {busyKey === 'create-escalation' ? 'Adding...' : 'Add Rule'}
          </button>
        </div>

        {loadingEscalations ? (
          <p className="text-sm text-brand-gray">Loading escalation rules...</p>
        ) : escalationRules.length === 0 ? (
          <p className="text-sm text-brand-gray">No escalation rules configured. Add one above to start automating SLA notifications.</p>
        ) : (
          <div className="space-y-2">
            {escalationRules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2"
              >
                <div>
                  <p className="text-sm font-semibold text-navy">{rule.label}</p>
                  <p className="text-[11px] text-brand-gray">
                    Action: {rule.action}
                    {rule.thresholdOverride != null ? ` · Override threshold: ${rule.thresholdOverride}` : ' · Uses workspace threshold'}
                    {rule.lastRunAt ? ` · Last run: ${new Date(rule.lastRunAt).toLocaleString()}` : ' · Never run'}
                  </p>
                </div>
                <button
                  onClick={() => handleToggleEscalation(rule)}
                  disabled={busyKey === `toggle-escalation-${rule.id}`}
                  className={`text-xs border rounded-lg px-3 py-1.5 disabled:opacity-60 ${
                    rule.isEnabled
                      ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                      : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  {rule.isEnabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ── Notifications ────────────────────────────────────────────────── */}
      {showWorkspace('admin') && (
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">
              Notifications
              {notificationUnreadCount > 0 && (
                <span className="ml-2 bg-rose-600 text-white text-[11px] font-bold rounded-full px-1.5 py-0.5">
                  {notificationUnreadCount}
                </span>
              )}
            </h3>
            <p className="text-xs text-brand-gray mt-0.5">SLA escalation alerts and automated system notifications.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={refreshNotifications}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              {loadingNotifications ? 'Refreshing...' : 'Refresh'}
            </button>
            {notificationUnreadCount > 0 && (
              <button
                onClick={handleMarkAllNotificationsRead}
                disabled={busyKey === 'mark-all-read'}
                className="text-xs border border-indigo-200 text-indigo-700 rounded-lg px-3 py-1.5 hover:bg-indigo-50 disabled:opacity-60"
              >
                {busyKey === 'mark-all-read' ? 'Marking...' : 'Mark All Read'}
              </button>
            )}
          </div>
        </div>

        {loadingNotifications ? (
          <p className="text-sm text-brand-gray">Loading notifications...</p>
        ) : notifications.length === 0 ? (
          <p className="text-sm text-brand-gray">No notifications yet. Run an escalation check to generate alerts.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {notifications.map((notif) => (
              <div
                key={notif.id}
                className={`flex items-start justify-between border rounded-lg px-3 py-2 gap-3 ${
                  notif.isRead ? 'border-gray-100 bg-white' : 'border-indigo-100 bg-indigo-50/30'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${notif.isRead ? 'text-navy' : 'text-indigo-900'}`}>
                    {notif.title}
                  </p>
                  <p className="text-[11px] text-brand-gray mt-0.5">{notif.body}</p>
                  <p className="text-[11px] text-brand-gray mt-0.5">
                    {new Date(notif.createdAt).toLocaleString()}
                  </p>
                </div>
                {!notif.isRead && (
                  <button
                    onClick={() => handleMarkNotificationRead(notif.id)}
                    disabled={busyKey === `mark-read-${notif.id}`}
                    className="text-[11px] border border-gray-200 text-gray-600 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-60 shrink-0"
                  >
                    Mark read
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
