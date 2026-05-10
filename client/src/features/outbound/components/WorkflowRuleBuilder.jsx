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

const CONDITION_OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'gte', label: 'Greater Than or Equal' },
  { value: 'lt', label: 'Less Than' },
  { value: 'lte', label: 'Less Than or Equal' },
  { value: 'contains', label: 'Contains' },
]

const WORKFLOW_ACTION_TYPES = [
  { value: 'update_lead_status', label: 'Update Lead Status' },
  { value: 'set_next_recommended_action', label: 'Set Next Action' },
  { value: 'create_reminder', label: 'Create Reminder' },
  { value: 'suppress_lead', label: 'Suppress Lead' },
  { value: 'log_event', label: 'Log Event' },
  { value: 'enroll_sequence', label: 'Enroll Sequence' },
]

export default function WorkflowRuleBuilder({
  workflowRules,
  workflowForm,
  setWorkflowForm,
  sequences,
  leads,
  loadingWorkflowRules,
  busyKey,
  ruleTestLeadId,
  setRuleTestLeadId,
  ruleTestResultById,
  handleCreateWorkflowRule,
  handleToggleWorkflowRule,
  handleTestWorkflowRule,
}) {
  return (
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
  )
}
