import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { outboundApi } from '../api/outboundApi'

const QK = {
  analytics: ['outbound', 'analytics'],
  leads: (filters) => ['outbound', 'leads', filters],
  draftInbox: ['outbound', 'draftInbox'],
  linkedinTaskBoard: ['outbound', 'linkedinTaskBoard'],
  savedViews: ['outbound', 'savedViews'],
  slaAlerts: ['outbound', 'slaAlerts'],
  campaigns: ['outbound', 'campaigns'],
  sequences: ['outbound', 'sequences'],
  sequenceEnrollments: ['outbound', 'sequenceEnrollments'],
  workflowRules: ['outbound', 'workflowRules'],
  forecastSummary: (period) => ['outbound', 'forecast', period],
  attributionSummary: (period) => ['outbound', 'attribution', period],
  dataQualityIssues: (status) => ['outbound', 'dataQualityIssues', status],
  dataQualityMergeOps: ['outbound', 'dataQualityMergeOps'],
  multifamilyObjects: ['outbound', 'multifamilyObjects'],
  multifamilySummary: ['outbound', 'multifamilySummary'],
  multifamilyEntities: (entityType, search) => ['outbound', 'multifamilyEntities', entityType, search],
  objectAssociations: (objectId, entityType) => ['outbound', 'objectAssociations', objectId, entityType],
  workspaceConfig: ['outbound', 'workspaceConfig'],
  escalationRules: ['outbound', 'escalationRules'],
  notifications: ['outbound', 'notifications'],
}

export function useOutboundAnalytics(token) {
  return useQuery({
    queryKey: QK.analytics,
    queryFn: () => outboundApi.getAnalytics(token).then((r) => r.data),
    enabled: !!token,
  })
}

export function useOutboundLeads(token, filters) {
  return useInfiniteQuery({
    queryKey: QK.leads(filters),
    queryFn: ({ pageParam = null }) =>
      outboundApi.getLeads(token, { ...filters, cursor: pageParam }).then((r) => ({
        leads: r.data.leads ?? [],
        nextCursor: r.data.nextCursor ?? null,
      })),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!token,
    initialPageParam: null,
  })
}

export function useRescoreLead(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId) => outboundApi.rescoreLead(token, leadId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useBulkAction(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadIds, actionType, payload }) =>
      outboundApi.bulkAction(token, leadIds, actionType, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.slaAlerts })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.sequenceEnrollments })
    },
  })
}

export function useSuppressLead(token) {
  const qc = useQueryClient()
  const leadsKey = ['outbound', 'leads']
  return useMutation({
    mutationFn: ({ leadId, suppressed, reason }) =>
      outboundApi.suppressLead(token, leadId, suppressed, reason),
    onMutate: async ({ leadId, suppressed, reason }) => {
      await qc.cancelQueries({ queryKey: leadsKey })
      const previous = qc.getQueryData(leadsKey)
      qc.setQueryData(leadsKey, (old) => {
        if (!Array.isArray(old)) return old
        return old.map((lead) =>
          lead.id === leadId
            ? {
                ...lead,
                status: suppressed ? 'suppressed' : 'new',
                suppression_reason: suppressed ? reason : null,
                updated_at: new Date().toISOString(),
              }
            : lead
        )
      })
      return { previous }
    },
    onError: (err, variables, context) => {
      if (context?.previous) {
        qc.setQueryData(leadsKey, context.previous)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: leadsKey })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.campaigns })
      qc.invalidateQueries({ queryKey: QK.sequenceEnrollments })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useImportCsv(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, importConfig }) => outboundApi.importCsv(token, file, importConfig),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useGenerateDraft(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, channel }) => outboundApi.generateDraft(token, leadId, channel),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useApproveDraft(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (draftId) => outboundApi.approveDraft(token, draftId),
    onMutate: async (draftId) => {
      await qc.cancelQueries({ queryKey: QK.draftInbox })
      const previous = qc.getQueryData(QK.draftInbox)
      qc.setQueryData(QK.draftInbox, (old) => {
        if (!old || !Array.isArray(old.drafts)) return old
        return {
          ...old,
          drafts: old.drafts.map((d) =>
            d.id === draftId ? { ...d, status: 'approved', approvedAt: new Date().toISOString() } : d
          ),
        }
      })
      return { previous }
    },
    onError: (err, draftId, context) => {
      if (context?.previous) {
        qc.setQueryData(QK.draftInbox, context.previous)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useSendDraft(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (draftId) => outboundApi.sendDraft(token, draftId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useDraftInbox(token) {
  return useQuery({
    queryKey: QK.draftInbox,
    queryFn: () => outboundApi.getDraftInbox(token).then((r) => r.data),
    enabled: !!token,
  })
}

export function useLinkedinTaskBoard(token) {
  return useQuery({
    queryKey: QK.linkedinTaskBoard,
    queryFn: () => outboundApi.getLinkedinTaskBoard(token).then((r) => r.data),
    enabled: !!token,
  })
}

export function useCompleteLinkedinTask(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, notes }) => outboundApi.completeLinkedinTask(token, taskId, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useRebalanceLinkedinTasks(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => outboundApi.rebalanceLinkedinTasks(token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
    },
  })
}

export function useSavedViews(token) {
  return useQuery({
    queryKey: QK.savedViews,
    queryFn: () => outboundApi.getSavedViews(token).then((r) => r.data.views ?? []),
    enabled: !!token,
  })
}

export function useCreateSavedView(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) => outboundApi.createSavedView(token, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.savedViews }),
  })
}

