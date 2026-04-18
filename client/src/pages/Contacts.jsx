import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import EmailTimeline from '../components/EmailTimeline'
import ContactTags from '../components/ContactTags'

const CONTACT_TYPES = ['prospect', 'partner', 'vendor']
const SERVICE_LINES = [
  { value: 'managed_wifi', label: 'Managed WiFi' },
  { value: 'proptech_selection', label: 'PropTech Selection' },
  { value: 'fractional_it', label: 'Fractional IT' },
  { value: 'vendor_rfp', label: 'Vendor RFP' },
  { value: 'ai_automation', label: 'AI Automation' },
  { value: 'team_process', label: 'Team Process' },
]

const EMPTY_FORM = { name: '', email: '', phone: '', company: '', type: 'prospect', service_line: '', notes: '' }

export default function Contacts() {
  const { token } = useAuth()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedContact, setSelectedContact] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  const fetchContacts = () => {
    axios.get('/api/contacts', authHeaders)
      .then(r => setContacts(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchContacts() }, [token])

  const openModal = () => { setForm(EMPTY_FORM); setFormError(''); setEditingId(null); setShowModal(true) }
  const openEdit = (c) => {
    setForm({ name: c.name, email: c.email || '', phone: c.phone || '', company: c.company || '', type: c.type, service_line: c.service_line || '', notes: c.notes || '' })
    setFormError('')
    setEditingId(c.id)
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

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-syne text-2xl font-bold text-navy">Contacts</h2>
        <button
          onClick={openModal}
          className="bg-teal text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-teal/90 transition-colors"
        >
          + Add Contact
        </button>
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
                  <td className="px-4 py-3 text-gray-600">{SERVICE_LINES.find(s => s.value === c.service_line)?.label || '—'}</td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      onClick={() => openDetail(c)}
                      className="text-xs text-gray-400 hover:text-teal transition-colors"
                    >
                      View
                    </button>
                    <button
                      onClick={() => openEdit(c)}
                      className="text-xs text-gray-400 hover:text-teal transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                    >
                      Delete
                    </button>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white">
              <h3 className="font-syne text-lg font-bold text-navy">{selectedContact.name}</h3>
              <button onClick={closeDetail} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Contact Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600">Email</label>
                  <p className="text-sm text-navy mt-1">{selectedContact.email || '—'}</p>
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
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h4 className="font-semibold text-navy mb-3">Tags</h4>
                <ContactTags contactId={selectedContact.id} onTagsUpdated={fetchContacts} />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h4 className="font-semibold text-navy mb-3">Email Communication</h4>
                <EmailTimeline contact={selectedContact} token={token} />
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal resize-none"
                    placeholder="Any notes about this contact..."
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
