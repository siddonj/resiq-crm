import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import EmailTimeline from '../components/EmailTimeline'
import ContactTags from '../components/ContactTags'
import ShareModal from '../components/ShareModal'
import ActivityLog from '../components/ActivityLog'
import EngagementTimeline from '../components/EngagementTimeline'
import EnrollSequenceModal from '../components/EnrollSequenceModal'

const CONTACT_TYPES = ['prospect', 'partner', 'vendor']
const PREDEFINED_SERVICE_LINES = [
  { value: 'managed_wifi', label: 'Managed WiFi' },
  { value: 'proptech_selection', label: 'PropTech Selection' },
  { value: 'fractional_it', label: 'Fractional IT' },
  { value: 'vendor_rfp', label: 'Vendor RFP' },
  { value: 'ai_automation', label: 'AI Automation' },
  { value: 'team_process', label: 'Team Process' },
]

const EMPTY_FORM = { name: '', email: '', phone: '', company: '', type: 'prospect', service_line: '', notes: '', job_title: '', linkedin_url: '', company_website: '', industry: '', company_size: '' }

const formatServiceLine = (value) => {
  if (!value) return '—'
  const predefined = PREDEFINED_SERVICE_LINES.find(s => s.value === value)
  if (predefined) return predefined.label
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function Contacts() {
  const { token } = useAuth()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedContact, setSelectedContact] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [serviceLineMode, setServiceLineMode] = useState('select') // 'select' | 'custom'
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [sharingContact, setSharingContact] = useState(null)
  const [enrollingContact, setEnrollingContact] = useState(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterServiceLine, setFilterServiceLine] = useState('')
  const [enrichingId, setEnrichingId] = useState(null)
  const [importStatus, setImportStatus] = useState(null) // { imported, errors, enrichmentQueued }
  const [bulkEnriching, setBulkEnriching] = useState(false)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  // Collect unique service lines from loaded contacts (for filter dropdown)
  const uniqueServiceLines = [
    ...PREDEFINED_SERVICE_LINES,
    ...contacts
      .map(c => c.service_line)
      .filter(sl => sl && !PREDEFINED_SERVICE_LINES.some(p => p.value === sl))
      .filter((sl, i, arr) => arr.indexOf(sl) === i)
      .map(sl => ({ value: sl, label: sl })),
  ]

  const fetchContacts = () => {
    const params = {}
    if (search) params.search = search
    if (filterType) params.type = filterType
    if (filterServiceLine) params.service_line = filterServiceLine
    axios.get('/api/contacts', { ...authHeaders, params })
      .then(r => setContacts(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchContacts() }, [token, search, filterType, filterServiceLine])

  const handleExport = async () => {
    const params = {}
    if (search) params.search = search
    if (filterType) params.type = filterType
    if (filterServiceLine) params.service_line = filterServiceLine
    const res = await axios.get('/api/contacts/export', { ...authHeaders, params, responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = 'contacts.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const openModal = () => { setForm(EMPTY_FORM); setFormError(''); setEditingId(null); setServiceLineMode('select'); setShowModal(true) }
  const openEdit = (c) => {
    const sl = c.service_line || ''
    const isPredefined = PREDEFINED_SERVICE_LINES.some(s => s.value === sl)
    setForm({
      name: c.name, email: c.email || '', phone: c.phone || '', company: c.company || '',
      type: c.type, service_line: sl, notes: c.notes || '',
      job_title: c.job_title || '', linkedin_url: c.linkedin_url || '',
      company_website: c.company_website || '', industry: c.industry || '',
      company_size: c.company_size || '',
    })
    setFormError('')
    setEditingId(c.id)
    setServiceLineMode(sl && !isPredefined ? 'custom' : 'select')
    setShowModal(true)
  }
  const closeModal = () => setShowModal(false)
  const openDetail = (c) => {
    setSelectedContact(c)
    setShowDetailModal(true)
  }
  const closeDetail = () => setShowDetailModal(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setFormError('Name is required'); return }
    setSaving(true)
    setFormError('')
    try {
      const payload = { ...form, service_line: form.service_line || null }
      if (editingId) {
        const { data } = await axios.put(`/api/contacts/${editingId}`, payload, authHeaders)
        setContacts(prev => prev.map(c => c.id === editingId ? data : c))
      } else {
        const { data } = await axios.post('/api/contacts', payload, authHeaders)
        setContacts(prev => [data, ...prev])
      }
      closeModal()
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save contact')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this contact?')) return
    try {
      await axios.delete(`/api/contacts/${id}`, authHeaders)
      setContacts(prev => prev.filter(c => c.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    const enrich = window.confirm('Auto-enrich imported contacts in the background? (requires OpenAI API key)')
    const formData = new FormData()
    formData.append('file', file)
    try {
      const { data } = await axios.post(
        `/api/contacts/import?enrich=${enrich}`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } }
      )
      setImportStatus(data)
      fetchContacts()
    } catch (err) {
      alert(err.response?.data?.error || 'Import failed')
    }
  }

  const handleBulkEnrich = async () => {
    if (!window.confirm('Queue all contacts for AI enrichment? This runs in the background.')) return
    setBulkEnriching(true)
    try {
      const { data } = await axios.post('/api/contacts/enrich-all', {}, authHeaders)
      alert(data.message)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to queue bulk enrichment')
    } finally {
      setBulkEnriching(false)
    }
  }

  const handleEnrich = async (contactId) => {
    setEnrichingId(contactId)
    try {
      await axios.post(`/api/contacts/${contactId}/enrich`, {}, authHeaders)
      alert('Enrichment started in the background. Refresh in a few seconds to see updated data.')
    } catch (e) {
      alert('Failed to start enrichment.')
    } finally {
      setEnrichingId(null)
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-syne text-2xl font-bold text-navy">Contacts</h2>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Export CSV
          </button>
          <label className="border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer">
            📥 Import CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
          </label>
          <button
            onClick={handleBulkEnrich}
            disabled={bulkEnriching}
            className="border border-teal/40 text-teal text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal/5 transition-colors disabled:opacity-60"
          >
            {bulkEnriching ? 'Queuing...' : '✨ Enrich All'}
          </button>
          <button
            onClick={openModal}
            className="bg-teal text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-teal/90 transition-colors"
          >
            + Add Contact
          </button>
        </div>
      </div>

      {importStatus && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm flex items-center justify-between ${importStatus.errors > 0 ? 'bg-yellow-50 border border-yellow-200 text-yellow-800' : 'bg-green-50 border border-green-200 text-green-800'}`}>
          <span>
            ✅ Imported <strong>{importStatus.imported}</strong> contacts
            {importStatus.errors > 0 && <> · ⚠️ <strong>{importStatus.errors}</strong> rows skipped</>}
            {importStatus.enrichmentQueued && <> · 🤖 Enrichment queued</>}
          </span>
          <button onClick={() => setImportStatus(null)} className="text-gray-400 hover:text-gray-600 ml-4">&times;</button>
        </div>
      )}

      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Search name, email, company..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
        />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal"
        >
          <option value="">All Types</option>
          {CONTACT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
        <select
          value={filterServiceLine}
          onChange={e => setFilterServiceLine(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal"
        >
          <option value="">All Service Lines</option>
          {uniqueServiceLines.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-brand-gray text-sm">Loading...</p>
      ) : contacts.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="font-syne text-lg text-navy font-semibold mb-2">No contacts yet</p>
          <p className="text-brand-gray text-sm">Add your first contact to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Name', 'Company', 'Email', 'Type', 'Service Line', ''].map((h, i) => (
                  <th key={i} className="text-left px-4 py-3 text-xs font-semibold text-brand-gray uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {contacts.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-navy">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.company || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-teal/10 text-teal rounded-full text-xs font-medium capitalize">{c.type}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatServiceLine(c.service_line)}</td>
                  <td className="px-4 py-3 text-right space-x-3">
                    {!c.is_owner && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 mr-1">Shared</span>
                    )}
                    <button
                      onClick={() => openDetail(c)}
                      className="text-xs text-gray-400 hover:text-teal transition-colors"
                    >
                      View
                    </button>
                    {c.access_permission === 'edit' && (
                      <button
                        onClick={() => openEdit(c)}
                        className="text-xs text-gray-400 hover:text-teal transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    {c.is_owner && (
                      <>
                        <button
                          onClick={() => setSharingContact(c)}
                          className="text-xs text-gray-400 hover:text-teal transition-colors"
                        >
                          Share
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Contact Detail Modal */}
      {showDetailModal && selectedContact && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white flex-shrink-0">
              <div>
                <h3 className="font-syne text-lg font-bold text-navy">{selectedContact.name}</h3>
                {selectedContact.enriched_at && (
                  <span className="text-xs text-teal font-medium">
                    ✨ Enriched {new Date(selectedContact.enriched_at).toLocaleDateString()}
                    {selectedContact.enrichment_source && ` · ${selectedContact.enrichment_source}`}
                  </span>
                )}
              </div>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => setEnrollingContact(selectedContact)}
                  className="bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 text-xs px-3 py-1.5 font-semibold rounded"
                >
                  ✉️ Enroll in Sequence
                </button>
                <button
                  onClick={() => handleEnrich(selectedContact.id)}
                  disabled={enrichingId === selectedContact.id}
                  className="bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 text-xs px-3 py-1.5 font-semibold rounded disabled:opacity-60"
                >
                  {enrichingId === selectedContact.id ? '⏳ Enriching...' : '✨ AI Auto-Enrich'}
                </button>
                <button onClick={closeDetail} className="text-gray-400 hover:text-gray-600 flex items-center justify-center text-xl leading-none w-8 h-8 rounded-full hover:bg-gray-100 transition">&times;</button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
              {/* Contact Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600">Email</label>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-sm text-navy">{selectedContact.email || '—'}</p>
                    {selectedContact.email && (
                      selectedContact.email_verified
                        ? <span className="text-xs px-1.5 py-0.5 bg-green-50 text-green-700 rounded-full font-medium">✓ Verified</span>
                        : <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">Unverified</span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Phone</label>
                  <p className="text-sm text-navy mt-1">{selectedContact.phone || '—'}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Company</label>
                  <p className="text-sm text-navy mt-1">{selectedContact.company || '—'}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Type</label>
                  <p className="text-sm text-navy mt-1 capitalize">{selectedContact.type}</p>
                </div>
                {selectedContact.job_title && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">Job Title</label>
                    <p className="text-sm text-navy mt-1">{selectedContact.job_title}</p>
                  </div>
                )}
                {selectedContact.industry && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">Industry</label>
                    <p className="text-sm text-navy mt-1">{selectedContact.industry}</p>
                  </div>
                )}
                {selectedContact.company_size && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">Company Size</label>
                    <p className="text-sm text-navy mt-1">{selectedContact.company_size}</p>
                  </div>
                )}
                {selectedContact.company_website && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">Website</label>
                    <a
                      href={selectedContact.company_website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-teal hover:underline mt-1 block truncate"
                    >
                      {selectedContact.company_website}
                    </a>
                  </div>
                )}
                {selectedContact.linkedin_url && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">LinkedIn</label>
                    <a
                      href={selectedContact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline mt-1 block truncate"
                    >
                      {selectedContact.linkedin_url}
                    </a>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h4 className="font-semibold text-navy mb-3">Tags</h4>
                <ContactTags contactId={selectedContact.id} onTagsUpdated={fetchContacts} />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h4 className="font-semibold text-navy mb-3">Engagement Tracking</h4>
                <EngagementTimeline contactId={selectedContact.id} />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <ActivityLog contactId={selectedContact.id} />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h4 className="font-semibold text-navy mb-3">Email Communication</h4>
                <EmailTimeline contact={selectedContact} token={token} />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h4 className="font-semibold text-navy mb-3">Custom Fields</h4>
                {selectedContact.custom_fields && Object.keys(selectedContact.custom_fields).length > 0 ? (
                  <div className="grid grid-cols-2 gap-4">
                    {Object.entries(selectedContact.custom_fields).map(([key, value]) => (
                      <div key={key}>
                        <label className="text-xs font-medium text-gray-600 capitalize">{key.replace(/_/g, ' ')}</label>
                        <p className="text-sm text-navy mt-1">{value || '—'}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">No custom fields mapping recorded.</p>
                )}
              </div>

              {selectedContact.notes && (
                <div className="border-t border-gray-100 pt-4">
                  <h4 className="font-semibold text-navy mb-2">Notes</h4>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{selectedContact.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {sharingContact && (
        <ShareModal
          resourceType="contact"
          resourceId={sharingContact.id}
          resourceName={sharingContact.name}
          onClose={() => setSharingContact(null)}
        />
      )}

      {/* Add Contact Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-syne text-lg font-bold text-navy">{editingId ? 'Edit Contact' : 'New Contact'}</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {formError && (
                <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">{formError}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="Full name"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="email@example.com"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="+1 555 000 0000"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Company</label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={e => setForm({ ...form, company: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="Company name"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select
                    value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal bg-white"
                  >
                    {CONTACT_TYPES.map(t => (
                      <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Service Line</label>
                  {serviceLineMode === 'custom' ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={form.service_line}
                        onChange={e => setForm({ ...form, service_line: e.target.value })}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                        placeholder="Enter custom service line"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => { setServiceLineMode('select'); setForm({ ...form, service_line: '' }) }}
                        className="text-xs text-gray-400 hover:text-gray-600 px-2"
                        title="Switch to predefined list"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <select
                      value={form.service_line}
                      onChange={e => {
                        if (e.target.value === '__custom__') {
                          setServiceLineMode('custom')
                          setForm({ ...form, service_line: '' })
                        } else {
                          setForm({ ...form, service_line: e.target.value })
                        }
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal bg-white"
                    >
                      <option value="">— None —</option>
                      {PREDEFINED_SERVICE_LINES.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                      <option value="__custom__">+ Add custom...</option>
                    </select>
                  )}
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal resize-none"
                    placeholder="Any notes about this contact..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Job Title</label>
                  <input
                    type="text"
                    value={form.job_title}
                    onChange={e => setForm({ ...form, job_title: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="e.g. VP of Operations"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Industry</label>
                  <input
                    type="text"
                    value={form.industry}
                    onChange={e => setForm({ ...form, industry: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="e.g. Real Estate, PropTech"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Company Size</label>
                  <input
                    type="text"
                    value={form.company_size}
                    onChange={e => setForm({ ...form, company_size: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="e.g. 11-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Company Website</label>
                  <input
                    type="url"
                    value={form.company_website}
                    onChange={e => setForm({ ...form, company_website: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="https://example.com"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">LinkedIn URL</label>
                  <input
                    type="url"
                    value={form.linkedin_url}
                    onChange={e => setForm({ ...form, linkedin_url: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    placeholder="https://linkedin.com/in/..."
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
                  {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Save Contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
