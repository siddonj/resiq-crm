import { useState, useEffect } from 'react'
import axios from 'axios'

const TRIGGER_TYPES = [
  { value: 'deal.stage_changed', label: 'Deal Stage Changed' },
  { value: 'deal.created', label: 'Deal Created' },
  { value: 'contact.created', label: 'Contact Created' },
]

const ACTION_TYPES = [
  { value: 'create_task', label: 'Create Task' },
  { value: 'create_activity', label: 'Create Activity' },
]

const DEAL_STAGES = ['lead', 'contact_made', 'proposal_sent', 'negotiation', 'won', 'lost']

export default function WorkflowBuilderModal({ workflow, onSave, onClose, token }) {
  const [step, setStep] = useState(1) // 1: name, 2: trigger, 3: actions, 4: review
  const [formData, setFormData] = useState({
    name: workflow?.name || '',
    description: workflow?.description || '',
    triggerType: workflow?.trigger_type || 'deal.stage_changed',
    triggerConfig: workflow?.trigger_config || {},
    conditions: workflow?.conditions || null,
    actions: workflow?.actions || [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [availableTags, setAvailableTags] = useState([])

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  // Fetch available tags when modal opens
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const res = await axios.get('/api/contacts/tags', authHeaders)
        setAvailableTags(res.data)
      } catch (err) {
        console.error('Error fetching tags:', err)
      }
    }
    fetchTags()
  }, [])

  // Step 1: Name & Description
  const renderNameStep = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Workflow Name *
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={e => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Auto-create task on deal won"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Description (optional)
        </label>
        <textarea
          value={formData.description}
          onChange={e => setFormData({ ...formData, description: e.target.value })}
          placeholder="What does this workflow do?"
          rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal resize-none"
        />
      </div>
    </div>
  )

  // Step 2: Trigger Selection
  const renderTriggerStep = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-3">
          What triggers this workflow? *
        </label>
        <div className="space-y-2">
          {TRIGGER_TYPES.map(t => (
            <label key={t.value} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
              style={{ borderColor: formData.triggerType === t.value ? 'rgb(20, 184, 166)' : undefined, backgroundColor: formData.triggerType === t.value ? 'rgb(240, 253, 250)' : undefined }}
            >
              <input
                type="radio"
                name="trigger"
                value={t.value}
                checked={formData.triggerType === t.value}
                onChange={e => setFormData({ ...formData, triggerType: e.target.value, triggerConfig: {} })}
                className="text-teal"
              />
              <span className="text-sm font-medium text-navy">{t.label}</span>
            </label>
          ))}
        </div>
      </div>

      {formData.triggerType === 'deal.stage_changed' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Which stage? (optional - will match any stage if empty)
          </label>
          <select
            value={formData.triggerConfig.stage || ''}
            onChange={e => setFormData({
              ...formData,
              triggerConfig: { ...formData.triggerConfig, stage: e.target.value || undefined }
            })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal bg-white"
          >
            <option value="">— Any stage —</option>
            {DEAL_STAGES.map(s => (
              <option key={s} value={s}>{s.replace(/_/g, ' ').charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
      )}

      {formData.triggerType === 'contact.created' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-3">
            Additional Conditions (optional)
          </label>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Add conditions to only trigger this workflow for contacts with specific tags.
            </p>
            {formData.conditions && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-blue-900">
                    Contact must have tag: <strong>{formData.conditions.value}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, conditions: null })}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
            {!formData.conditions && availableTags.length > 0 && (
              <select
                onChange={e => {
                  if (e.target.value) {
                    setFormData({
                      ...formData,
                      conditions: { field: 'contact.tags', op: 'contains', value: e.target.value }
                    })
                  }
                }}
                value=""
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal bg-white"
              >
                <option value="">— Select a tag to require —</option>
                {availableTags.map(tag => (
                  <option key={tag.id} value={tag.name}>{tag.name}</option>
                ))}
              </select>
            )}
            {!formData.conditions && availableTags.length === 0 && (
              <p className="text-xs text-gray-500 italic">Create tags in the Contacts section to add conditions here.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )

  // Step 3: Actions
  const renderActionsStep = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-medium text-navy">Actions</h4>
        <button
          type="button"
          onClick={() => setFormData({
            ...formData,
            actions: [...formData.actions, { type: 'create_task', title: '', due_days: 3 }]
          })}
          className="text-xs bg-teal/10 text-teal hover:bg-teal/20 px-3 py-1.5 rounded transition-colors"
        >
          + Add Action
        </button>
      </div>

      {formData.actions.length === 0 ? (
        <p className="text-sm text-brand-gray py-4">No actions yet. Click "Add Action" to get started.</p>
      ) : (
        <div className="space-y-4">
          {formData.actions.map((action, idx) => (
            <div key={idx} className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              <div className="flex items-start justify-between mb-3">
                <select
                  value={action.type}
                  onChange={e => {
                    const newActions = [...formData.actions]
                    newActions[idx] = { type: e.target.value }
                    setFormData({ ...formData, actions: newActions })
                  }}
                  className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal"
                >
                  {ACTION_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setFormData({
                    ...formData,
                    actions: formData.actions.filter((_, i) => i !== idx)
                  })}
                  className="text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  Remove
                </button>
              </div>

              {action.type === 'create_task' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Task Title *</label>
                    <input
                      type="text"
                      value={action.title || ''}
                      onChange={e => {
                        const newActions = [...formData.actions]
                        newActions[idx].title = e.target.value
                        setFormData({ ...formData, actions: newActions })
                      }}
                      placeholder="e.g., Send contract for review"
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Due in (days)</label>
                    <input
                      type="number"
                      value={action.due_days || 3}
                      onChange={e => {
                        const newActions = [...formData.actions]
                        newActions[idx].due_days = parseInt(e.target.value) || 0
                        setFormData({ ...formData, actions: newActions })
                      }}
                      min="0"
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    />
                  </div>
                </div>
              )}

              {action.type === 'create_activity' && (
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Activity Description</label>
                  <input
                    type="text"
                    value={action.description || ''}
                    onChange={e => {
                      const newActions = [...formData.actions]
                      newActions[idx].description = e.target.value
                      setFormData({ ...formData, actions: newActions })
                    }}
                    placeholder="e.g., Workflow auto-logged"
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // Step 4: Review
  const renderReviewStep = () => (
    <div className="space-y-6">
      <div className="p-4 bg-gray-50 rounded-lg">
        <p className="text-sm font-medium text-navy mb-2">Workflow Summary</p>
        <div className="space-y-2 text-sm text-gray-600">
          <p><strong>Name:</strong> {formData.name}</p>
          {formData.description && <p><strong>Description:</strong> {formData.description}</p>}
          <p>
            <strong>Trigger:</strong> {TRIGGER_TYPES.find(t => t.value === formData.triggerType)?.label}
            {formData.triggerConfig.stage && ` → ${formData.triggerConfig.stage}`}
          </p>
          {formData.conditions && (
            <p><strong>Condition:</strong> Contact must have tag "{formData.conditions.value}"</p>
          )}
          <p><strong>Actions:</strong> {formData.actions.length}</p>
        </div>
      </div>

      {formData.actions.length > 0 && (
        <div>
          <p className="text-sm font-medium text-navy mb-3">Actions to Execute</p>
          <div className="space-y-2">
            {formData.actions.map((action, idx) => (
              <div key={idx} className="text-sm text-gray-600 pl-4 border-l-2 border-teal">
                {action.type === 'create_task' && `Create task: "${action.title}" (due in ${action.due_days} days)`}
                {action.type === 'create_activity' && `Create activity: "${action.description || 'Workflow auto-logged'}"`}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        This workflow will be active immediately and will execute for all matching events.
      </div>
    </div>
  )

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError('Workflow name is required')
      return
    }

    if (formData.actions.length === 0) {
      setError('At least one action is required')
      return
    }

    setSaving(true)
    try {
      if (workflow) {
        await axios.patch(`/api/workflows/${workflow.id}`, formData, authHeaders)
      } else {
        await axios.post('/api/workflows', formData, authHeaders)
      }
      onSave()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save workflow')
    } finally {
      setSaving(false)
    }
  }

  const isStepValid = () => {
    if (step === 1) return formData.name.trim().length > 0
    if (step === 2) return formData.triggerType
    if (step === 3) return formData.actions.length > 0
    return true
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="sticky top-0 px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white">
          <h3 className="font-syne text-lg font-bold text-navy">
            {workflow ? 'Edit Workflow' : 'New Workflow'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            &times;
          </button>
        </div>

        {/* Progress */}
        <div className="px-6 pt-5 pb-3">
          <div className="flex gap-2">
            {[1, 2, 3, 4].map(s => (
              <div
                key={s}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  s <= step ? 'bg-teal' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <div className="text-xs text-brand-gray mt-2">
            Step {step} of 4: {step === 1 && 'Details'} {step === 2 && 'Trigger'} {step === 3 && 'Actions'} {step === 4 && 'Review'}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-5">
          {error && (
            <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">
              {error}
            </div>
          )}

          {step === 1 && renderNameStep()}
          {step === 2 && renderTriggerStep()}
          {step === 3 && renderActionsStep()}
          {step === 4 && renderReviewStep()}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 px-6 py-4 border-t border-gray-100 bg-white flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>

          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="flex-1 border border-gray-200 text-navy text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Back
            </button>
          )}

          {step < 4 && (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={!isStepValid()}
              className="flex-1 bg-teal text-white text-sm font-semibold py-2 rounded-lg hover:bg-teal/90 transition-colors disabled:opacity-60"
            >
              Next
            </button>
          )}

          {step === 4 && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isStepValid()}
              className="flex-1 bg-teal text-white text-sm font-semibold py-2 rounded-lg hover:bg-teal/90 transition-colors disabled:opacity-60"
            >
              {saving ? 'Saving...' : workflow ? 'Save Changes' : 'Create Workflow'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
