import { useState } from 'react'
import axios from 'axios'

const FREQ_LABELS = {
  weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly',
  quarterly: 'Quarterly', semiannually: 'Semi-Annually', annually: 'Annually',
}

export default function Subscriptions({ token, contacts = [] }) {
  const headers = { Authorization: `Bearer ${token}` }
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const [planName, setPlanName] = useState('')
  const [contactId, setContactId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState('monthly')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/invoices/subscriptions/all', { headers })
      setItems(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const resetForm = () => {
    setPlanName('')
    setContactId('')
    setDescription('')
    setAmount('')
    setFrequency('monthly')
    setStartDate('')
    setEndDate('')
    setEditing(null)
  }

  const openNew = () => { resetForm(); setShowForm(true) }
  const openEdit = (item) => {
    setEditing(item)
    setPlanName(item.plan_name)
    setContactId(item.contact_id || '')
    setDescription(item.description || '')
    setAmount(item.amount)
    setFrequency(item.frequency)
    setStartDate(item.start_date ? item.start_date.slice(0, 10) : '')
    setEndDate(item.end_date ? item.end_date.slice(0, 10) : '')
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    const payload = {
      contact_id: contactId,
      plan_name: planName.trim(),
      description: description || null,
      amount: Number(amount),
      frequency,
      start_date: startDate,
      end_date: endDate || null,
    }
    try {
      if (editing) {
        await axios.put(`/api/invoices/subscriptions/${editing.id}`, payload, { headers })
      } else {
        await axios.post('/api/invoices/subscriptions', payload, { headers })
      }
      setShowForm(false)
      resetForm()
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save')
    }
  }

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete subscription "${name}"?`)) return
    try {
      await axios.delete(`/api/invoices/subscriptions/${id}`, { headers })
      load()
    } catch (err) { alert('Failed to delete') }
  }

  const handleStatusToggle = async (item) => {
    const newStatus = item.status === 'active' ? 'paused' : 'active'
    try {
      await axios.put(`/api/invoices/subscriptions/${item.id}`, { status: newStatus }, { headers })
      load()
    } catch (err) { alert('Failed to update status') }
  }

  if (!loading && items.length === 0 && !showForm) {
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Subscriptions</h3>
        <button onClick={openNew} className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">+ New Subscription</button>
      </div>

      {showForm && (
        <div className="bg-white border rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-800">{editing ? 'Edit Subscription' : 'New Subscription'}</h4>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-600 mb-1">Plan Name</label><input className="w-full rounded-md border-gray-300 text-sm" value={planName} onChange={e => setPlanName(e.target.value)} required /></div>
              <div><label className="block text-xs text-gray-600 mb-1">Contact</label>
                <select className="w-full rounded-md border-gray-300 text-sm" value={contactId} onChange={e => setContactId(e.target.value)} required>
                  <option value="">Select contact…</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="block text-xs text-gray-600 mb-1">Amount</label><input type="number" step="0.01" min="0" className="w-full rounded-md border-gray-300 text-sm" value={amount} onChange={e => setAmount(e.target.value)} required /></div>
              <div><label className="block text-xs text-gray-600 mb-1">Frequency</label>
                <select className="w-full rounded-md border-gray-300 text-sm" value={frequency} onChange={e => setFrequency(e.target.value)}>
                  {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-gray-600 mb-1">Start Date</label><input type="date" className="w-full rounded-md border-gray-300 text-sm" value={startDate} onChange={e => setStartDate(e.target.value)} required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-600 mb-1">End Date</label><input type="date" className="w-full rounded-md border-gray-300 text-sm" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
              <div><label className="block text-xs text-gray-600 mb-1">Description</label><input className="w-full rounded-md border-gray-300 text-sm" value={description} onChange={e => setDescription(e.target.value)} /></div>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">{editing ? 'Update' : 'Create'}</button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }} className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {items.length === 0 && !showForm && (
        <div className="text-sm text-gray-500">No subscriptions yet.</div>
      )}

      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="bg-white border rounded-lg p-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{item.plan_name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    item.status === 'active' ? 'bg-green-50 text-green-700' :
                    item.status === 'paused' ? 'bg-amber-50 text-amber-700' :
                    item.status === 'cancelled' ? 'bg-red-50 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{item.status}</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  ${Number(item.amount).toFixed(2)} / {FREQ_LABELS[item.frequency]}
                  {item.contact_name && ` · ${item.contact_name}`}
                  {item.next_billing_date && ` · Next bill: ${new Date(item.next_billing_date).toLocaleDateString()}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleStatusToggle(item)} className="text-xs px-2 py-1 rounded bg-gray-50 hover:bg-gray-100 text-gray-700">
                  {item.status === 'active' ? 'Pause' : 'Activate'}
                </button>
                <button onClick={() => openEdit(item)} className="text-xs text-gray-400 hover:text-gray-600" title="Edit">✏️</button>
                <button onClick={() => handleDelete(item.id, item.plan_name)} className="text-xs text-gray-300 hover:text-red-500" title="Delete">🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