export function useDeleteSavedView(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (viewId) => outboundApi.deleteSavedView(token, viewId),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.savedViews }),
  })
}

export function useSlaAlerts(token) {
  return useQuery({
    queryKey: QK.slaAlerts,
    queryFn: () => outboundApi.getSlaAlerts(token).then((r) => r.data),
    enabled: !!token,
  })
}

export function useEscalationRules(token) {
  return useQuery({
    queryKey: QK.escalationRules,
    queryFn: () => outboundApi.getEscalationRules(token).then((r) => r.data ?? []),
    enabled: !!token,
  })
}

export function useCreateEscalation(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (escalationType) => outboundApi.createEscalation(token, escalationType),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.escalationRules }),
  })
}

export function useToggleEscalation(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ruleId, isEnabled }) => outboundApi.toggleEscalation(token, ruleId, isEnabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.escalationRules }),
  })
}

export function useRunEscalations(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => outboundApi.runEscalations(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.notifications }),
  })
}

export function useCampaigns(token) {
  return useQuery({
    queryKey: QK.campaigns,
    queryFn: () => outboundApi.getCampaigns(token).then((r) => r.data.campaigns ?? []),
    enabled: !!token,
  })
}

export function useCreateCampaign(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) => outboundApi.createCampaign(token, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.campaigns })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useUpdateCampaignStatus(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ campaignId, status }) =>
      outboundApi.updateCampaignStatus(token, campaignId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.campaigns })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useSequences(token) {
  return useQuery({
    queryKey: QK.sequences,
    queryFn: () => outboundApi.getSequences(token).then((r) => r.data.sequences ?? []),
    enabled: !!token,
  })
}

export function useSequenceEnrollments(token) {
  return useQuery({
    queryKey: QK.sequenceEnrollments,
    queryFn: () => outboundApi.getSequenceEnrollments(token).then((r) => r.data.enrollments ?? []),
    enabled: !!token,
  })
}

export function useEnrollInSequence(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sequenceId, leadId }) =>
      outboundApi.enrollInSequence(token, sequenceId, leadId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.sequenceEnrollments })
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useChangeSequenceState(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ enrollmentId, state, reason }) =>
      outboundApi.changeSequenceState(token, enrollmentId, state, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.sequenceEnrollments })
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useBulkSequenceEnroll(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadIds, sequenceId }) =>
      outboundApi.bulkSequenceEnroll(token, leadIds, sequenceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.sequenceEnrollments })
    },
  })
}

export function useBulkSequenceUnenroll(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadIds) => outboundApi.bulkSequenceUnenroll(token, leadIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.sequenceEnrollments })
    },
  })
}

export function useWorkflowRules(token) {
  return useQuery({
    queryKey: QK.workflowRules,
    queryFn: () => outboundApi.getWorkflowRules(token).then((r) => r.data.rules ?? []),
    enabled: !!token,
  })
}

export function useCreateWorkflowRule(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) => outboundApi.createWorkflowRule(token, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.workflowRules })
    },
  })
}

export function useToggleWorkflowRule(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ruleId, enabled }) => outboundApi.toggleWorkflowRule(token, ruleId, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.workflowRules }),
  })
}

export function useTestWorkflowRule(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ruleId, leadId, applyActions }) =>
      outboundApi.testWorkflowRule(token, ruleId, leadId, applyActions),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.workflowRules })
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.sequenceEnrollments })
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
    },
  })
}

export function useForecastSummary(token, period) {
  return useQuery({
    queryKey: QK.forecastSummary(period),
    queryFn: () => outboundApi.getForecastSummary(token, period).then((r) => r.data),
    enabled: !!token,
  })
}

export function useSaveForecastGoals(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) => outboundApi.saveForecastGoals(token, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.forecastSummary })
      qc.invalidateQueries({ queryKey: QK.attributionSummary })
      qc.invalidateQueries({ queryKey: QK.dataQualityIssues })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
    },
  })
}

