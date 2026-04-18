import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const TYPES = ['call', 'meeting', 'email', 'note', 'task']

const TYPE_ICONS = {
  call: '📞',
  meeting: '🤝',
  email: '✉️',
  note: '📝',
  task: '✅',
}

export default function ActivityLog({ contactId, dealId }) {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState('call')
  const [description, setDescription] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchActivities = async () => {
    const params = {}
    if (contactId) params.contact_id = contactId
    if (dealId) params.deal_id = dealId
    const res = await axios.get('/api/activities', { ...headers, params })
    setActivities(res.data)
  }

  useEffect(() => {
    fetchActivities().finally(() => setLoading(false))
  }, [contactId, dealId])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await axios.post('/api/activities', {
        type,
        description,
        contact_id: contactId || null,
        deal_id: dealId || null,
        occurred_at: occurredAt || undefined,
      }, headers)
      setDescription('')
      setOccurredAt('')
      setShowForm(false)
      fetchActivities()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log activity')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    await axios.delete(`/api/activities/${id}`, headers)
    setActivities(prev => prev.filter(a => a.id !== id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-navy">Activity Log</h4>
        <button
          onClick={() => setShowForm(v => !v)}
          className="text-xs text-teal hover:underline"
        >
          {showForm ? 'Cancel' : '+ Log Activity'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 p-3 bg-gray-50 rounded-lg space-y-3">
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white text-navy"
            >
              {TYPES.map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={e => setOccurredAt(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
              placeholder="Now"
            />
          </div>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            required
            rows={2}
            placeholder="What happened?"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
          />
          <button
            type="submit"
            disabled={saving}
            className="w-full py-1.5 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Log Activity'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-brand-gray">Loading...</p>
      ) : activities.length === 0 ? (
        <p className="text-xs text-brand-gray">No activities logged yet.</p>
      ) : (
        <div className="space-y-2">
          {activities.map(a => (
            <div key={a.id} className="flex items-start gap-2 group">
              <span className="text-sm mt-0.5 flex-shrink-0">{TYPE_ICONS[a.type] || '📌'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-navy">{a.description}</p>
                <p className="text-xs text-brand-gray mt-0.5">
                  {new Date(a.occurred_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  {a.contact_name && ` · ${a.contact_name}`}
                  {a.deal_title && ` · ${a.deal_title}`}
                </p>
              </div>
              <button
                onClick={() => handleDelete(a.id)}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-xs transition-opacity flex-shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
