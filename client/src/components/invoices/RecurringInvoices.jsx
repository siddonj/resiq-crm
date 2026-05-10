import { useState } from 'react'
import axios from 'axios'

const FREQ_LABELS = {
  weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly',
  quarterly: 'Quarterly', semiannually: 'Semi-Annually', annually: 'Annually',
}

export default function RecurringInvoices({ token, contacts = [], deals = [], proposals = [] }) {
  const headers = { Authorization: `Bearer ${token}` }
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const [title, setTitle] = useState('')
  const [dealId, setDealId] = useState('')
  const [contactId, setContactId] = useState('')
  const [frequency, setFrequency] = useState('monthly')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dueDays, setDueDays] = useState(14)
  const [autoSend, setAutoSend] = useState(false)
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState([newLineItem()])

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/invoices/recurring/all', { headers })
      setItems(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const resetForm = () => {
    setTitle('')
    setDealId('')
    setContactId('')
    setFrequency('monthly')
    setStartDate('')
    setEndDate('')
    setDueDays(14)
    setAutoSend(false)
    setNotes('')
    setLineItems([newLineItem()])
    setEditing(null)
  }

  const openNew = () => { resetForm(); setShowForm(true) }
  const openEdit = (item) => {
    setEditing(item)
    setTitle(item.title)
    setDealId(item.deal_id || '')
    setContactId(item.contact_id || '')
    setFrequency(item.frequency)
    setStartDate(item.start_date ? item.start_date.slice(0, 10) : '')
    setEndDate(item.end_date ? item.end_date.slice(0, 10) : '')
    setDueDays(item.due_days || 14)
    setAutoSend(item.auto_send || false)
    setNotes(item.notes || '')
    setLineItems((item.line_items || []).map(i => ({ ...i, id: Math.random().toString(36).slice(2) })))
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    const payload = {
      title: title.trim(),
      deal_id: dealId || null,
      contact_id: contactId || null,
      frequency,
      start_date: startDate,
      end_date: endDate || null,
      due_days: Number(dueDays),
      auto_send: autoSend,
      notes: notes || null,
      line_items: lineItems.filter(i => i.description).map(i => ({
        description: i.description,
        quantity: Number(i.quantity),
        rate: Number(i.rate),
        tax: Number(i.tax || 0),
        discount: Number(i.discount || 0),
      })),
    }
    try {
      if (editing) {
        await axios.put(`/api/invoices/recurring/${editing.id}`, payload, { headers })
      } else {
        await axios.post('/api/invoices/recurring', payload, { headers })
      }
      setShowForm(false)
      resetForm()
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save')
    }
  }

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete recurring invoice "${name}"?`)) return
    try {
      await axios.delete(`/api/invoices/recurring/${id}`, { headers })
      load()
    } catch (err) { alert('Failed to delete') }
  }

  const handleGenerate = async (id) => {
    try {
      await axios.post(`/api/invoices/recurring/${id}/generate`, {}, { headers })
      alert('Invoice generated successfully')
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to generate invoice')
    }
  }

  const updateItem = (id, field, value) => {
    setLineItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  const total = lineItems.reduce((sum, i) => {
    const gross = Number(i.quantity) * Number(i.rate)
    const discounted = gross * (1 - Number(i.discount || 0) / 100)
    return sum + discounted * (1 + Number(i.tax || 0) / 100)
  }, 0)

  if (!loading && items.length === 0 && !showForm) {
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Recurring Invoices</h3>
        <button onClick={openNew} className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">+ New Recurring</button>
      </div>

      {showForm && (
        <div className="bg-white border rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-800">{editing ? 'Edit Recurring Invoice' : 'New Recurring Invoice'}</h4>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-600 mb-1">Title</label><input className="w-full rounded-md border-gray-300 text-sm" value={title} onChange={e => setTitle(e.target.value)} required /></div>
              <div><label className="block text-xs text-gray-600 mb-1">Frequency</label>
                <select className="w-full rounded-md border-gray-300 text-sm" value={frequency} onChange={e => setFrequency(e.target.value)}>
                  {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="block text-xs text-gray-600 mb-1">Contact</label>
                <select className="w-full rounded-md border-gray-300 text-sm" value={contactId} onChange={e => setContactId(e.target.value)}>
                  <option value="">— none —</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-gray-600 mb-1">Deal</label>
                <select className="w-full rounded-md border-gray-300 text-sm" value={dealId} onChange={e => setDealId(e.target.value)}>
                  <option value="">— none —</option>
                  {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-gray-600 mb-1">Due Days</label><input type="number" className="w-full rounded-md border-gray-300 text-sm" value={dueDays} onChange={e => setDueDays(e.target.value)} min="0" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="block text-xs text-gray-600 mb-1">Start Date</label><input type="date" className="w-full rounded-md border-gray-300 text-sm" value={startDate} onChange={e => setStartDate(e.target.value)} required /></div>
              <div><label className="block text-xs text-gray-600 mb-1">End Date</label><input type="date" className="w-full rounded-md border-gray-300 text-sm" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" id="autosend" checked={autoSend} onChange={e => setAutoSend(e.target.checked)} /><label htmlFor="autosend" className="text-xs text-gray-600">Auto-send generated invoices</label>
              </div>
            </div>
            <div><label className="block text-xs text-gray-600 mb-1">Notes</label><textarea className="w-full rounded-md border-gray-300 text-sm" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Line Items</label>
              <div className="space-y-2">
                {lineItems.map(item => (
                  <div key={item.id} className="grid grid-cols-12 gap-2 items-center">
                    <input className="col-span-4 border rounded px-2 py-1 text-sm" placeholder="Description" value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)} />
                    <input className="col-span-1 border rounded px-2 py-1 text-sm text-right" type="number" min="0" placeholder="Qty" value={item.quantity} onChange={e => updateItem(item.id, 'quantity', e.target.value)} />
                    <input className="col-span-2 border rounded px-2 py-1 text-sm text-right" type="number" min="0" step="0.01" placeholder="Rate" value={item.rate} onChange={e => updateItem(item.id, 'rate', e.target.value)} />
                    <input className="col-span-1 border rounded px-2 py-1 text-sm text-right" type="number" min="0" placeholder="Tax%" value={item.tax} onChange={e => updateItem(item.id, 'tax', e.target.value)} />
                    <input className="col-span-1 border rounded px-2 py-1 text-sm text-right" type="number" min="0" placeholder="Disc%" value={item.discount} onChange={e => updateItem(item.id, 'discount', e.target.value)} />
                    <span className="col-span-2 text-xs text-gray-500 text-right">${lineTotal(item).toFixed(2)}</span>
                    <button type="button" className="col-span-1 text-red-400 text-xs" onClick={() => setLineItems(prev => prev.filter(i => i.id !== item.id))}>×</button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setLineItems(l => [...l, newLineItem()])} className="text-xs text-indigo-600 mt-1">+ Add item</button>
              <div className="text-sm font-semibold text-right mt-1">Total: ${total.toFixed(2)}</div>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">{editing ? 'Update' : 'Create'}</button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }} className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {items.length === 0 && !showForm && (
        <div className="text-sm text-gray-500">No recurring invoices yet.</div>
      )}

      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="bg-white border rounded-lg p-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{item.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    item.status === 'active' ? 'bg-green-50 text-green-700' :
                    item.status === 'paused' ? 'bg-amber-50 text-amber-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{item.status}</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {FREQ_LABELS[item.frequency]} · Next: {item.next_send_date ? new Date(item.next_send_date).toLocaleDateString() : '—'}
                  {item.contact_name && ` · ${item.contact_name}`}
                  {item.due_days && ` · Due in ${item.due_days} days`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {item.status === 'active' && (
                  <button onClick={() => handleGenerate(item.id)} className="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100">Generate Now</button>
                )}
                <button onClick={() => openEdit(item)} className="text-xs text-gray-400 hover:text-gray-600" title="Edit">✏️</button>
                <button onClick={() => handleDelete(item.id, item.title)} className="text-xs text-gray-300 hover:text-red-500" title="Delete">🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function newLineItem() {
  return { id: Math.random().toString(36).slice(2), description: '', quantity: 1, rate: 0, tax: 0, discount: 0 }
}

function lineTotal(item) {
  const gross = Number(item.quantity) * Number(item.rate)
  const discounted = gross * (1 - Number(item.discount || 0) / 100)
  return discounted * (1 + Number(item.tax || 0) / 100)
}
