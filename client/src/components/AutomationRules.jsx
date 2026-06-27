import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const STAGE_LABELS = {
  lead: 'Lead',
  qualified: 'Qualified',
  proposal: 'Proposal',
  active: 'Active',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
}

const STAGE_OPTIONS = Object.entries(STAGE_LABELS)

const EMPTY_FORM = {
  rule_name: '',
  stage: 'lead',
  inactivity_days: 7,
  email_template: '',
  enabled: true,
}

export default function AutomationRules() {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Add form state
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_FORM)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  // Edit state: id -> form data
  const [editing, setEditing] = useState(null) // rule id being edited
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState(null) // rule id

  useEffect(() => {
    loadRules()
  }, [])

  async function loadRules() {
    setLoading(true)
    setError('')
    try {
      const res = await axios.get('/api/automation/rules', headers)
      const fetched = res.data
      if (fetched.length === 0) {
        // Seed defaults for first-time users (enabled: false so nothing fires until opted in)
        const seedRes = await axios.post('/api/automation/seed-defaults', {}, headers)
        setRules(seedRes.data)
      } else {
        setRules(fetched)
      }
    } catch (err) {
      setError('Failed to load automation rules.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleEnabled(rule) {
    try {
      const updated = await axios.patch(
        `/api/automation/rules/${rule.id}`,
        { enabled: !rule.enabled },
        headers
      )
      setRules(prev => prev.map(r => (r.id === rule.id ? updated.data : r)))
    } catch (err) {
      console.error('Toggle failed', err)
    }
  }

  async function handleAddSubmit(e) {
    e.preventDefault()
    setAddError('')
    setAddSaving(true)
    try {
      const res = await axios.post('/api/automation/rules', addForm, headers)
      setRules(prev => [...prev, res.data])
      setShowAdd(false)
      setAddForm(EMPTY_FORM)
    } catch (err) {
      setAddError(err.response?.data?.error || 'Failed to create rule.')
    } finally {
      setAddSaving(false)
    }
  }

  function startEdit(rule) {
    setEditing(rule.id)
    setEditForm({
      rule_name: rule.rule_name,
      stage: rule.stage,
      inactivity_days: rule.inactivity_days,
      email_template: rule.email_template,
      enabled: rule.enabled,
    })
    setEditError('')
  }

  async function handleEditSubmit(e, ruleId) {
    e.preventDefault()
    setEditError('')
    setEditSaving(true)
    try {
      const res = await axios.patch(`/api/automation/rules/${ruleId}`, editForm, headers)
      setRules(prev => prev.map(r => (r.id === ruleId ? res.data : r)))
      setEditing(null)
    } catch (err) {
      setEditError(err.response?.data?.error || 'Failed to update rule.')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(ruleId) {
    try {
      await axios.delete(`/api/automation/rules/${ruleId}`, headers)
      setRules(prev => prev.filter(r => r.id !== ruleId))
      setConfirmDelete(null)
    } catch (err) {
      console.error('Delete failed', err)
    }
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal'
  const btnCls = 'px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors'
  const btnOutlineCls = 'px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors'
  const btnDangerCls = 'px-3 py-1.5 bg-red-50 text-red-600 text-xs font-medium rounded-lg hover:bg-red-100 transition-colors'

  if (loading) {
    return <p className="text-sm text-gray-500">Loading automation rules...</p>
  }

  if (error) {
    return (
      <div className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg p-3">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">
            When a deal sits in a stage with no activity for the configured number of days,
            a draft follow-up email task is automatically created for your review.
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddError('') }}
          className={btnCls}
        >
          + Add Rule
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h4 className="text-sm font-semibold text-navy mb-4">New Automation Rule</h4>
          {addError && <p className="text-xs text-red-500 mb-3">{addError}</p>}
          <form onSubmit={handleAddSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rule Name</label>
                <input
                  type="text"
                  value={addForm.rule_name}
                  onChange={e => setAddForm(f => ({ ...f, rule_name: e.target.value }))}
                  required
                  className={inputCls}
                  placeholder="e.g. Proposal Nudge"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Stage</label>
                <select
                  value={addForm.stage}
                  onChange={e => setAddForm(f => ({ ...f, stage: e.target.value }))}
                  className={inputCls}
                >
                  {STAGE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Inactivity Threshold (days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={addForm.inactivity_days}
                onChange={e => setAddForm(f => ({ ...f, inactivity_days: parseInt(e.target.value, 10) || 7 }))}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Email Template
                <span className="ml-1 text-gray-400 font-normal">
                  (use {'{{contact_name}}'}, {'{{deal_title}}'}, {'{{days_since_activity}}'})
                </span>
              </label>
              <textarea
                value={addForm.email_template}
                onChange={e => setAddForm(f => ({ ...f, email_template: e.target.value }))}
                required
                rows={5}
                className={inputCls + ' resize-y'}
                placeholder="<p>Hi {{contact_name}},</p>..."
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={addSaving} className={btnCls}>
                {addSaving ? 'Creating...' : 'Create Rule'}
              </button>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setAddForm(EMPTY_FORM) }}
                className={btnOutlineCls}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rules list */}
      {rules.length === 0 && !showAdd && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">
          No automation rules yet. Click "Add Rule" to create your first one.
        </div>
      )}

      {rules.map(rule => (
        <div key={rule.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {/* Rule header */}
          <div className="flex items-center gap-4 p-4">
            {/* Enabled toggle */}
            <button
              type="button"
              onClick={() => handleToggleEnabled(rule)}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                rule.enabled ? 'bg-teal' : 'bg-gray-200'
              }`}
              role="switch"
              aria-checked={rule.enabled}
              title={rule.enabled ? 'Disable rule' : 'Enable rule'}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                  rule.enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-navy">{rule.rule_name}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                  {STAGE_LABELS[rule.stage] || rule.stage}
                </span>
                <span className="text-xs text-gray-500">
                  after {rule.inactivity_days} day{rule.inactivity_days !== 1 ? 's' : ''} of inactivity
                </span>
                {!rule.enabled && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                    Disabled
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => editing === rule.id ? setEditing(null) : startEdit(rule)}
                className="text-xs text-gray-500 hover:text-navy underline"
              >
                {editing === rule.id ? 'Close' : 'Edit'}
              </button>
              {confirmDelete === rule.id ? (
                <span className="flex items-center gap-1">
                  <button onClick={() => handleDelete(rule.id)} className={btnDangerCls}>
                    Confirm
                  </button>
                  <button onClick={() => setConfirmDelete(null)} className="text-xs text-gray-400 hover:text-gray-600 px-2">
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDelete(rule.id)}
                  className="text-xs text-gray-400 hover:text-red-500"
                >
                  Delete
                </button>
              )}
            </div>
          </div>

          {/* Inline edit form */}
          {editing === rule.id && (
            <div className="border-t border-gray-100 bg-gray-50 p-4">
              {editError && <p className="text-xs text-red-500 mb-3">{editError}</p>}
              <form onSubmit={e => handleEditSubmit(e, rule.id)} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Rule Name</label>
                    <input
                      type="text"
                      value={editForm.rule_name}
                      onChange={e => setEditForm(f => ({ ...f, rule_name: e.target.value }))}
                      required
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Stage</label>
                    <select
                      value={editForm.stage}
                      onChange={e => setEditForm(f => ({ ...f, stage: e.target.value }))}
                      className={inputCls}
                    >
                      {STAGE_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Inactivity Threshold (days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={editForm.inactivity_days}
                    onChange={e => setEditForm(f => ({ ...f, inactivity_days: parseInt(e.target.value, 10) || 7 }))}
                    required
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Email Template
                    <span className="ml-1 text-gray-400 font-normal">
                      (use {'{{contact_name}}'}, {'{{deal_title}}'}, {'{{days_since_activity}}'})
                    </span>
                  </label>
                  <textarea
                    value={editForm.email_template}
                    onChange={e => setEditForm(f => ({ ...f, email_template: e.target.value }))}
                    required
                    rows={5}
                    className={inputCls + ' resize-y'}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={editSaving} className={btnCls}>
                    {editSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className={btnOutlineCls}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
