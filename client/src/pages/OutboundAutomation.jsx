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
      await Promise.all([fetchLeads(), fetchAnalytics()])
    })
  }

  const handleRescoreLead = async (leadId) => {
    await runAction(`score-${leadId}`, async () => {
      await axios.post(`/api/outbound/leads/${leadId}/score`, {}, authHeaders)
      setMessage('Lead rescored.')
      await Promise.all([fetchLeads(), fetchAnalytics()])
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
      await fetchAnalytics()
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
      await fetchAnalytics()
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
      await Promise.all([fetchLeads(), fetchAnalytics()])
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
      await Promise.all([fetchLeads(), fetchAnalytics()])
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
        },
        leadIds: leads.map((lead) => lead.id),
      }

      const { data } = await axios.post('/api/outbound/campaigns', payload, authHeaders)
      setCampaignForm((prev) => ({ ...prev, name: '' }))
      setMessage(`Campaign created: ${data.name} (${data.addedMembers} members).`)
      await Promise.all([fetchCampaigns(), fetchAnalytics()])
    })
  }

  const handleCampaignStatus = async (campaignId, status) => {
    await runAction(`campaign-status-${campaignId}-${status}`, async () => {
      await axios.patch(`/api/outbound/campaigns/${campaignId}/status`, { status }, authHeaders)
      setMessage(`Campaign status updated to ${status}.`)
      await Promise.all([fetchCampaigns(), fetchAnalytics()])
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
      await Promise.all([fetchSequenceEnrollments(), fetchLeads(), fetchAnalytics()])
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
      await Promise.all([fetchSequenceEnrollments(), fetchLeads(), fetchAnalytics()])
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

      await Promise.all([fetchWorkflowRules(), fetchLeads(), fetchAnalytics(), fetchSequenceEnrollments()])
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
      await Promise.all([fetchLeads(), fetchAnalytics(), fetchCampaigns(), fetchSequenceEnrollments()])
    })
  }

  const leadsStats = analytics?.leads || {}
  const emailLimit = analytics?.dailySendLimits?.email
  const linkedinLimit = analytics?.dailySendLimits?.linkedin
  const campaignStats = analytics?.campaigns || {}
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
                                Boolean(openEnrollmentByLead[lead.id])
                              }
                              className="text-xs border border-indigo-200 text-indigo-700 rounded px-2 py-1 hover:bg-indigo-50 disabled:opacity-60"
                              title={
                                openEnrollmentByLead[lead.id]
                                  ? `Already enrolled in ${openEnrollmentByLead[lead.id].sequence_name}`
                                  : ''
                              }
                            >
                              {openEnrollmentByLead[lead.id] ? 'Enrolled' : 'Enroll'}
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
