import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

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
const MULTIFAMILY_OBJECT_TYPES = [
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'property', label: 'Property' },
  { value: 'tech_stack', label: 'Tech Stack' },
  { value: 'initiative', label: 'Initiative' },
]
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

function toInt(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function formatCurrency(value) {
  const number = Number(value || 0)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(number)
}

function downloadBlobFile(blob, filename) {
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(objectUrl)
}

function renderStatusBadge(status) {
  const normalized = String(status || 'new')
  const classes = {
    new: 'bg-slate-100 text-slate-700',
    qualified: 'bg-blue-100 text-blue-700',
    queued: 'bg-indigo-100 text-indigo-700',
    contacted: 'bg-amber-100 text-amber-700',
    replied: 'bg-emerald-100 text-emerald-700',
    meeting: 'bg-teal-100 text-teal-700',
    opportunity: 'bg-green-100 text-green-700',
    disqualified: 'bg-rose-100 text-rose-700',
    suppressed: 'bg-zinc-100 text-zinc-700',
  }

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${classes[normalized] || classes.new}`}>
      {normalized}
    </span>
  )
}

export default function OutboundAutomation() {
  const { token } = useAuth()
  const [analytics, setAnalytics] = useState(null)
  const [leads, setLeads] = useState([])
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [csvFile, setCsvFile] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [sessionDrafts, setSessionDrafts] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [sequences, setSequences] = useState([])
  const [loadingSequences, setLoadingSequences] = useState(false)
  const [sequenceEnrollments, setSequenceEnrollments] = useState([])
  const [loadingSequenceEnrollments, setLoadingSequenceEnrollments] = useState(false)
  const [selectedSequenceByLead, setSelectedSequenceByLead] = useState({})
  const [workflowRules, setWorkflowRules] = useState([])
  const [loadingWorkflowRules, setLoadingWorkflowRules] = useState(false)
  const [ruleTestLeadId, setRuleTestLeadId] = useState('')
  const [ruleTestResultById, setRuleTestResultById] = useState({})
  const [forecastPeriod, setForecastPeriod] = useState('monthly')
  const [forecastSummary, setForecastSummary] = useState(null)
  const [loadingForecast, setLoadingForecast] = useState(false)
  const [attributionSummary, setAttributionSummary] = useState(null)
  const [loadingAttribution, setLoadingAttribution] = useState(false)
  const [dataQualityIssues, setDataQualityIssues] = useState([])
  const [dataQualitySummary, setDataQualitySummary] = useState(null)
  const [loadingDataQuality, setLoadingDataQuality] = useState(false)
  const [dataQualityMergeOperations, setDataQualityMergeOperations] = useState([])
  const [loadingDataQualityMergeOperations, setLoadingDataQualityMergeOperations] = useState(false)
  const [dataQualityStatusFilter, setDataQualityStatusFilter] = useState('open')
  const [multifamilyObjects, setMultifamilyObjects] = useState([])
  const [multifamilySummary, setMultifamilySummary] = useState(null)
  const [loadingMultifamily, setLoadingMultifamily] = useState(false)
  const [leadObjectSelection, setLeadObjectSelection] = useState({})
  const [multifamilyExplorer, setMultifamilyExplorer] = useState({
    objectId: '',
    entityType: 'contact',
    search: '',
  })
  const [multifamilyEntities, setMultifamilyEntities] = useState([])
  const [loadingMultifamilyEntities, setLoadingMultifamilyEntities] = useState(false)
  const [multifamilyEntitySelection, setMultifamilyEntitySelection] = useState({})
  const [selectedObjectAssociations, setSelectedObjectAssociations] = useState([])
  const [loadingSelectedObjectAssociations, setLoadingSelectedObjectAssociations] = useState(false)
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

  const authHeaders = useMemo(
    () => ({
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),
    [token]
  )

  const fetchAnalytics = useCallback(async () => {
    if (!token) return
    setLoadingAnalytics(true)
    try {
      const { data } = await axios.get('/api/outbound/analytics/summary', authHeaders)
      setAnalytics(data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load outbound analytics.')
    } finally {
      setLoadingAnalytics(false)
    }
  }, [authHeaders, token])

  const fetchLeads = useCallback(async () => {
    if (!token) return
    setLoadingLeads(true)
    try {
      const params = new URLSearchParams()
      if (filters.status) params.append('status', filters.status)
      if (filters.search) params.append('search', filters.search)
      if (filters.objectType) params.append('objectType', filters.objectType)
      if (filters.objectId) params.append('objectId', filters.objectId)
      params.append('minScore', String(filters.minScore))
      params.append('limit', String(filters.limit))

      const { data } = await axios.get(`/api/outbound/leads?${params.toString()}`, authHeaders)
      setLeads(Array.isArray(data.leads) ? data.leads : [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load outbound leads.')
    } finally {
      setLoadingLeads(false)
    }
  }, [authHeaders, filters, token])

  const fetchCampaigns = useCallback(async () => {
    if (!token) return
    setLoadingCampaigns(true)
    try {
      const { data } = await axios.get('/api/outbound/campaigns?limit=100', authHeaders)
      setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load campaigns.')
    } finally {
      setLoadingCampaigns(false)
    }
  }, [authHeaders, token])

  const fetchSequences = useCallback(async () => {
    if (!token) return
    setLoadingSequences(true)
    try {
      const { data } = await axios.get('/api/outbound/sequences', authHeaders)
      setSequences(Array.isArray(data.sequences) ? data.sequences : [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load sequences.')
    } finally {
      setLoadingSequences(false)
    }
  }, [authHeaders, token])

  const fetchSequenceEnrollments = useCallback(async () => {
    if (!token) return
    setLoadingSequenceEnrollments(true)
    try {
      const { data } = await axios.get('/api/outbound/sequences/enrollments?limit=200', authHeaders)
      setSequenceEnrollments(Array.isArray(data.enrollments) ? data.enrollments : [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load sequence enrollments.')
    } finally {
      setLoadingSequenceEnrollments(false)
    }
  }, [authHeaders, token])

  const fetchWorkflowRules = useCallback(async () => {
    if (!token) return
    setLoadingWorkflowRules(true)
    try {
      const { data } = await axios.get('/api/outbound/workflows/rules?includeDisabled=true', authHeaders)
      setWorkflowRules(Array.isArray(data.rules) ? data.rules : [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load workflow rules.')
    } finally {
      setLoadingWorkflowRules(false)
    }
  }, [authHeaders, token])

  const fetchForecastSummary = useCallback(async () => {
    if (!token) return
    setLoadingForecast(true)
    try {
      const { data } = await axios.get(`/api/outbound/forecast/summary?period=${forecastPeriod}`, authHeaders)
      setForecastSummary(data)
      if (data?.goals) {
        setGoalForm((prev) => ({
          ...prev,
          targetMeetings: toInt(data.goals.targetMeetings, prev.targetMeetings),
          targetOpportunities: toInt(data.goals.targetOpportunities, prev.targetOpportunities),
          targetRevenue: toInt(data.goals.targetRevenue, prev.targetRevenue),
          notes: data.goals.notes || '',
        }))
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load forecast summary.')
    } finally {
      setLoadingForecast(false)
    }
  }, [authHeaders, token, forecastPeriod])

  const fetchAttributionSummary = useCallback(async () => {
    if (!token) return
    setLoadingAttribution(true)
    try {
      const { data } = await axios.get(`/api/outbound/attribution/summary?period=${forecastPeriod}`, authHeaders)
      setAttributionSummary(data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load attribution summary.')
    } finally {
      setLoadingAttribution(false)
    }
  }, [authHeaders, token, forecastPeriod])

  const fetchDataQualityIssues = useCallback(async () => {
    if (!token) return
    setLoadingDataQuality(true)
    try {
      const { data } = await axios.get(
        `/api/outbound/data-quality/issues?status=${encodeURIComponent(dataQualityStatusFilter)}&limit=200`,
        authHeaders
      )
      setDataQualityIssues(Array.isArray(data.issues) ? data.issues : [])
      setDataQualitySummary(data.summary || null)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data quality issues.')
    } finally {
      setLoadingDataQuality(false)
    }
  }, [authHeaders, token, dataQualityStatusFilter])

  const fetchDataQualityMergeOperations = useCallback(async () => {
    if (!token) return
    setLoadingDataQualityMergeOperations(true)
    try {
      const { data } = await axios.get('/api/outbound/data-quality/merge-operations?limit=50', authHeaders)
      setDataQualityMergeOperations(Array.isArray(data.mergeOperations) ? data.mergeOperations : [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load merge operations.')
    } finally {
      setLoadingDataQualityMergeOperations(false)
    }
  }, [authHeaders, token])

  const fetchMultifamilyObjects = useCallback(async () => {
    if (!token) return
    setLoadingMultifamily(true)
    try {
      const [objectsRes, summaryRes] = await Promise.all([
        axios.get('/api/outbound/multifamily/objects', authHeaders),
        axios.get('/api/outbound/multifamily/summary', authHeaders),
      ])
      setMultifamilyObjects(Array.isArray(objectsRes.data.objects) ? objectsRes.data.objects : [])
      setMultifamilySummary(summaryRes.data || null)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load multifamily objects.')
    } finally {
      setLoadingMultifamily(false)
    }
  }, [authHeaders, token])

  const fetchMultifamilyEntities = useCallback(async () => {
    if (!token) return
    setLoadingMultifamilyEntities(true)
    try {
      const params = new URLSearchParams()
      params.append('entityType', multifamilyExplorer.entityType)
      params.append('limit', '100')
      if (multifamilyExplorer.search) {
        params.append('search', multifamilyExplorer.search)
      }

      const { data } = await axios.get(`/api/outbound/multifamily/entities?${params.toString()}`, authHeaders)
      setMultifamilyEntities(Array.isArray(data.entities) ? data.entities : [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load multifamily explorer entities.')
    } finally {
      setLoadingMultifamilyEntities(false)
    }
  }, [authHeaders, multifamilyExplorer.entityType, multifamilyExplorer.search, token])

  const fetchSelectedObjectAssociations = useCallback(async () => {
    if (!token || !multifamilyExplorer.objectId) {
      setSelectedObjectAssociations([])
      return
    }

    setLoadingSelectedObjectAssociations(true)
    try {
      const params = new URLSearchParams()
      params.append('entityType', multifamilyExplorer.entityType)
      const { data } = await axios.get(
        `/api/outbound/multifamily/objects/${multifamilyExplorer.objectId}/associations?${params.toString()}`,
        authHeaders
      )
      setSelectedObjectAssociations(Array.isArray(data.associations) ? data.associations : [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load object associations.')
    } finally {
      setLoadingSelectedObjectAssociations(false)
    }
  }, [authHeaders, multifamilyExplorer.entityType, multifamilyExplorer.objectId, token])

  useEffect(() => {
    fetchLeads()
  }, [fetchLeads])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  useEffect(() => {
    fetchSequences()
  }, [fetchSequences])

  useEffect(() => {
    fetchSequenceEnrollments()
  }, [fetchSequenceEnrollments])

  useEffect(() => {
    fetchWorkflowRules()
  }, [fetchWorkflowRules])

  useEffect(() => {
    fetchForecastSummary()
  }, [fetchForecastSummary])

  useEffect(() => {
    fetchAttributionSummary()
  }, [fetchAttributionSummary])

  useEffect(() => {
    fetchDataQualityIssues()
  }, [fetchDataQualityIssues])

  useEffect(() => {
    fetchDataQualityMergeOperations()
  }, [fetchDataQualityMergeOperations])

  useEffect(() => {
    fetchMultifamilyObjects()
  }, [fetchMultifamilyObjects])

  useEffect(() => {
    const hasSelectedObject = multifamilyObjects.some((object) => object.id === multifamilyExplorer.objectId)
    if ((!multifamilyExplorer.objectId || !hasSelectedObject) && multifamilyObjects.length > 0) {
      setMultifamilyExplorer((prev) => ({
        ...prev,
        objectId: multifamilyObjects[0].id,
      }))
    }
  }, [multifamilyExplorer.objectId, multifamilyObjects])

  useEffect(() => {
    fetchMultifamilyEntities()
  }, [fetchMultifamilyEntities])

  useEffect(() => {
    fetchSelectedObjectAssociations()
  }, [fetchSelectedObjectAssociations])

  useEffect(() => {
    setMultifamilyEntitySelection({})
  }, [multifamilyExplorer.entityType, multifamilyExplorer.objectId])

  useEffect(() => {
    if (!ruleTestLeadId && leads.length > 0) {
      setRuleTestLeadId(leads[0].id)
    }
  }, [leads, ruleTestLeadId])

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
      const form = new FormData()
      form.append('file', csvFile)
      form.append('sourceType', importConfig.sourceType)
      form.append('sourceReference', importConfig.sourceReference)
      form.append('sourceConfidence', String(importConfig.sourceConfidence))

      const { data } = await axios.post('/api/outbound/leads/import/csv', form, authHeaders)
      setImportResult(data)
      setMessage(`Import complete: ${data.importedRows} imported, ${data.duplicateRows} duplicate, ${data.failedRows} failed.`)
      await Promise.all([fetchLeads(), fetchAnalytics(), fetchForecastSummary(), fetchAttributionSummary(), fetchDataQualityIssues()])
    })
  }

  const handleRescoreLead = async (leadId) => {
    await runAction(`score-${leadId}`, async () => {
      await axios.post(`/api/outbound/leads/${leadId}/score`, {}, authHeaders)
      setMessage('Lead rescored.')
      await Promise.all([fetchLeads(), fetchAnalytics(), fetchForecastSummary(), fetchAttributionSummary(), fetchDataQualityIssues()])
    })
  }

  const handleGenerateDraft = async (lead, channel) => {
    await runAction(`draft-${channel}-${lead.id}`, async () => {
      const { data } = await axios.post(
        '/api/outbound/drafts/generate',
        { leadId: lead.id, channel },
        authHeaders
      )

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
      await Promise.all([fetchAnalytics(), fetchForecastSummary(), fetchAttributionSummary(), fetchDataQualityIssues()])
    })
  }

  const handleApproveDraft = async (draftId) => {
    await runAction(`approve-${draftId}`, async () => {
      const { data } = await axios.patch(`/api/outbound/drafts/${draftId}/approve`, {}, authHeaders)

      setSessionDrafts((prev) =>
        prev.map((item) =>
          item.id === draftId
            ? {
                ...item,
                status: data.status,
                linkedinTaskStatus: item.channel === 'linkedin' ? 'approved' : item.linkedinTaskStatus,
              }
            : item
        )
      )

      setMessage('Draft approved.')
      await Promise.all([fetchAnalytics(), fetchForecastSummary(), fetchAttributionSummary(), fetchDataQualityIssues()])
    })
  }

  const handleCompleteLinkedInTask = async (draft) => {
    if (!draft.linkedinTaskId) {
      setError('No LinkedIn task id is available for this draft.')
      return
    }

    await runAction(`complete-task-${draft.linkedinTaskId}`, async () => {
      await axios.post(
        `/api/outbound/linkedin/tasks/${draft.linkedinTaskId}/complete`,
        { notes: 'Completed from outbound automation page.' },
        authHeaders
      )

      setSessionDrafts((prev) =>
        prev.map((item) =>
          item.id === draft.id
            ? {
                ...item,
                linkedinTaskStatus: 'completed',
              }
            : item
        )
      )

      setMessage('LinkedIn task marked complete.')
      await Promise.all([fetchLeads(), fetchAnalytics(), fetchForecastSummary(), fetchAttributionSummary(), fetchDataQualityIssues()])
    })
  }

  const handleSendEmailDraft = async (draft) => {
    await runAction(`send-email-${draft.id}`, async () => {
      const { data } = await axios.post(`/api/outbound/drafts/${draft.id}/send`, {}, authHeaders)

      setSessionDrafts((prev) =>
        prev.map((item) =>
          item.id === draft.id
            ? {
                ...item,
                status: data?.draft?.status || 'sent',
              }
            : item
        )
      )

      setMessage('Email draft marked as sent.')
      await Promise.all([fetchLeads(), fetchAnalytics(), fetchForecastSummary(), fetchAttributionSummary(), fetchDataQualityIssues()])
    })
  }

  const handleExport = async (type) => {
    await runAction(`export-${type}`, async () => {
      const endpoint =
        type === 'events'
          ? '/api/outbound/events/export?format=csv&days=30&limit=5000'
          : '/api/outbound/audit/export?format=csv&days=30&limit=5000'

      const response = await axios.get(endpoint, {
        ...authHeaders,
        responseType: 'blob',
      })

      const filename = type === 'events' ? 'outbound-events.csv' : 'outbound-audit.csv'
      downloadBlobFile(response.data, filename)
      setMessage(`${type === 'events' ? 'Event' : 'Audit'} export downloaded.`)
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

      const { data } = await axios.post('/api/outbound/campaigns', payload, authHeaders)
      setCampaignForm((prev) => ({ ...prev, name: '' }))
      setMessage(`Campaign created: ${data.name} (${data.addedMembers} members).`)
      await Promise.all([fetchCampaigns(), fetchAnalytics(), fetchForecastSummary(), fetchAttributionSummary(), fetchDataQualityIssues()])
    })
  }

  const handleCampaignStatus = async (campaignId, status) => {
    await runAction(`campaign-status-${campaignId}-${status}`, async () => {
      await axios.patch(`/api/outbound/campaigns/${campaignId}/status`, { status }, authHeaders)
      setMessage(`Campaign status updated to ${status}.`)
      await Promise.all([fetchCampaigns(), fetchAnalytics(), fetchForecastSummary(), fetchAttributionSummary(), fetchDataQualityIssues()])
    })
  }

  const handleEnrollLeadInSequence = async (leadId) => {
    const sequenceId = selectedSequenceByLead[leadId]
    if (!sequenceId) {
      setError('Select a sequence before enrolling.')
      return
    }

    await runAction(`enroll-sequence-${leadId}`, async () => {
      await axios.post(
        `/api/outbound/sequences/${sequenceId}/enroll`,
        { leadId },
        authHeaders
      )
      setMessage('Lead enrolled in sequence.')
      await Promise.all([
        fetchSequenceEnrollments(),
        fetchLeads(),
        fetchAnalytics(),
        fetchForecastSummary(),
        fetchAttributionSummary(),
        fetchDataQualityIssues(),
      ])
    })
  }

  const handleSequenceStateChange = async (enrollment, state) => {
    await runAction(`sequence-state-${enrollment.id}-${state}`, async () => {
      await axios.patch(
        `/api/outbound/sequences/enrollments/${enrollment.id}/state`,
        {
          state,
          reason: state === 'paused' ? 'Paused from outbound automation UI' : undefined,
        },
        authHeaders
      )
      setMessage(`Sequence enrollment ${state}.`)
      await Promise.all([
        fetchSequenceEnrollments(),
        fetchLeads(),
        fetchAnalytics(),
        fetchForecastSummary(),
        fetchAttributionSummary(),
        fetchDataQualityIssues(),
      ])
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
      await axios.post('/api/outbound/workflows/rules', payload, authHeaders)
      setMessage('Workflow rule created.')
      setWorkflowForm((prev) => ({
        ...prev,
        name: '',
      }))
      await fetchWorkflowRules()
    })
  }

  const handleToggleWorkflowRule = async (rule) => {
    await runAction(`workflow-toggle-${rule.id}`, async () => {
      await axios.patch(
        `/api/outbound/workflows/rules/${rule.id}`,
        { enabled: !rule.enabled },
        authHeaders
      )
      setMessage(`Workflow rule ${!rule.enabled ? 'enabled' : 'disabled'}.`)
      await fetchWorkflowRules()
    })
  }

  const handleTestWorkflowRule = async (rule, applyActions) => {
    await runAction(`workflow-test-${rule.id}-${applyActions ? 'live' : 'dry'}`, async () => {
      const { data } = await axios.post(
        `/api/outbound/workflows/rules/${rule.id}/test`,
        {
          leadId: ruleTestLeadId || null,
          applyActions,
          eventData: {
            source: 'outbound_ui',
          },
        },
        authHeaders
      )

      setRuleTestResultById((prev) => ({
        ...prev,
        [rule.id]: data.result,
      }))

      setMessage(
        applyActions
          ? `Rule executed (${data.result?.status || 'unknown'}).`
          : `Rule dry-run completed (${data.result?.status || 'unknown'}).`
      )

      await Promise.all([
        fetchWorkflowRules(),
        fetchLeads(),
        fetchAnalytics(),
        fetchSequenceEnrollments(),
        fetchForecastSummary(),
        fetchAttributionSummary(),
        fetchDataQualityIssues(),
      ])
    })
  }

  const handleSaveGoal = async (event) => {
    event.preventDefault()

    await runAction(`goal-save-${forecastPeriod}`, async () => {
      await axios.put(
        '/api/outbound/forecast/goals',
        {
          periodType: forecastPeriod,
          targetMeetings: toInt(goalForm.targetMeetings),
          targetOpportunities: toInt(goalForm.targetOpportunities),
          targetRevenue: toInt(goalForm.targetRevenue),
          notes: goalForm.notes || '',
        },
        authHeaders
      )
      setMessage('Forecast goals saved.')
      await Promise.all([fetchForecastSummary(), fetchAttributionSummary(), fetchDataQualityIssues()])
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

      await axios.patch(
        `/api/outbound/leads/${lead.id}/suppression`,
        {
          suppressed,
          reason: suppressed ? reason.trim() : null,
        },
        authHeaders
      )

      setMessage(suppressed ? 'Lead suppressed.' : 'Lead unsuppressed.')
      await Promise.all([
        fetchLeads(),
        fetchAnalytics(),
        fetchCampaigns(),
        fetchSequenceEnrollments(),
        fetchForecastSummary(),
        fetchAttributionSummary(),
        fetchDataQualityIssues(),
      ])
    })
  }

  const handleDataQualityIssueStatus = async (issueId, status) => {
    await runAction(`data-quality-${issueId}-${status}`, async () => {
      await axios.patch(
        `/api/outbound/data-quality/issues/${issueId}/status`,
        { status },
        authHeaders
      )
      setMessage(`Data quality issue marked as ${status}.`)
      await Promise.all([fetchDataQualityIssues(), fetchLeads()])
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
      const { data } = await axios.post(
        `/api/outbound/data-quality/issues/${issue.id}/merge`,
        {
          primaryLeadId: suggestedPrimaryLeadId,
          duplicateLeadIds: candidateLeadIds,
        },
        authHeaders
      )

      setMessage(
        `Merged ${toInt(data?.mergeOperation?.mergedLeadCount)} duplicate lead(s) into ${data?.primaryLead?.name || 'primary lead'}.`
      )
      await Promise.all([
        fetchDataQualityIssues(),
        fetchDataQualityMergeOperations(),
        fetchLeads(),
        fetchAnalytics(),
        fetchCampaigns(),
        fetchSequenceEnrollments(),
        fetchMultifamilyObjects(),
        fetchMultifamilyEntities(),
        fetchSelectedObjectAssociations(),
      ])
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
      await axios.post(
        '/api/outbound/multifamily/objects',
        {
          objectType: multifamilyForm.objectType,
          name,
          description: multifamilyForm.description || '',
          metadata: {},
        },
        authHeaders
      )
      setMultifamilyForm((prev) => ({ ...prev, name: '', description: '' }))
      setMessage('Multifamily object created.')
      await fetchMultifamilyObjects()
    })
  }

  const handleAssociateObjectToLead = async (leadId) => {
    const selection = leadObjectSelection[leadId] || {}
    if (!selection.objectType || !selection.objectId) {
      setError('Select object type and object before associating.')
      return
    }

    await runAction(`multifamily-associate-${leadId}`, async () => {
      await axios.post(
        `/api/outbound/multifamily/objects/${selection.objectId}/associations`,
        {
          entityType: 'outbound_lead',
          entityId: leadId,
          metadata: { source: 'outbound_ui' },
        },
        authHeaders
      )
      setMessage('Lead associated to multifamily object.')
      await Promise.all([fetchMultifamilyObjects(), fetchLeads()])
    })
  }

  const handleToggleMultifamilyEntitySelection = (entityKey, checked) => {
    setMultifamilyEntitySelection((prev) => ({
      ...prev,
      [entityKey]: Boolean(checked),
    }))
  }

  const handleBulkAssociateExplorerEntities = async () => {
    if (!multifamilyExplorer.objectId) {
      setError('Select a multifamily object before tagging entities.')
      return
    }

    const selectedKeys = Object.entries(multifamilyEntitySelection)
      .filter(([, selected]) => Boolean(selected))
      .map(([entityKey]) => entityKey)

    if (selectedKeys.length === 0) {
      setError('Select at least one entity to associate.')
      return
    }

    await runAction(`multifamily-bulk-${multifamilyExplorer.entityType}`, async () => {
      const payload =
        multifamilyExplorer.entityType === 'company'
          ? {
              entityType: 'company',
              companyNames: selectedKeys,
              metadata: { source: 'outbound_ui_bulk' },
            }
          : {
              entityType: multifamilyExplorer.entityType,
              entityIds: selectedKeys,
              metadata: { source: 'outbound_ui_bulk' },
            }

      const { data } = await axios.post(
        `/api/outbound/multifamily/objects/${multifamilyExplorer.objectId}/associations/bulk`,
        payload,
        authHeaders
      )

      setMessage(`Tagged ${toInt(data.upsertedCount)} ${multifamilyExplorer.entityType}(s) to selected object.`)
      setMultifamilyEntitySelection({})
      await Promise.all([fetchMultifamilyObjects(), fetchMultifamilyEntities(), fetchSelectedObjectAssociations(), fetchLeads()])
    })
  }

  const leadsStats = analytics?.leads || {}
  const emailLimit = analytics?.dailySendLimits?.email
  const linkedinLimit = analytics?.dailySendLimits?.linkedin
  const campaignStats = analytics?.campaigns || {}
  const forecastBuckets = forecastSummary?.buckets || {}
  const forecastGoals = forecastSummary?.goals || null
  const forecastGap = forecastSummary?.gapToGoal || null
  const forecastProgress = forecastSummary?.progress || null
  const attributionOverview = attributionSummary?.overview || {}
  const attributionSources = Array.isArray(attributionSummary?.bySource) ? attributionSummary.bySource : []
  const attributionSequences = Array.isArray(attributionSummary?.bySequence) ? attributionSummary.bySequence : []
  const attributionPersonas = Array.isArray(attributionSummary?.byPersona) ? attributionSummary.byPersona : []
  const dataQualityOpenCount = toInt(dataQualitySummary?.open_count)
  const dataQualityOpenBlockingCount = toInt(dataQualitySummary?.open_blocking_count)
  const dataQualityResolvedCount = toInt(dataQualitySummary?.resolved_count)
  const dataQualityMergeCount30d = toInt(dataQualitySummary?.merge_count_30d)
  const multifamilyObjectCounts = multifamilySummary?.objectCounts || {}
  const multifamilyAssociationCounts = multifamilySummary?.associationCounts || {}
  const multifamilyObjectsByType = useMemo(() => {
    const map = {
      portfolio: [],
      property: [],
      tech_stack: [],
      initiative: [],
    }
    for (const object of multifamilyObjects) {
      if (map[object.objectType]) {
        map[object.objectType].push(object)
      }
    }
    return map
  }, [multifamilyObjects])
  const selectedMultifamilyEntityKeys = useMemo(
    () =>
      Object.entries(multifamilyEntitySelection)
        .filter(([, selected]) => Boolean(selected))
        .map(([entityKey]) => entityKey),
    [multifamilyEntitySelection]
  )
  const selectedMultifamilyObject = useMemo(
    () => multifamilyObjects.find((object) => object.id === multifamilyExplorer.objectId) || null,
    [multifamilyExplorer.objectId, multifamilyObjects]
  )
  const filterScopedObjects = filters.objectType ? multifamilyObjectsByType[filters.objectType] || [] : []
  const openEnrollmentByLead = useMemo(() => {
    const map = {}
    for (const enrollment of sequenceEnrollments) {
      if (enrollment.status === 'active' || enrollment.status === 'paused') {
        map[enrollment.lead_id] = enrollment
      }
    }
    return map
  }, [sequenceEnrollments])

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
              fetchLeads()
              fetchAnalytics()
              fetchCampaigns()
              fetchSequences()
              fetchSequenceEnrollments()
              fetchWorkflowRules()
              fetchForecastSummary()
              fetchAttributionSummary()
              fetchDataQualityIssues()
              fetchDataQualityMergeOperations()
              fetchMultifamilyObjects()
              fetchMultifamilyEntities()
              fetchSelectedObjectAssociations()
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

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">Forecast + Goals</h3>
            <p className="text-xs text-brand-gray mt-0.5">
              Commit, best-case, and closed forecast buckets with period goal tracking.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setForecastPeriod('weekly')}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                forecastPeriod === 'weekly'
                  ? 'bg-teal text-white border-teal'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => setForecastPeriod('monthly')}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                forecastPeriod === 'monthly'
                  ? 'bg-teal text-white border-teal'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Monthly
            </button>
          </div>
        </div>

        {loadingForecast ? (
          <p className="text-sm text-brand-gray">Loading forecast summary...</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-brand-gray">Closed Bucket</p>
                <p className="text-xl font-bold text-navy">{formatCurrency(forecastBuckets.closed?.value)}</p>
                <p className="text-xs text-brand-gray">{toInt(forecastBuckets.closed?.count)} leads</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-brand-gray">Commit Bucket</p>
                <p className="text-xl font-bold text-navy">{formatCurrency(forecastBuckets.commit?.value)}</p>
                <p className="text-xs text-brand-gray">{toInt(forecastBuckets.commit?.count)} leads</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-brand-gray">Best-Case Bucket</p>
                <p className="text-xl font-bold text-navy">{formatCurrency(forecastBuckets.bestCase?.value)}</p>
                <p className="text-xs text-brand-gray">{toInt(forecastBuckets.bestCase?.count)} leads</p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-lg p-4">
              <p className="text-xs text-brand-gray">Total Forecast Value</p>
              <p className="text-2xl font-bold text-navy">{formatCurrency(forecastBuckets.totalForecastValue)}</p>
              {forecastProgress ? (
                <p className="text-xs text-brand-gray mt-1">
                  {toInt(forecastProgress.elapsedDays)} of {toInt(forecastProgress.totalDays)} days elapsed
                </p>
              ) : null}
            </div>

            <form onSubmit={handleSaveGoal} className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input
                type="number"
                min="0"
                value={goalForm.targetMeetings}
                onChange={(event) => setGoalForm((prev) => ({ ...prev, targetMeetings: toInt(event.target.value) }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Target meetings"
              />
              <input
                type="number"
                min="0"
                value={goalForm.targetOpportunities}
                onChange={(event) =>
                  setGoalForm((prev) => ({ ...prev, targetOpportunities: toInt(event.target.value) }))
                }
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Target opportunities"
              />
              <input
                type="number"
                min="0"
                value={goalForm.targetRevenue}
                onChange={(event) => setGoalForm((prev) => ({ ...prev, targetRevenue: toInt(event.target.value) }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Target revenue"
              />
              <input
                type="text"
                value={goalForm.notes}
                onChange={(event) => setGoalForm((prev) => ({ ...prev, notes: event.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Goal notes"
              />
              <button
                type="submit"
                disabled={busyKey === `goal-save-${forecastPeriod}`}
                className="bg-navy text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-navy/90 disabled:opacity-60"
              >
                {busyKey === `goal-save-${forecastPeriod}` ? 'Saving...' : 'Save Goals'}
              </button>
            </form>

            {forecastGoals ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-brand-gray">
                    Meetings: {toInt(forecastSummary?.projected?.meetings)} / {toInt(forecastGoals.targetMeetings)}
                  </p>
                  <p
                    className={`text-xs mt-1 ${
                      (forecastGap?.meetingsGap || 0) <= 0 ? 'text-emerald-600' : 'text-amber-700'
                    }`}
                  >
                    Gap: {toInt(forecastGap?.meetingsGap)}
                  </p>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-brand-gray">
                    Opportunities: {toInt(forecastSummary?.projected?.opportunities)} /{' '}
                    {toInt(forecastGoals.targetOpportunities)}
                  </p>
                  <p
                    className={`text-xs mt-1 ${
                      (forecastGap?.opportunitiesGap || 0) <= 0 ? 'text-emerald-600' : 'text-amber-700'
                    }`}
                  >
                    Gap: {toInt(forecastGap?.opportunitiesGap)}
                  </p>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-brand-gray">
                    Revenue: {formatCurrency(forecastSummary?.projected?.revenue)} /{' '}
                    {formatCurrency(forecastGoals.targetRevenue)}
                  </p>
                  <p
                    className={`text-xs mt-1 ${
                      (forecastGap?.revenueGap || 0) <= 0 ? 'text-emerald-600' : 'text-amber-700'
                    }`}
                  >
                    Gap: {formatCurrency(forecastGap?.revenueGap)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-brand-gray">Set goals for this period to unlock gap-to-goal tracking.</p>
            )}
          </>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">Attribution + Source ROI</h3>
            <p className="text-xs text-brand-gray mt-0.5">
              Source to sequence to meeting to opportunity lineage for the {forecastPeriod} window.
            </p>
          </div>
          {attributionSummary?.period ? (
            <p className="text-xs text-brand-gray">
              {attributionSummary.period.start} to {attributionSummary.period.end}
            </p>
          ) : null}
        </div>

        {loadingAttribution ? (
          <p className="text-sm text-brand-gray">Loading attribution summary...</p>
        ) : attributionSources.length === 0 ? (
          <p className="text-sm text-brand-gray">No attribution events yet for this period.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-brand-gray">Imported</p>
                <p className="text-lg font-bold text-navy">{toInt(attributionOverview.importedLeads)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-brand-gray">Contacted</p>
                <p className="text-lg font-bold text-navy">{toInt(attributionOverview.contactedLeads)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-brand-gray">Meetings</p>
                <p className="text-lg font-bold text-navy">{toInt(attributionOverview.meetingLeads)}</p>
                <p className="text-xs text-brand-gray">{toInt(attributionOverview.meetingRateFromImported)}% from imported</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-brand-gray">Opportunities</p>
                <p className="text-lg font-bold text-navy">{toInt(attributionOverview.opportunityLeads)}</p>
                <p className="text-xs text-brand-gray">
                  {toInt(attributionOverview.opportunityRateFromImported)}% from imported
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-brand-gray">Attributed Revenue</p>
                <p className="text-lg font-bold text-navy">{formatCurrency(attributionOverview.attributedRevenue)}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Imported</th>
                    <th className="py-2 pr-3">Meetings</th>
                    <th className="py-2 pr-3">Opportunities</th>
                    <th className="py-2 pr-3">Revenue</th>
                    <th className="py-2 pr-3">Opp %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {attributionSources.slice(0, 8).map((source) => (
                    <tr key={`${source.sourceType}-${source.sourceReference}`}>
                      <td className="py-2 pr-3">
                        <p className="font-semibold text-navy">{source.sourceType}</p>
                        <p className="text-xs text-brand-gray truncate max-w-[240px]">{source.sourceReference}</p>
                      </td>
                      <td className="py-2 pr-3">{toInt(source.importedLeads)}</td>
                      <td className="py-2 pr-3">{toInt(source.meetingLeads)}</td>
                      <td className="py-2 pr-3">{toInt(source.opportunityLeads)}</td>
                      <td className="py-2 pr-3">{formatCurrency(source.attributedRevenue)}</td>
                      <td className="py-2 pr-3">{toInt(source.opportunityRateFromImported)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs font-semibold text-navy mb-2">Top Sequences</p>
                {attributionSequences.length === 0 ? (
                  <p className="text-xs text-brand-gray">No sequence-attributed events yet.</p>
                ) : (
                  <div className="space-y-2">
                    {attributionSequences.slice(0, 5).map((sequence) => (
                      <div key={sequence.sequenceId} className="flex items-center justify-between gap-3 text-xs">
                        <p className="text-navy truncate">{sequence.sequenceName}</p>
                        <p className="text-brand-gray">
                          Opp {toInt(sequence.opportunityLeads)} | {formatCurrency(sequence.attributedRevenue)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs font-semibold text-navy mb-2">Top Personas</p>
                {attributionPersonas.length === 0 ? (
                  <p className="text-xs text-brand-gray">No persona attribution yet.</p>
                ) : (
                  <div className="space-y-2">
                    {attributionPersonas.slice(0, 5).map((persona) => (
                      <div key={persona.persona} className="flex items-center justify-between gap-3 text-xs">
                        <p className="text-navy">{persona.persona}</p>
                        <p className="text-brand-gray">
                          Opp {toInt(persona.opportunityLeads)} | {formatCurrency(persona.attributedRevenue)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">Multifamily Object Explorer</h3>
            <p className="text-xs text-brand-gray mt-0.5">
              Manage portfolio, property, tech stack, and initiative objects with entity tagging workflows.
            </p>
          </div>
          <button
            onClick={() => {
              fetchMultifamilyObjects()
              fetchMultifamilyEntities()
              fetchSelectedObjectAssociations()
            }}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50"
          >
            Refresh Objects
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Portfolios</p>
            <p className="text-lg font-bold text-navy">{toInt(multifamilyObjectCounts.portfolio)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Properties</p>
            <p className="text-lg font-bold text-navy">{toInt(multifamilyObjectCounts.property)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Tech Stacks</p>
            <p className="text-lg font-bold text-navy">{toInt(multifamilyObjectCounts.tech_stack)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Initiatives</p>
            <p className="text-lg font-bold text-navy">{toInt(multifamilyObjectCounts.initiative)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Lead Associations</p>
            <p className="text-lg font-bold text-navy">{toInt(multifamilyAssociationCounts.outbound_lead)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Contact Associations</p>
            <p className="text-lg font-bold text-navy">{toInt(multifamilyAssociationCounts.contact)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Deal Associations</p>
            <p className="text-lg font-bold text-navy">{toInt(multifamilyAssociationCounts.deal)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Company Associations</p>
            <p className="text-lg font-bold text-navy">{toInt(multifamilyAssociationCounts.company)}</p>
          </div>
        </div>

        <form onSubmit={handleCreateMultifamilyObject} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            value={multifamilyForm.objectType}
            onChange={(event) => setMultifamilyForm((prev) => ({ ...prev, objectType: event.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {MULTIFAMILY_OBJECT_TYPES.map((typeOption) => (
              <option key={typeOption.value} value={typeOption.value}>
                {typeOption.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={multifamilyForm.name}
            onChange={(event) => setMultifamilyForm((prev) => ({ ...prev, name: event.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Object name"
          />
          <input
            type="text"
            value={multifamilyForm.description}
            onChange={(event) => setMultifamilyForm((prev) => ({ ...prev, description: event.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Description"
          />
          <button
            type="submit"
            disabled={busyKey === `multifamily-create-${multifamilyForm.objectType}`}
            className="bg-navy text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-navy/90 disabled:opacity-60"
          >
            {busyKey === `multifamily-create-${multifamilyForm.objectType}` ? 'Creating...' : 'Create Object'}
          </button>
        </form>

        {loadingMultifamily ? (
          <p className="text-sm text-brand-gray">Loading multifamily objects...</p>
        ) : multifamilyObjects.length === 0 ? (
          <p className="text-sm text-brand-gray">No multifamily objects created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3">Associations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {multifamilyObjects.slice(0, 20).map((object) => (
                  <tr key={object.id}>
                    <td className="py-2 pr-3 text-xs text-gray-700">{object.objectType}</td>
                    <td className="py-2 pr-3">
                      <button
                        onClick={() =>
                          setMultifamilyExplorer((prev) => ({
                            ...prev,
                            objectId: object.id,
                          }))
                        }
                        className={`font-semibold ${
                          multifamilyExplorer.objectId === object.id ? 'text-teal underline' : 'text-navy hover:text-teal'
                        }`}
                      >
                        {object.name}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-xs text-brand-gray">{object.description || 'No description'}</td>
                    <td className="py-2 pr-3 text-xs text-brand-gray">
                      Leads {toInt(object.associationCounts?.outboundLead)} | Contacts {toInt(object.associationCounts?.contact)} |
                      Deals {toInt(object.associationCounts?.deal)} | Companies {toInt(object.associationCounts?.company)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border border-gray-100 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-brand-gray">Explorer Object</p>
            <select
              value={multifamilyExplorer.objectId}
              onChange={(event) =>
                setMultifamilyExplorer((prev) => ({
                  ...prev,
                  objectId: event.target.value,
                }))
              }
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs"
            >
              <option value="">Select object</option>
              {multifamilyObjects.map((object) => (
                <option key={object.id} value={object.id}>
                  {object.name} ({object.objectType})
                </option>
              ))}
            </select>

            <select
              value={multifamilyExplorer.entityType}
              onChange={(event) =>
                setMultifamilyExplorer((prev) => ({
                  ...prev,
                  entityType: event.target.value,
                }))
              }
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs"
            >
              {MULTIFAMILY_EXPLORER_ENTITY_TYPES.map((entityType) => (
                <option key={entityType.value} value={entityType.value}>
                  {entityType.label}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={multifamilyExplorer.search}
              onChange={(event) =>
                setMultifamilyExplorer((prev) => ({
                  ...prev,
                  search: event.target.value,
                }))
              }
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs min-w-[180px]"
              placeholder={`Search ${multifamilyExplorer.entityType}s`}
            />
            <button
              onClick={fetchMultifamilyEntities}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 hover:bg-gray-50"
            >
              Search
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-brand-gray">
              {selectedMultifamilyObject
                ? `Selected object: ${selectedMultifamilyObject.name} (${selectedMultifamilyObject.objectType})`
                : 'Select a multifamily object to start bulk tagging.'}
            </p>
            <button
              onClick={handleBulkAssociateExplorerEntities}
              disabled={
                !multifamilyExplorer.objectId ||
                selectedMultifamilyEntityKeys.length === 0 ||
                busyKey === `multifamily-bulk-${multifamilyExplorer.entityType}`
              }
              className="text-xs border border-indigo-200 text-indigo-700 rounded px-2 py-1 hover:bg-indigo-50 disabled:opacity-60"
            >
              {busyKey === `multifamily-bulk-${multifamilyExplorer.entityType}`
                ? 'Tagging...'
                : `Tag Selected (${selectedMultifamilyEntityKeys.length})`}
            </button>
          </div>

          {loadingMultifamilyEntities ? (
            <p className="text-xs text-brand-gray">Loading explorer entities...</p>
          ) : multifamilyEntities.length === 0 ? (
            <p className="text-xs text-brand-gray">No entities found for this search.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-brand-gray">
                    <th className="py-2 pr-2">Select</th>
                    <th className="py-2 pr-2">Name</th>
                    <th className="py-2 pr-2">Context</th>
                    <th className="py-2 pr-2">Current Associations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {multifamilyEntities.slice(0, 40).map((entity) => {
                    const entityKey = multifamilyExplorer.entityType === 'company' ? entity.companyName || entity.id : entity.id
                    return (
                      <tr key={entityKey}>
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={Boolean(multifamilyEntitySelection[entityKey])}
                            onChange={(event) => handleToggleMultifamilyEntitySelection(entityKey, event.target.checked)}
                          />
                        </td>
                        <td className="py-2 pr-2 font-semibold text-navy">
                          {multifamilyExplorer.entityType === 'deal' ? entity.name : entity.name || entity.companyName}
                        </td>
                        <td className="py-2 pr-2 text-brand-gray">
                          {multifamilyExplorer.entityType === 'contact' &&
                            `${entity.email || 'No email'} • ${entity.company || 'No company'}`}
                          {multifamilyExplorer.entityType === 'deal' &&
                            `${entity.stage || 'unknown stage'} • ${entity.company || entity.contactName || 'No linked contact'}`}
                          {multifamilyExplorer.entityType === 'company' &&
                            `Contacts ${toInt(entity.contactCount)} • Leads ${toInt(entity.leadCount)}`}
                        </td>
                        <td className="py-2 pr-2 text-brand-gray">{toInt(entity.associationCount)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-semibold text-navy mb-2">
              Existing {multifamilyExplorer.entityType} associations for selected object
            </p>
            {loadingSelectedObjectAssociations ? (
              <p className="text-xs text-brand-gray">Loading object associations...</p>
            ) : selectedObjectAssociations.length === 0 ? (
              <p className="text-xs text-brand-gray">No associations yet for this object/entity type.</p>
            ) : (
              <div className="space-y-1">
                {selectedObjectAssociations.slice(0, 15).map((association) => (
                  <p key={association.id} className="text-xs text-brand-gray">
                    <span className="font-semibold text-navy">{association.target?.name || association.companyName || 'Unknown'}</span>
                    {association.target?.company ? ` • ${association.target.company}` : ''}
                    {association.target?.email ? ` • ${association.target.email}` : ''}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">Data Quality Command Center</h3>
            <p className="text-xs text-brand-gray mt-0.5">
              Duplicate queue, stale records, and pre-enrollment required-field guardrails.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={dataQualityStatusFilter}
              onChange={(event) => setDataQualityStatusFilter(event.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700"
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
            <button
              onClick={fetchDataQualityIssues}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              Refresh Queue
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Open Issues</p>
            <p className="text-lg font-bold text-navy">{dataQualityOpenCount}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Blocking Enrollment</p>
            <p className="text-lg font-bold text-rose-700">{dataQualityOpenBlockingCount}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Resolved</p>
            <p className="text-lg font-bold text-emerald-700">{dataQualityResolvedCount}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-brand-gray">Merges (30d)</p>
            <p className="text-lg font-bold text-indigo-700">{dataQualityMergeCount30d}</p>
          </div>
        </div>

        {loadingDataQuality ? (
          <p className="text-sm text-brand-gray">Loading data quality issues...</p>
        ) : dataQualityIssues.length === 0 ? (
          <p className="text-sm text-brand-gray">No issues for this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                  <th className="py-2 pr-3">Issue</th>
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {dataQualityIssues.map((issue) => (
                  <tr key={issue.id}>
                    <td className="py-2 pr-3">
                      <p className="font-semibold text-navy">{issue.issueType}</p>
                      <p className="text-xs text-brand-gray">{issue.details?.message || 'No details'}</p>
                    </td>
                    <td className="py-2 pr-3">
                      {issue.lead ? (
                        <>
                          <p className="text-navy">{issue.lead.name}</p>
                          <p className="text-xs text-brand-gray">{issue.lead.email || issue.lead.company || 'No identifier'}</p>
                        </>
                      ) : (
                        <span className="text-xs text-brand-gray">No lead attached</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          issue.severity === 'high'
                            ? 'bg-rose-100 text-rose-700'
                            : issue.severity === 'medium'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {issue.severity}
                      </span>
                      {issue.isBlocking ? <p className="text-[11px] text-rose-700 mt-1">Blocks enrollment</p> : null}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-700">{issue.status}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-2">
                        {issue.status !== 'resolved' && (
                          <button
                            onClick={() => handleDataQualityIssueStatus(issue.id, 'resolved')}
                            disabled={busyKey === `data-quality-${issue.id}-resolved`}
                            className="text-xs border border-emerald-200 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-60"
                          >
                            Resolve
                          </button>
                        )}
                        {issue.status !== 'dismissed' && (
                          <button
                            onClick={() => handleDataQualityIssueStatus(issue.id, 'dismissed')}
                            disabled={busyKey === `data-quality-${issue.id}-dismissed`}
                            className="text-xs border border-gray-200 text-gray-700 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-60"
                          >
                            Dismiss
                          </button>
                        )}
                        {issue.status !== 'open' && (
                          <button
                            onClick={() => handleDataQualityIssueStatus(issue.id, 'open')}
                            disabled={busyKey === `data-quality-${issue.id}-open`}
                            className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-60"
                          >
                            Reopen
                          </button>
                        )}
                        {issue.issueType === 'potential_duplicate' && issue.status === 'open' && (
                          <button
                            onClick={() => handleMergeDuplicateIssue(issue)}
                            disabled={busyKey === `data-quality-merge-${issue.id}`}
                            className="text-xs border border-indigo-200 text-indigo-700 rounded px-2 py-1 hover:bg-indigo-50 disabled:opacity-60"
                          >
                            {busyKey === `data-quality-merge-${issue.id}` ? 'Merging...' : 'Merge Group'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-navy">Recent Merge Operations</p>
            <button
              onClick={fetchDataQualityMergeOperations}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 hover:bg-gray-50"
            >
              Refresh Merges
            </button>
          </div>
          {loadingDataQualityMergeOperations ? (
            <p className="text-xs text-brand-gray mt-2">Loading merge operations...</p>
          ) : dataQualityMergeOperations.length === 0 ? (
            <p className="text-xs text-brand-gray mt-2">No merge operations yet.</p>
          ) : (
            <div className="mt-2 space-y-1">
              {dataQualityMergeOperations.slice(0, 6).map((operation) => (
                <p key={operation.id} className="text-xs text-brand-gray">
                  <span className="font-semibold text-navy">{operation.primaryLead?.name || operation.primaryLeadId || 'Primary lead'}</span>
                  {` merged ${toInt(operation.mergedLeadCount)} lead(s)`}
                  {operation.createdAt ? ` • ${new Date(operation.createdAt).toLocaleString()}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h3 className="text-sm font-semibold text-navy">Campaign Runs</h3>
        <form onSubmit={handleCreateCampaign} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            value={campaignForm.name}
            onChange={(event) => setCampaignForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Campaign name"
            className="md:col-span-2 border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={campaignForm.includeEmail}
              onChange={(event) => setCampaignForm((prev) => ({ ...prev, includeEmail: event.target.checked }))}
            />
            Email
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={campaignForm.includeLinkedIn}
              onChange={(event) => setCampaignForm((prev) => ({ ...prev, includeLinkedIn: event.target.checked }))}
            />
            LinkedIn
          </label>
          <button
            type="submit"
            disabled={busyKey === 'campaign-create'}
            className="bg-navy text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-navy/90 disabled:opacity-60"
          >
            {busyKey === 'campaign-create' ? 'Creating...' : `Create (${leads.length} Leads)`}
          </button>
        </form>

        {loadingCampaigns ? (
          <p className="text-sm text-brand-gray">Loading campaigns...</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-brand-gray">No campaigns yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Channels</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Members</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td className="py-3 pr-3">
                      <p className="font-semibold text-navy">{campaign.name}</p>
                      <p className="text-xs text-brand-gray">
                        Created {new Date(campaign.created_at).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="py-3 pr-3 text-xs text-gray-700">
                      {(Array.isArray(campaign.channels) ? campaign.channels : []).join(', ')}
                    </td>
                    <td className="py-3 pr-3">{renderStatusBadge(campaign.status)}</td>
                    <td className="py-3 pr-3 text-xs text-gray-700">
                      {toInt(campaign.member_count)} total | {toInt(campaign.engaged_count)} engaged
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-2">
                        {campaign.status === 'draft' || campaign.status === 'paused' ? (
                          <button
                            onClick={() => handleCampaignStatus(campaign.id, 'active')}
                            disabled={busyKey === `campaign-status-${campaign.id}-active`}
                            className="text-xs border border-emerald-200 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-60"
                          >
                            Activate
                          </button>
                        ) : null}
                        {campaign.status === 'active' ? (
                          <button
                            onClick={() => handleCampaignStatus(campaign.id, 'paused')}
                            disabled={busyKey === `campaign-status-${campaign.id}-paused`}
                            className="text-xs border border-amber-200 text-amber-700 rounded px-2 py-1 hover:bg-amber-50 disabled:opacity-60"
                          >
                            Pause
                          </button>
                        ) : null}
                        {campaign.status !== 'completed' && campaign.status !== 'archived' ? (
                          <button
                            onClick={() => handleCampaignStatus(campaign.id, 'completed')}
                            disabled={busyKey === `campaign-status-${campaign.id}-completed`}
                            className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-60"
                          >
                            Complete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">Sequence Control Center</h3>
            <p className="text-xs text-brand-gray mt-0.5">
              Enforce one active sequence per lead with pause, resume, and stop controls.
            </p>
          </div>
          <div className="text-xs text-brand-gray">
            Open enrollments:{' '}
            {sequenceEnrollments.filter((item) => item.status === 'active' || item.status === 'paused').length}
          </div>
        </div>

        {loadingSequences || loadingSequenceEnrollments ? (
          <p className="text-sm text-brand-gray">Loading sequence control data...</p>
        ) : sequences.length === 0 ? (
          <p className="text-sm text-brand-gray">
            No sequences found. Create one in the Sequences page before enrolling leads.
          </p>
        ) : sequenceEnrollments.length === 0 ? (
          <p className="text-sm text-brand-gray">No sequence enrollments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">Sequence</th>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2 pr-3">Step</th>
                  <th className="py-2 pr-3">Updated</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sequenceEnrollments.map((enrollment) => (
                  <tr key={enrollment.id}>
                    <td className="py-3 pr-3">
                      <p className="font-semibold text-navy">{enrollment.lead_name}</p>
                      <p className="text-xs text-brand-gray">{enrollment.lead_email || 'No email'}</p>
                    </td>
                    <td className="py-3 pr-3">{enrollment.sequence_name}</td>
                    <td className="py-3 pr-3">{renderStatusBadge(enrollment.status)}</td>
                    <td className="py-3 pr-3 text-xs text-gray-700">
                      {toInt(enrollment.current_step)} / {toInt(enrollment.total_steps)}
                    </td>
                    <td className="py-3 pr-3 text-xs text-brand-gray">
                      {enrollment.updated_at ? new Date(enrollment.updated_at).toLocaleString() : '-'}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-2">
                        {enrollment.status === 'active' && (
                          <button
                            onClick={() => handleSequenceStateChange(enrollment, 'paused')}
                            disabled={busyKey === `sequence-state-${enrollment.id}-paused`}
                            className="text-xs border border-amber-200 text-amber-700 rounded px-2 py-1 hover:bg-amber-50 disabled:opacity-60"
                          >
                            Pause
                          </button>
                        )}
                        {enrollment.status === 'paused' && (
                          <button
                            onClick={() => handleSequenceStateChange(enrollment, 'active')}
                            disabled={busyKey === `sequence-state-${enrollment.id}-active`}
                            className="text-xs border border-emerald-200 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-60"
                          >
                            Resume
                          </button>
                        )}
                        {(enrollment.status === 'active' || enrollment.status === 'paused') && (
                          <button
                            onClick={() => handleSequenceStateChange(enrollment, 'stopped')}
                            disabled={busyKey === `sequence-state-${enrollment.id}-stopped`}
                            className="text-xs border border-rose-200 text-rose-700 rounded px-2 py-1 hover:bg-rose-50 disabled:opacity-60"
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">Workflow Rules</h3>
            <p className="text-xs text-brand-gray mt-0.5">
              Trigger outbound actions from behavioral events with if/else automation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={ruleTestLeadId}
              onChange={(event) => setRuleTestLeadId(event.target.value)}
              className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700"
            >
              <option value="">No lead context</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <form onSubmit={handleCreateWorkflowRule} className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input
            type="text"
            value={workflowForm.name}
            onChange={(event) => setWorkflowForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Rule name"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm md:col-span-2"
          />
          <select
            value={workflowForm.triggerEvent}
            onChange={(event) => setWorkflowForm((prev) => ({ ...prev, triggerEvent: event.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {WORKFLOW_TRIGGER_EVENTS.map((eventType) => (
              <option key={eventType} value={eventType}>
                {eventType}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={workflowForm.conditionField}
            onChange={(event) => setWorkflowForm((prev) => ({ ...prev, conditionField: event.target.value }))}
            placeholder="Condition field (e.g. lead.total_score)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={workflowForm.conditionOp}
            onChange={(event) => setWorkflowForm((prev) => ({ ...prev, conditionOp: event.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {CONDITION_OPERATORS.map((operator) => (
              <option key={operator.value} value={operator.value}>
                {operator.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={workflowForm.conditionValue}
            onChange={(event) => setWorkflowForm((prev) => ({ ...prev, conditionValue: event.target.value }))}
            placeholder="Condition value"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />

          <select
            value={workflowForm.trueActionType}
            onChange={(event) => setWorkflowForm((prev) => ({ ...prev, trueActionType: event.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {WORKFLOW_ACTION_TYPES.map((action) => (
              <option key={action.value} value={action.value}>
                If true: {action.label}
              </option>
            ))}
          </select>
          {workflowForm.trueActionType === 'enroll_sequence' ? (
            <select
              value={workflowForm.trueActionValue}
              onChange={(event) => setWorkflowForm((prev) => ({ ...prev, trueActionValue: event.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select sequence id</option>
              {sequences.map((sequence) => (
                <option key={sequence.id} value={sequence.id}>
                  {sequence.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={workflowForm.trueActionValue}
              onChange={(event) => setWorkflowForm((prev) => ({ ...prev, trueActionValue: event.target.value }))}
              placeholder="True action value"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          )}

          <select
            value={workflowForm.falseActionType}
            onChange={(event) => setWorkflowForm((prev) => ({ ...prev, falseActionType: event.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Else: no action</option>
            {WORKFLOW_ACTION_TYPES.map((action) => (
              <option key={action.value} value={action.value}>
                Else: {action.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={workflowForm.falseActionValue}
            onChange={(event) => setWorkflowForm((prev) => ({ ...prev, falseActionValue: event.target.value }))}
            placeholder="False action value"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busyKey === 'workflow-create'}
            className="bg-navy text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-navy/90 disabled:opacity-60"
          >
            {busyKey === 'workflow-create' ? 'Creating...' : 'Create Rule'}
          </button>
        </form>

        {loadingWorkflowRules ? (
          <p className="text-sm text-brand-gray">Loading workflow rules...</p>
        ) : workflowRules.length === 0 ? (
          <p className="text-sm text-brand-gray">No workflow rules yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                  <th className="py-2 pr-3">Rule</th>
                  <th className="py-2 pr-3">Trigger</th>
                  <th className="py-2 pr-3">Enabled</th>
                  <th className="py-2 pr-3">Last Test</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {workflowRules.map((rule) => (
                  <tr key={rule.id}>
                    <td className="py-3 pr-3">
                      <p className="font-semibold text-navy">{rule.name}</p>
                      <p className="text-xs text-brand-gray">{rule.description || 'No description'}</p>
                    </td>
                    <td className="py-3 pr-3 text-xs text-gray-700">{rule.trigger_event}</td>
                    <td className="py-3 pr-3">
                      {rule.enabled ? (
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                          enabled
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700">
                          disabled
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-xs text-brand-gray">
                      {rule.last_tested_at ? new Date(rule.last_tested_at).toLocaleString() : 'Never'}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleToggleWorkflowRule(rule)}
                          disabled={busyKey === `workflow-toggle-${rule.id}`}
                          className="text-xs border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-60"
                        >
                          {rule.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => handleTestWorkflowRule(rule, false)}
                          disabled={busyKey === `workflow-test-${rule.id}-dry`}
                          className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-60"
                        >
                          Dry Run
                        </button>
                        <button
                          onClick={() => handleTestWorkflowRule(rule, true)}
                          disabled={busyKey === `workflow-test-${rule.id}-live`}
                          className="text-xs border border-amber-200 text-amber-700 rounded px-2 py-1 hover:bg-amber-50 disabled:opacity-60"
                        >
                          Run Live
                        </button>
                      </div>
                      {ruleTestResultById[rule.id] && (
                        <p className="mt-1 text-xs text-brand-gray">
                          Last run: {ruleTestResultById[rule.id].status} | matched:{' '}
                          {String(Boolean(ruleTestResultById[rule.id].matched))}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
            onClick={fetchLeads}
            className="border border-teal text-teal rounded-lg px-3 py-2 text-sm font-semibold hover:bg-teal/5"
          >
            Apply Filters
          </button>
        </div>

        {loadingLeads || loadingAnalytics ? (
          <div className="text-sm text-brand-gray">Loading outbound data...</div>
        ) : leads.length === 0 ? (
          <div className="text-sm text-brand-gray">No leads found with the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">Company</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="py-3 pr-3">
                      <p className="font-semibold text-navy">{lead.name}</p>
                      <p className="text-xs text-brand-gray">{lead.email || 'No email'}</p>
                      {toInt(lead.open_issue_count) > 0 ? (
                        <p className="text-xs text-amber-700 mt-1">
                          Data quality issues: {toInt(lead.open_issue_count)}
                          {toInt(lead.open_blocking_issue_count) > 0 ? ` (${toInt(lead.open_blocking_issue_count)} blocking)` : ''}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3">
                      <p className="text-navy">{lead.company || 'Unknown company'}</p>
                      <p className="text-xs text-brand-gray">{lead.title || 'No title'}</p>
                    </td>
                    <td className="py-3 pr-3">
                      <p className="font-semibold text-navy">{toInt(lead.total_score)}</p>
                      <p className="text-xs text-brand-gray">
                        Fit {toInt(lead.fit_score)} | Intent {toInt(lead.intent_score)}
                      </p>
                    </td>
                    <td className="py-3 pr-3">{renderStatusBadge(lead.status)}</td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleRescoreLead(lead.id)}
                          disabled={busyKey === `score-${lead.id}`}
                          className="text-xs border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-60"
                        >
                          Rescore
                        </button>
                        {sequences.length > 0 && (
                          <>
                            <select
                              value={selectedSequenceByLead[lead.id] || ''}
                              onChange={(event) =>
                                setSelectedSequenceByLead((prev) => ({
                                  ...prev,
                                  [lead.id]: event.target.value,
                                }))
                              }
                              className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700"
                            >
                              <option value="">Select sequence</option>
                              {sequences
                                .filter((sequence) => toInt(sequence.step_count) > 0)
                                .map((sequence) => (
                                  <option key={sequence.id} value={sequence.id}>
                                    {sequence.name}
                                  </option>
                                ))}
                            </select>
                            <button
                              onClick={() => handleEnrollLeadInSequence(lead.id)}
                              disabled={
                                busyKey === `enroll-sequence-${lead.id}` ||
                                !selectedSequenceByLead[lead.id] ||
                                Boolean(openEnrollmentByLead[lead.id]) ||
                                toInt(lead.open_blocking_issue_count) > 0
                              }
                              className="text-xs border border-indigo-200 text-indigo-700 rounded px-2 py-1 hover:bg-indigo-50 disabled:opacity-60"
                              title={
                                openEnrollmentByLead[lead.id]
                                  ? `Already enrolled in ${openEnrollmentByLead[lead.id].sequence_name}`
                                  : toInt(lead.open_blocking_issue_count) > 0
                                  ? 'Fix blocking data quality issues before enrollment.'
                                  : ''
                              }
                            >
                              {openEnrollmentByLead[lead.id]
                                ? 'Enrolled'
                                : toInt(lead.open_blocking_issue_count) > 0
                                ? 'Blocked'
                                : 'Enroll'}
                            </button>
                          </>
                        )}
                        {multifamilyObjects.length > 0 && (
                          <>
                            <select
                              value={leadObjectSelection[lead.id]?.objectType || 'portfolio'}
                              onChange={(event) =>
                                setLeadObjectSelection((prev) => ({
                                  ...prev,
                                  [lead.id]: {
                                    objectType: event.target.value,
                                    objectId: '',
                                  },
                                }))
                              }
                              className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700"
                            >
                              {MULTIFAMILY_OBJECT_TYPES.map((typeOption) => (
                                <option key={typeOption.value} value={typeOption.value}>
                                  {typeOption.label}
                                </option>
                              ))}
                            </select>
                            <select
                              value={leadObjectSelection[lead.id]?.objectId || ''}
                              onChange={(event) =>
                                setLeadObjectSelection((prev) => ({
                                  ...prev,
                                  [lead.id]: {
                                    objectType: prev[lead.id]?.objectType || 'portfolio',
                                    objectId: event.target.value,
                                  },
                                }))
                              }
                              className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700"
                            >
                              <option value="">Select object</option>
                              {(multifamilyObjectsByType[leadObjectSelection[lead.id]?.objectType || 'portfolio'] || []).map((object) => (
                                <option key={object.id} value={object.id}>
                                  {object.name}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => handleAssociateObjectToLead(lead.id)}
                              disabled={
                                busyKey === `multifamily-associate-${lead.id}` ||
                                !Boolean(leadObjectSelection[lead.id]?.objectId)
                              }
                              className="text-xs border border-slate-200 text-slate-700 rounded px-2 py-1 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Tag
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleGenerateDraft(lead, 'email')}
                          disabled={busyKey === `draft-email-${lead.id}`}
                          className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-60"
                        >
                          Draft Email
                        </button>
                        <button
                          onClick={() => handleGenerateDraft(lead, 'linkedin')}
                          disabled={busyKey === `draft-linkedin-${lead.id}`}
                          className="text-xs border border-amber-200 text-amber-700 rounded px-2 py-1 hover:bg-amber-50 disabled:opacity-60"
                        >
                          Draft LinkedIn
                        </button>
                        {lead.status === 'suppressed' ? (
                          <button
                            onClick={() => handleSuppression(lead, false)}
                            disabled={busyKey === `suppression-${lead.id}-off`}
                            className="text-xs border border-emerald-200 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-60"
                          >
                            Unsuppress
                          </button>
                        ) : (
                          <button
                            onClick={() => handleSuppression(lead, true)}
                            disabled={busyKey === `suppression-${lead.id}-on`}
                            className="text-xs border border-rose-200 text-rose-700 rounded px-2 py-1 hover:bg-rose-50 disabled:opacity-60"
                          >
                            Suppress
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-sm font-semibold text-navy mb-4">Session Drafts</h3>
        {sessionDrafts.length === 0 ? (
          <p className="text-sm text-brand-gray">No drafts generated in this session yet.</p>
        ) : (
          <div className="space-y-3">
            {sessionDrafts.map((draft) => (
              <div key={draft.id} className="border border-gray-100 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-navy">
                      {draft.channel === 'linkedin' ? 'LinkedIn' : 'Email'} draft for {draft.leadName}
                    </p>
                    <p className="text-xs text-brand-gray">
                      Draft status: {draft.status}
                      {draft.channel === 'linkedin' && draft.linkedinTaskStatus
                        ? ` | LinkedIn task: ${draft.linkedinTaskStatus}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {draft.status === 'drafted' && (
                      <button
                        onClick={() => handleApproveDraft(draft.id)}
                        disabled={busyKey === `approve-${draft.id}`}
                        className="text-xs border border-emerald-200 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-60"
                      >
                        Approve
                      </button>
                    )}
                    {draft.channel === 'linkedin' &&
                      draft.status === 'approved' &&
                      draft.linkedinTaskStatus !== 'completed' && (
                        <button
                          onClick={() => handleCompleteLinkedInTask(draft)}
                          disabled={busyKey === `complete-task-${draft.linkedinTaskId}`}
                          className="text-xs border border-purple-200 text-purple-700 rounded px-2 py-1 hover:bg-purple-50 disabled:opacity-60"
                        >
                          Complete Task
                        </button>
                      )}
                    {draft.channel === 'email' && draft.status === 'approved' && (
                      <button
                        onClick={() => handleSendEmailDraft(draft)}
                        disabled={busyKey === `send-email-${draft.id}`}
                        className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-60"
                      >
                        Mark Sent
                      </button>
                    )}
                  </div>
                </div>

                {draft.subject && <p className="text-xs text-brand-gray mt-2">Subject: {draft.subject}</p>}
                <p className="text-xs text-gray-600 mt-2 whitespace-pre-wrap line-clamp-3">{draft.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