export function useAttributionSummary(token, period) {
  return useQuery({
    queryKey: QK.attributionSummary(period),
    queryFn: () => outboundApi.getAttributionSummary(token, period).then((r) => r.data),
    enabled: !!token,
  })
}

export function useDataQualityIssues(token, statusFilter) {
  return useQuery({
    queryKey: QK.dataQualityIssues(statusFilter),
    queryFn: () => outboundApi.getDataQualityIssues(token, statusFilter).then((r) => r.data),
    enabled: !!token,
  })
}

export function useUpdateDataQualityIssueStatus(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ issueId, status }) =>
      outboundApi.updateDataQualityIssueStatus(token, issueId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound', 'dataQualityIssues'] })
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
    },
  })
}

export function useMergeDuplicateIssue(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ issueId, primaryLeadId, duplicateLeadIds }) =>
      outboundApi.mergeDuplicateIssue(token, issueId, primaryLeadId, duplicateLeadIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound', 'dataQualityIssues'] })
      qc.invalidateQueries({ queryKey: QK.dataQualityMergeOps })
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.draftInbox })
      qc.invalidateQueries({ queryKey: QK.linkedinTaskBoard })
      qc.invalidateQueries({ queryKey: QK.analytics })
      qc.invalidateQueries({ queryKey: QK.campaigns })
      qc.invalidateQueries({ queryKey: QK.sequenceEnrollments })
      qc.invalidateQueries({ queryKey: QK.multifamilyObjects })
      qc.invalidateQueries({ queryKey: QK.multifamilyEntities })
      qc.invalidateQueries({ queryKey: QK.objectAssociations })
    },
  })
}

export function useDataQualityMergeOperations(token) {
  return useQuery({
    queryKey: QK.dataQualityMergeOps,
    queryFn: () => outboundApi.getDataQualityMergeOperations(token).then((r) => r.data.mergeOperations ?? []),
    enabled: !!token,
  })
}

export function useMultifamilyObjects(token) {
  return useQuery({
    queryKey: QK.multifamilyObjects,
    queryFn: () => outboundApi.getMultifamilyObjects(token).then((r) => r.data.objects ?? []),
    enabled: !!token,
  })
}

export function useMultifamilySummary(token) {
  return useQuery({
    queryKey: QK.multifamilySummary,
    queryFn: () => outboundApi.getMultifamilySummary(token).then((r) => r.data),
    enabled: !!token,
  })
}

export function useCreateMultifamilyObject(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) => outboundApi.createMultifamilyObject(token, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.multifamilyObjects }),
  })
}

export function useMultifamilyEntities(token, entityType, search) {
  return useQuery({
    queryKey: QK.multifamilyEntities(entityType, search),
    queryFn: () => outboundApi.getMultifamilyEntities(token, entityType, search).then((r) => r.data.entities ?? []),
    enabled: !!token && !!entityType,
  })
}

export function useObjectAssociations(token, objectId, entityType) {
  return useQuery({
    queryKey: QK.objectAssociations(objectId, entityType),
    queryFn: () => outboundApi.getObjectAssociations(token, objectId, entityType).then((r) => r.data.associations ?? []),
    enabled: !!token && !!objectId,
  })
}

export function useAssociateToObject(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ objectId, payload }) => outboundApi.associateToObject(token, objectId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.multifamilyObjects })
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.objectAssociations })
    },
  })
}

export function useBulkAssociateExplorerEntities(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ objectId, payload }) =>
      outboundApi.bulkAssociateExplorerEntities(token, objectId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.objectAssociations })
      qc.invalidateQueries({ queryKey: QK.multifamilyObjects })
    },
  })
}

export function useBulkMultifamilyTag(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadIds, objectId }) => outboundApi.bulkMultifamilyTag(token, leadIds, objectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound', 'leads'] })
      qc.invalidateQueries({ queryKey: QK.multifamilyObjects })
    },
  })
}

export function useWorkspaceConfig(token) {
  return useQuery({
    queryKey: QK.workspaceConfig,
    queryFn: () => outboundApi.getWorkspaceConfig(token).then((r) => r.data),
    enabled: !!token,
  })
}

export function useSaveWorkspaceConfig(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) => outboundApi.saveWorkspaceConfig(token, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.workspaceConfig }),
  })
}

export function useNotifications(token) {
  return useQuery({
    queryKey: QK.notifications,
    queryFn: () => outboundApi.getNotifications(token).then((r) => r.data),
    enabled: !!token,
  })
}

export function useMarkNotificationRead(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (notifId) => outboundApi.markNotificationRead(token, notifId),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.notifications }),
  })
}

export function useMarkAllNotificationsRead(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => outboundApi.markAllNotificationsRead(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.notifications }),
  })
}
