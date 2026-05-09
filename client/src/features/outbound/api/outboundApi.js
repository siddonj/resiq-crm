import axios from 'axios'

function getAuthHeaders(token) {
  return {
    headers: { Authorization: `Bearer ${token}` },
  }
}

export const outboundApi = {
  // Analytics
  getAnalytics: (token) =>
    axios.get('/api/outbound/analytics/summary', getAuthHeaders(token)),

  // Leads
  getLeads: (token, filters) => {
    const params = new URLSearchParams()
    if (filters.status) params.append('status', filters.status)
    if (filters.search) params.append('search', filters.search)
    if (filters.objectType) params.append('objectType', filters.objectType)
    if (filters.objectId) params.append('objectId', filters.objectId)
    if (filters.cursor) params.append('cursor', filters.cursor)
    params.append('minScore', String(filters.minScore))
    params.append('limit', String(filters.limit))
    return axios.get(`/api/outbound/leads?${params.toString()}`, getAuthHeaders(token))
  },

  rescoreLead: (token, leadId) =>
    axios.post(`/api/outbound/leads/${leadId}/score`, {}, getAuthHeaders(token)),

  bulkAction: (token, leadIds, actionType, payload) =>
    axios.post(
      '/api/outbound/leads/bulk',
      { leadIds, actionType, payload },
      getAuthHeaders(token)
    ),

  suppressLead: (token, leadId, suppressed, reason) =>
    axios.patch(
      `/api/outbound/leads/${leadId}/suppression`,
      { suppressed, reason: suppressed ? reason : null },
      getAuthHeaders(token)
    ),

  // Import
  importCsv: (token, file, importConfig) => {
    const form = new FormData()
    form.append('file', file)
    form.append('sourceType', importConfig.sourceType)
    form.append('sourceReference', importConfig.sourceReference)
    form.append('sourceConfidence', String(importConfig.sourceConfidence))
    return axios.post('/api/outbound/leads/import/csv', form, getAuthHeaders(token))
  },

  // Drafts
  generateDraft: (token, leadId, channel) =>
    axios.post(
      '/api/outbound/drafts/generate',
      { leadId, channel },
      getAuthHeaders(token)
    ),

  approveDraft: (token, draftId) =>
    axios.patch(`/api/outbound/drafts/${draftId}/approve`, {}, getAuthHeaders(token)),

  sendDraft: (token, draftId) =>
    axios.post(`/api/outbound/drafts/${draftId}/send`, {}, getAuthHeaders(token)),

  getDraftInbox: (token) =>
    axios.get('/api/outbound/drafts/inbox?limit=200', getAuthHeaders(token)),

  // LinkedIn Tasks
  getLinkedinTaskBoard: (token) =>
    axios.get('/api/outbound/linkedin/tasks/board?limit=200', getAuthHeaders(token)),

  completeLinkedinTask: (token, taskId, notes) =>
    axios.post(
      `/api/outbound/linkedin/tasks/${taskId}/complete`,
      { notes: notes || 'Completed from outbound automation page.' },
      getAuthHeaders(token)
    ),

  rebalanceLinkedinTasks: (token) =>
    axios.post('/api/outbound/linkedin/tasks/rebalance', {}, getAuthHeaders(token)),

  // Saved Views
  getSavedViews: (token, scope = 'outbound_leads') =>
    axios.get(`/api/outbound/saved-views?scope=${scope}`, getAuthHeaders(token)),

  createSavedView: (token, payload) =>
    axios.post('/api/outbound/saved-views', payload, getAuthHeaders(token)),

  deleteSavedView: (token, viewId) =>
    axios.delete(`/api/outbound/saved-views/${viewId}`, getAuthHeaders(token)),

  // SLA
  getSlaAlerts: (token) =>
    axios.get('/api/outbound/sla/alerts', getAuthHeaders(token)),

  getEscalationRules: (token) =>
    axios.get('/api/outbound/sla/escalations', getAuthHeaders(token)),

  createEscalation: (token, escalationType) =>
    axios.post('/api/outbound/sla/escalations', { escalationType }, getAuthHeaders(token)),

  toggleEscalation: (token, ruleId, isEnabled) =>
    axios.patch(`/api/outbound/sla/escalations/${ruleId}`, { isEnabled }, getAuthHeaders(token)),

  runEscalations: (token) =>
    axios.post('/api/outbound/sla/escalations/run', {}, getAuthHeaders(token)),

  // Campaigns
  getCampaigns: (token) =>
    axios.get('/api/outbound/campaigns?limit=100', getAuthHeaders(token)),

  createCampaign: (token, payload) =>
    axios.post('/api/outbound/campaigns', payload, getAuthHeaders(token)),

  updateCampaignStatus: (token, campaignId, status) =>
    axios.patch(`/api/outbound/campaigns/${campaignId}/status`, { status }, getAuthHeaders(token)),

  // Sequences
  getSequences: (token) =>
    axios.get('/api/outbound/sequences', getAuthHeaders(token)),

  getSequenceEnrollments: (token) =>
    axios.get('/api/outbound/sequences/enrollments?limit=200', getAuthHeaders(token)),

  enrollInSequence: (token, sequenceId, leadId) =>
    axios.post(
      `/api/outbound/sequences/${sequenceId}/enroll`,
      { leadId },
      getAuthHeaders(token)
    ),

  changeSequenceState: (token, enrollmentId, state, reason) =>
    axios.patch(
      `/api/outbound/sequences/enrollments/${enrollmentId}/state`,
      { state, reason },
      getAuthHeaders(token)
    ),

  bulkSequenceEnroll: (token, leadIds, sequenceId) =>
    axios.post(
      '/api/outbound/bulk/sequence-enroll',
      { leadIds, sequenceId },
      getAuthHeaders(token)
    ),

  bulkSequenceUnenroll: (token, leadIds) =>
    axios.post(
      '/api/outbound/bulk/sequence-unenroll',
      { leadIds },
      getAuthHeaders(token)
    ),

  // Workflow Rules
  getWorkflowRules: (token) =>
    axios.get('/api/outbound/workflows/rules?includeDisabled=true', getAuthHeaders(token)),

  createWorkflowRule: (token, payload) =>
    axios.post('/api/outbound/workflows/rules', payload, getAuthHeaders(token)),

  toggleWorkflowRule: (token, ruleId, enabled) =>
    axios.patch(`/api/outbound/workflows/rules/${ruleId}`, { enabled }, getAuthHeaders(token)),

  testWorkflowRule: (token, ruleId, leadId, applyActions) =>
    axios.post(
      `/api/outbound/workflows/rules/${ruleId}/test`,
      { leadId, applyActions, eventData: { source: 'outbound_ui' } },
      getAuthHeaders(token)
    ),

  // Forecast
  getForecastSummary: (token, period = 'monthly') =>
    axios.get(`/api/outbound/forecast/summary?period=${period}`, getAuthHeaders(token)),

  saveForecastGoals: (token, payload) =>
    axios.put('/api/outbound/forecast/goals', payload, getAuthHeaders(token)),

  // Attribution
  getAttributionSummary: (token, period = 'monthly') =>
    axios.get(`/api/outbound/attribution/summary?period=${period}`, getAuthHeaders(token)),

  // Data Quality
  getDataQualityIssues: (token, statusFilter = 'open') =>
    axios.get(
      `/api/outbound/data-quality/issues?status=${encodeURIComponent(statusFilter)}&limit=200`,
      getAuthHeaders(token)
    ),

  updateDataQualityIssueStatus: (token, issueId, status) =>
    axios.patch(
      `/api/outbound/data-quality/issues/${issueId}/status`,
      { status },
      getAuthHeaders(token)
    ),

  mergeDuplicateIssue: (token, issueId, primaryLeadId, duplicateLeadIds) =>
    axios.post(
      `/api/outbound/data-quality/issues/${issueId}/merge`,
      { primaryLeadId, duplicateLeadIds },
      getAuthHeaders(token)
    ),

  getDataQualityMergeOperations: (token) =>
    axios.get('/api/outbound/data-quality/merge-operations?limit=50', getAuthHeaders(token)),

  // Multifamily
  getMultifamilyObjects: (token) =>
    axios.get('/api/outbound/multifamily/objects', getAuthHeaders(token)),

  getMultifamilySummary: (token) =>
    axios.get('/api/outbound/multifamily/summary', getAuthHeaders(token)),

  createMultifamilyObject: (token, payload) =>
    axios.post('/api/outbound/multifamily/objects', payload, getAuthHeaders(token)),

  getMultifamilyEntities: (token, entityType, search = '') => {
    const params = new URLSearchParams()
    params.append('entityType', entityType)
    params.append('limit', '100')
    if (search) params.append('search', search)
    return axios.get(`/api/outbound/multifamily/entities?${params.toString()}`, getAuthHeaders(token))
  },

  getObjectAssociations: (token, objectId, entityType) => {
    const params = new URLSearchParams()
    params.append('entityType', entityType)
    return axios.get(
      `/api/outbound/multifamily/objects/${objectId}/associations?${params.toString()}`,
      getAuthHeaders(token)
    )
  },

  associateToObject: (token, objectId, payload) =>
    axios.post(
      `/api/outbound/multifamily/objects/${objectId}/associations`,
      payload,
      getAuthHeaders(token)
    ),

  bulkAssociateExplorerEntities: (token, objectId, payload) =>
    axios.post(
      `/api/outbound/multifamily/objects/${objectId}/associations/bulk`,
      payload,
      getAuthHeaders(token)
    ),

  bulkMultifamilyTag: (token, leadIds, objectId) =>
    axios.post(
      '/api/outbound/bulk/multifamily-tag',
      { leadIds, objectId },
      getAuthHeaders(token)
    ),

  // Workspace
  getWorkspaceConfig: (token) =>
    axios.get('/api/outbound/workspace/config', getAuthHeaders(token)),

  saveWorkspaceConfig: (token, payload) =>
    axios.put('/api/outbound/workspace/config', payload, getAuthHeaders(token)),

  // Notifications
  getNotifications: (token) =>
    axios.get('/api/outbound/notifications', getAuthHeaders(token)),

  markNotificationRead: (token, notifId) =>
    axios.patch(`/api/outbound/notifications/${notifId}/read`, {}, getAuthHeaders(token)),

  markAllNotificationsRead: (token) =>
    axios.post('/api/outbound/notifications/read-all', {}, getAuthHeaders(token)),

  // Export
  exportEvents: (token) =>
    axios.get('/api/outbound/events/export?format=csv&days=30&limit=5000', {
      ...getAuthHeaders(token),
      responseType: 'blob',
    }),

  exportAudit: (token) =>
    axios.get('/api/outbound/audit/export?format=csv&days=30&limit=5000', {
      ...getAuthHeaders(token),
      responseType: 'blob',
    }),
}
