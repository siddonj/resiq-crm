import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import ShareModal from '../components/ShareModal'
import ActivityLog from '../components/ActivityLog'

const STAGES = [
  { key: 'lead', label: 'Lead' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'active', label: 'Active' },
  { key: 'closed_won', label: 'Closed Won' },
  { key: 'closed_lost', label: 'Closed Lost' },
]

const SERVICE_LINES = [
  { value: 'managed_wifi', label: 'Managed WiFi' },
  { value: 'proptech_selection', label: 'PropTech Selection' },
  { value: 'fractional_it', label: 'Fractional IT' },
  { value: 'vendor_rfp', label: 'Vendor RFP' },
  { value: 'ai_automation', label: 'AI Automation' },
  { value: 'team_process', label: 'Team Process' },
]

const EMPTY_FORM = { title: '', contact_id: '', stage: 'lead', value: '', service_line: '', close_date: '', notes: '' }

export default function Pipeline() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [deals, setDeals] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [draggedDeal, setDraggedDeal] = useState(null)
  const [sharingDeal, setSharingDeal] = useState(null)
  const [activityDeal, setActivityDeal] = useState(null)
  const [search, setSearch] = useState('')
  const [filterServiceLine, setFilterServiceLine] = useState('')

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  const fetchDeals = () => {
    const params = {}
    if (search) params.search = search
    if (filterServiceLine) params.service_line = filterServiceLine
    axios.get('/api/deals', { ...authHeaders, params })
      .then(r => setDeals(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  const handleExport = async () => {
    const params = {}
    if (search) params.search = search
    if (filterServiceLine) params.service_line = filterServiceLine
    const res = await axios.get('/api/deals/export', { ...authHeaders, params, responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = 'deals.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const fetchContacts = () => {
    axios.get('/api/contacts', authHeaders)
      .then(r => setContacts(r.data))
      .catch(console.error)
  }

  useEffect(() => {
    fetchDeals()
    fetchContacts()
  }, [token, search, filterServiceLine])

  const dealsByStage = (stage) => deals.filter(d => d.stage === stage)


  const openModal = () => { setForm(EMPTY_FORM); setFormError(''); setEditingId(null); setShowModal(true) }
  const openEdit = (d) => {
    setForm({
      title: d.title,
      contact_id: d.contact_id || '',
      stage: d.stage,
      value: d.value || '',
      service_line: d.service_line || '',
      close_date: d.close_date || '',
      notes: d.notes || ''
    })
    setFormError('')
    setEditingId(d.id)
    setShowModal(true)
  }
  const closeModal = () => setShowModal(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setFormError('Title is required'); return }
    setSaving(true)
    setFormError('')
    try {
      const payload = {
        ...form,
        value: form.value ? Number(form.value) : null,
        service_line: form.service_line || null,
        close_date: form.close_date || null,
        contact_id: form.contact_id || null
      }
      if (editingId) {
        const { data } = await axios.put(`/api/deals/${editingId}`, payload, authHeaders)
        setDeals(prev => prev.map(d => d.id === editingId ? data : d))
      } else {
        const { data } = await axios.post('/api/deals', payload, authHeaders)
        setDeals(prev => [data, ...prev])
      }
      closeModal()
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save deal')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this deal?')) return
    try {
      await axios.delete(`/api/deals/${id}`, authHeaders)
      setDeals(prev => prev.filter(d => d.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  const moveToStage = async (dealId, newStage) => {
    try {
      const { data } = await axios.patch(`/api/deals/${dealId}/stage`, { stage: newStage }, authHeaders)
      setDeals(prev => prev.map(d => d.id === dealId ? data : d))
    } catch (err) {
      console.error(err)
    }
  }

  const handleDragStart = (e, deal) => {
    setDraggedDeal(deal)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e, stageKey) => {
    e.preventDefault()
    if (draggedDeal && draggedDeal.stage !== stageKey) {
      moveToStage(draggedDeal.id, stageKey)
    }
    setDraggedDeal(null)
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-syne text-2xl font-bold text-navy">Pipeline</h2>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={openModal}
            className="bg-teal text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-teal/90 transition-colors"
          >
            + Add Deal
          </button>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Search deals..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 max-w-xs border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
        />
        <select
          value={filterServiceLine}
          onChange={e => setFilterServiceLine(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal"
        >
          <option value="">All Service Lines</option>
          {SERVICE_LINES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-brand-gray text-sm">Loading...</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map(({ key, label }) => (
            <div
              key={key}
              className="flex-shrink-0 w-64"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, key)}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-brand-gray uppercase tracking-wide">{label}</span>
                <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{dealsByStage(key).length}</span>
              </div>
              <div className="space-y-2 min-h-[300px] bg-gray-50 rounded-lg p-2">
                {dealsByStage(key).length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-lg h-full flex items-center justify-center">
                    <p className="text-xs text-gray-300">No deals</p>
                  </div>
                ) : (
                  dealsByStage(key).map(deal => {
                    const contact = contacts.find(c => c.id === deal.contact_id)
                    return (
                      <div
                        key={deal.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, deal)}
                        className="bg-white rounded-lg shadow-sm p-3 border border-gray-100 cursor-move hover:shadow-md transition-shadow group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="font-medium text-navy text-sm">{deal.title}</p>
                            {contact && (
                              <p className="text-brand-gray text-xs mt-0.5">{contact.name}</p>
                            )}
                          </div>
                          <button
                            onClick={() => handleDelete(deal.id)}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 text-sm transition-opacity"
                          >
                            ✕
                          </button>
                        </div>
                        {deal.value && (
                          <p className="text-teal text-xs font-semibold mt-2">${Number(deal.value).toLocaleString()}</p>
                        )}
                        {deal.service_line && (
                          <p className="text-brand-gray text-xs mt-1 capitalize">{SERVICE_LINES.find(s => s.value === deal.service_line)?.label || deal.service_line}</p>
                        )}
                        {deal.close_date && (
                          <p className="text-gray-400 text-xs mt-1">{new Date(deal.close_date).toLocaleDateString()}</p>
                        )}
                        <div className="mt-2 flex items-center gap-3">
                          <button
                            onClick={() => setActivityDeal(deal)}
                            className="text-xs text-gray-400 hover:text-teal transition-colors"
                          >
                            Log
                          </button>
                          {deal.access_permission === 'edit' && (
                            <button
                              onClick={() => openEdit(deal)}
                              className="text-xs text-gray-400 hover:text-teal transition-colors"
                            >
                              Edit
                            </button>
                          )}
                          {deal.is_owner && (
                            <button
                              onClick={() => setSharingDeal(deal)}
                              className="text-xs text-gray-400 hover:text-teal transition-colors"
                            >
                              Share
                            </button>
                          )}
                          <button
                            onClick={() => navigate(`/proposals?deal_id=${deal.id}`)}
                            className="text-xs text-gray-400 hover:text-teal transition-colors"
                          >
                            Proposals
                          </button>
                          {!deal.is_owner && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">Shared</span>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Activity Modal */}
      {activityDeal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-syne text-lg font-bold text-navy">Activity — {activityDeal.title}</h3>
              <button onClick={() => setActivityDeal(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="px-6 py-5">
              <ActivityLog dealId={activityDeal.id} />
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {sharingDeal && (
        <ShareModal
          resourceType="deal"
          resourceId={sharingDeal.id}
          resourceName={sharingDeal.title}
          onClose={() => setSharingDeal(null)}
        />
      )}

      {/* Add/Edit Deal Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-syne text-lg font-bold text-navy">{editingId ? 'Edit Deal' : 'New Deal'}</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {formError && (
                <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">{formError}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="Deal title"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contact</label>
                  <select
                    value={form.contact_id}
                    onChange={e => setForm({ ...form, contact_id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal bg-white"
                  >
                    <option value="">— Select contact —</option>
                    {contacts.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.company || 'No company'})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Stage</label>
                  <select
                    value={form.stage}
                    onChange={e => setForm({ ...form, stage: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal bg-white"
                  >
                    {STAGES.map(s => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
                  <input
                    type="number"
                    value={form.value}
                    onChange={e => setForm({ ...form, value: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="0"
                    step="0.01"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Service Line</label>
                  <select
                    value={form.service_line}
                    onChange={e => setForm({ ...form, service_line: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal bg-white"
                  >
                    <option value="">— None —</option>
                    {SERVICE_LINES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Close Date</label>
                  <input
                    type="date"
                    value={form.close_date}
                    onChange={e => setForm({ ...form, close_date: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal resize-none"
                    placeholder="Deal notes..."
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-teal text-white text-sm font-semibold py-2 rounded-lg hover:bg-teal/90 transition-colors disabled:opacity-60"
                >
                  {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Save Deal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
