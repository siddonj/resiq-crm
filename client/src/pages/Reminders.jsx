import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const EMPTY_FORM = { message: '', remind_at: '', contact_id: '', deal_id: '' }

function formatDate(dt) {
  if (!dt) return ''
  const d = new Date(dt)
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function isOverdue(remind_at) {
  return new Date(remind_at) < new Date()
}

export default function Reminders() {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [reminders, setReminders] = useState([])
  const [contacts, setContacts] = useState([])
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('upcoming') // upcoming | all
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const fetchReminders = async () => {
    const params = tab === 'upcoming' ? { completed: false } : {}
    const res = await axios.get('/api/reminders', { ...headers, params })
    setReminders(res.data)
  }

  useEffect(() => {
    Promise.all([
      fetchReminders(),
      axios.get('/api/contacts', headers).then(r => setContacts(r.data)),
      axios.get('/api/deals', headers).then(r => setDeals(r.data)),
    ]).finally(() => setLoading(false))
  }, [tab])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    setSaving(true)
    try {
      await axios.post('/api/reminders', {
        ...form,
        contact_id: form.contact_id || null,
        deal_id: form.deal_id || null,
      }, headers)
      setForm(EMPTY_FORM)
      setShowForm(false)
      fetchReminders()
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleComplete = async (id, completed) => {
    await axios.patch(`/api/reminders/${id}/complete`, { completed: !completed }, headers)
    setReminders(prev => prev.map(r => r.id === id ? { ...r, completed: !r.completed } : r))
  }

  const handleDelete = async (id) => {
    await axios.delete(`/api/reminders/${id}`, headers)
    setReminders(prev => prev.filter(r => r.id !== id))
  }

  const displayed = tab === 'upcoming'
    ? reminders.filter(r => !r.completed).sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))
    : reminders.sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))

  const dueCount = reminders.filter(r => !r.completed && isOverdue(r.remind_at)).length

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-navy font-syne">Reminders</h2>
          {dueCount > 0 && (
            <p className="text-sm text-red-500 mt-1">{dueCount} overdue</p>
          )}
        </div>
        <button
          onClick={() => { setShowForm(true); setForm(EMPTY_FORM); setFormError('') }}
          className="px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 transition-colors"
        >
          + New Reminder
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {['upcoming', 'all'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${tab === t ? 'bg-white text-navy shadow-sm' : 'text-brand-gray hover:text-navy'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-brand-gray">Loading...</p>
      ) : displayed.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-brand-gray">
          {tab === 'upcoming' ? 'No upcoming reminders.' : 'No reminders yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map(r => {
            const overdue = !r.completed && isOverdue(r.remind_at)
            return (
              <div
                key={r.id}
                className={`bg-white rounded-xl border p-4 flex items-start gap-3 ${overdue ? 'border-red-200 bg-red-50/30' : 'border-gray-200'} ${r.completed ? 'opacity-60' : ''}`}
              >
                <button
                  onClick={() => handleComplete(r.id, r.completed)}
                  className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 transition-colors ${r.completed ? 'bg-teal border-teal' : overdue ? 'border-red-400 hover:bg-red-100' : 'border-gray-300 hover:border-teal'}`}
                >
                  {r.completed && <span className="text-white text-xs flex items-center justify-center w-full h-full">✓</span>}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${r.completed ? 'line-through text-brand-gray' : 'text-navy'}`}>{r.message}</p>
                  <div className="flex flex-wrap gap-x-3 mt-1">
                    <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-brand-gray'}`}>
                      {overdue ? 'Overdue · ' : ''}{formatDate(r.remind_at)}
                    </span>
                    {r.contact_name && <span className="text-xs text-brand-gray">Contact: {r.contact_name}</span>}
                    {r.deal_title && <span className="text-xs text-brand-gray">Deal: {r.deal_title}</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="text-gray-300 hover:text-red-500 text-sm transition-colors flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-syne text-lg font-bold text-navy">New Reminder</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {formError && <p className="text-sm text-red-500">{formError}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message *</label>
                <input
                  type="text"
                  value={form.message}
                  onChange={e => setForm({ ...form, message: e.target.value })}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. Follow up with client"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Remind At *</label>
                <input
                  type="datetime-local"
                  value={form.remind_at}
                  onChange={e => setForm({ ...form, remind_at: e.target.value })}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contact (optional)</label>
                  <select
                    value={form.contact_id}
                    onChange={e => setForm({ ...form, contact_id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">None</option>
                    {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Deal (optional)</label>
                  <select
                    value={form.deal_id}
                    onChange={e => setForm({ ...form, deal_id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">None</option>
                    {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-gray-200 text-gray-600 text-sm py-2 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-teal text-white text-sm font-medium py-2 rounded-lg hover:bg-teal/90 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Reminder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
