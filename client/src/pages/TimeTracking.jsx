import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

function fmtMinutes(m) {
  const h = Math.floor(m / 60)
  const min = m % 60
  return h > 0 ? `${h}h ${min}m` : `${min}m`
}

function fmtElapsed(startedAt) {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

// ── Entry Form Modal ──────────────────────────────────────────────────────────
function EntryModal({ entry, deals, contacts, onClose, onSave }) {
  const { token } = useAuth()
  const [description, setDescription] = useState(entry?.description || '')
  const [hours, setHours] = useState(entry ? Math.floor((entry.minutes || 0) / 60) : 0)
  const [mins, setMins] = useState(entry ? (entry.minutes || 0) % 60 : 30)
  const [rate, setRate] = useState(entry?.hourly_rate || 0)
  const [billable, setBillable] = useState(entry?.billable !== false)
  const [dealId, setDealId] = useState(entry?.deal_id || '')
  const [contactId, setContactId] = useState(entry?.contact_id || '')
  const [date, setDate] = useState(entry?.date ? entry.date.slice(0, 10) : new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    const totalMins = Number(hours) * 60 + Number(mins)
    if (totalMins <= 0) { setError('Duration must be greater than 0'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { description, minutes: totalMins, hourly_rate: rate, billable, deal_id: dealId || null, contact_id: contactId || null, date }
      let res
      if (entry?.id) {
        res = await axios.put(`/api/time-entries/${entry.id}`, payload, { headers: { Authorization: `Bearer ${token}` } })
      } else {
        res = await axios.post('/api/time-entries', payload, { headers: { Authorization: `Bearer ${token}` } })
      }
      onSave(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const amount = billable ? ((Number(hours) * 60 + Number(mins)) / 60 * Number(rate)) : 0

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold text-navy">{entry?.id ? 'Edit Entry' : 'Log Time'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What did you work on?"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
              <div className="flex gap-2 items-center">
                <input type="number" min="0" max="99" value={hours} onChange={e => setHours(e.target.value)}
                  className="w-16 border rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-teal" />
                <span className="text-sm text-gray-500">h</span>
                <input type="number" min="0" max="59" value={mins} onChange={e => setMins(e.target.value)}
                  className="w-16 border rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-teal" />
                <span className="text-sm text-gray-500">m</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Deal</label>
              <select value={dealId} onChange={e => setDealId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal">
                <option value="">— none —</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
              <select value={contactId} onChange={e => setContactId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal">
                <option value="">— none —</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hourly Rate ($)</label>
              <input type="number" min="0" step="0.01" value={rate} onChange={e => setRate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <input type="checkbox" id="billable" checked={billable} onChange={e => setBillable(e.target.checked)}
                className="w-4 h-4 accent-teal" />
              <label htmlFor="billable" className="text-sm text-gray-700">Billable</label>
              {billable && amount > 0 && (
                <span className="ml-auto text-sm font-semibold text-teal">${amount.toFixed(2)}</span>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 text-sm rounded-lg bg-teal text-white font-medium hover:bg-teal/90 disabled:opacity-50">
              {saving ? 'Saving…' : entry?.id ? 'Update' : 'Log Time'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Timer Widget ──────────────────────────────────────────────────────────────
function TimerWidget({ deals, contacts, activeTimer, onStart, onStop }) {
  const [elapsed, setElapsed] = useState('00:00:00')
  const [description, setDescription] = useState('')
  const [dealId, setDealId] = useState('')
  const [rate, setRate] = useState(0)
  const [starting, setStarting] = useState(false)
  const intervalRef = useRef(null)

  useEffect(() => {
    if (activeTimer) {
      setElapsed(fmtElapsed(activeTimer.started_at))
      intervalRef.current = setInterval(() => setElapsed(fmtElapsed(activeTimer.started_at)), 1000)
    } else {
      clearInterval(intervalRef.current)
      setElapsed('00:00:00')
    }
    return () => clearInterval(intervalRef.current)
  }, [activeTimer])

  async function handleStart() {
    setStarting(true)
    await onStart({ description, deal_id: dealId || null, hourly_rate: rate })
    setStarting(false)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          {activeTimer ? (
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Tracking: {activeTimer.description || 'Untitled'}</p>
              <p className="font-mono text-3xl font-bold text-navy">{elapsed}</p>
              {activeTimer.deal_title && <p className="text-xs text-gray-400 mt-0.5">{activeTimer.deal_title}</p>}
            </div>
          ) : (
            <div className="flex gap-3 flex-wrap">
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What are you working on?"
                className="flex-1 min-w-48 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              />
              <select value={dealId} onChange={e => setDealId(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal">
                <option value="">— deal —</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
              <input type="number" min="0" step="0.01" value={rate} onChange={e => setRate(e.target.value)}
                placeholder="$/hr"
                className="w-20 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
            </div>
          )}
        </div>
        {activeTimer ? (
          <button onClick={onStop}
            className="px-5 py-2.5 bg-red-500 text-white rounded-lg font-medium text-sm hover:bg-red-600 transition-colors">
            Stop
          </button>
        ) : (
          <button onClick={handleStart} disabled={starting}
            className="px-5 py-2.5 bg-teal text-white rounded-lg font-medium text-sm hover:bg-teal/90 disabled:opacity-50 transition-colors">
            {starting ? 'Starting…' : '▶ Start Timer'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Convert to Invoice Modal ──────────────────────────────────────────────────
function ConvertModal({ entries, dealTitle, onClose, onCreate }) {
  const { token } = useAuth()
  const [title, setTitle] = useState(dealTitle ? `Time — ${dealTitle}` : 'Time Invoice')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  const billable = entries.filter(e => e.billable)
  const lineItems = billable.map(e => ({
    id: e.id,
    description: e.description || `${fmtMinutes(e.minutes)} on ${e.date}`,
    quantity: Number((e.minutes / 60).toFixed(2)),
    rate: Number(e.hourly_rate),
    tax: 0,
    discount: 0,
  }))
  const total = lineItems.reduce((s, i) => s + i.quantity * i.rate, 0)

  async function handleCreate() {
    setSaving(true)
    try {
      const res = await axios.post('/api/invoices',
        { title, line_items: lineItems, due_date: dueDate || null },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      onCreate(res.data)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create invoice')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-navy mb-4">Convert to Invoice</h2>
        <p className="text-sm text-gray-500 mb-4">
          {billable.length} billable {billable.length === 1 ? 'entry' : 'entries'} · <strong>${total.toFixed(2)}</strong> total
        </p>
        <div className="space-y-3 mb-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due Date (optional)</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleCreate} disabled={saving || billable.length === 0}
            className="px-5 py-2 text-sm bg-teal text-white rounded-lg font-medium hover:bg-teal/90 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TimeTracking() {
  const { token } = useAuth()
  const [entries, setEntries] = useState([])
  const [deals, setDeals] = useState([])
  const [contacts, setContacts] = useState([])
  const [activeTimer, setActiveTimer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [convertEntries, setConvertEntries] = useState(null)
  const [filterDeal, setFilterDeal] = useState('')
  const [filterBillable, setFilterBillable] = useState('')
  const [invoiceCreated, setInvoiceCreated] = useState(null)

  const headers = { Authorization: `Bearer ${token}` }

  async function load() {
    setLoading(true)
    try {
      const params = {}
      if (filterDeal) params.deal_id = filterDeal
      if (filterBillable !== '') params.billable = filterBillable
      const [entriesRes, dealsRes, contactsRes, timerRes] = await Promise.all([
        axios.get('/api/time-entries', { headers, params }),
        axios.get('/api/deals', { headers }),
        axios.get('/api/contacts', { headers }),
        axios.get('/api/time-entries/timer/active', { headers }),
      ])
      setEntries(entriesRes.data)
      setDeals(dealsRes.data)
      setContacts(contactsRes.data)
      setActiveTimer(timerRes.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterDeal, filterBillable])

  async function handleStartTimer(opts) {
    try {
      const res = await axios.post('/api/time-entries/timer/start', opts, { headers })
      setActiveTimer(res.data)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start timer')
    }
  }

  async function handleStopTimer() {
    try {
      const res = await axios.patch('/api/time-entries/timer/stop', {}, { headers })
      setActiveTimer(null)
      setEntries(e => [res.data, ...e.filter(x => x.id !== res.data.id)])
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to stop timer')
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this time entry?')) return
    try {
      await axios.delete(`/api/time-entries/${id}`, { headers })
      setEntries(e => e.filter(x => x.id !== id))
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete')
    }
  }

  function handleSave(saved) {
    setEntries(e => {
      const exists = e.find(x => x.id === saved.id)
      return exists ? e.map(x => x.id === saved.id ? saved : x) : [saved, ...e]
    })
    setShowModal(false)
    setEditingEntry(null)
  }

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0)
  const billableMinutes = entries.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0)
  const billableAmount = entries.filter(e => e.billable).reduce((s, e) => s + (e.minutes / 60) * Number(e.hourly_rate), 0)

  const dealForConvert = filterDeal ? deals.find(d => d.id === filterDeal) : null

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy font-syne">Time Tracking</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {fmtMinutes(totalMinutes)} logged · {fmtMinutes(billableMinutes)} billable · ${billableAmount.toFixed(2)} value
          </p>
        </div>
        <div className="flex gap-3">
          {entries.some(e => e.billable) && (
            <button
              onClick={() => setConvertEntries(entries)}
              className="px-4 py-2 text-sm rounded-lg border border-teal text-teal hover:bg-teal/5 font-medium transition-colors">
              Convert to Invoice
            </button>
          )}
          <button
            onClick={() => { setEditingEntry(null); setShowModal(true) }}
            className="bg-teal text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal/90 transition-colors">
            + Log Time
          </button>
        </div>
      </div>

      {/* Timer */}
      <TimerWidget
        deals={deals}
        contacts={contacts}
        activeTimer={activeTimer}
        onStart={handleStartTimer}
        onStop={handleStopTimer}
      />

      {/* Invoice created toast */}
      {invoiceCreated && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center justify-between">
          <span className="text-sm text-green-700">Invoice <strong>{invoiceCreated.invoice_number}</strong> created successfully.</span>
          <button onClick={() => setInvoiceCreated(null)} className="text-green-400 hover:text-green-600">&times;</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select value={filterDeal} onChange={e => setFilterDeal(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal">
          <option value="">All deals</option>
          {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        <select value={filterBillable} onChange={e => setFilterBillable(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal">
          <option value="">All entries</option>
          <option value="true">Billable only</option>
          <option value="false">Non-billable only</option>
        </select>
        {(filterDeal || filterBillable !== '') && (
          <button onClick={() => { setFilterDeal(''); setFilterBillable('') }}
            className="text-sm text-gray-400 hover:text-gray-600 px-2">Clear filters</button>
        )}
      </div>

      {/* Entries table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-gray-400">No time entries yet. Start a timer or log time manually.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Description</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Deal / Contact</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Duration</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Billable</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(entry => {
                const amount = entry.billable ? (entry.minutes / 60) * Number(entry.hourly_rate) : 0
                const isRunning = activeTimer?.id === entry.id
                return (
                  <tr key={entry.id} className={`hover:bg-gray-50 transition-colors ${isRunning ? 'bg-teal/5' : ''}`}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        {isRunning && <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />}
                        <span className="font-medium text-gray-800">{entry.description || <span className="text-gray-400 italic">No description</span>}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-500">
                      {entry.deal_title || entry.contact_name || '—'}
                    </td>
                    <td className="px-5 py-4 text-gray-500">
                      {new Date(entry.date).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4 text-right font-medium text-gray-700">
                      {fmtMinutes(entry.minutes)}
                    </td>
                    <td className="px-5 py-4 text-right text-gray-600">
                      {entry.billable && amount > 0 ? `$${amount.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${entry.billable ? 'bg-teal/10 text-teal' : 'bg-gray-100 text-gray-400'}`}>
                        {entry.billable ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setEditingEntry(entry); setShowModal(true) }}
                          className="text-gray-400 hover:text-teal transition-colors text-xs" title="Edit">✏️</button>
                        <button onClick={() => handleDelete(entry.id)}
                          className="text-gray-300 hover:text-red-500 transition-colors text-xs" title="Delete">🗑</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50">
                <td colSpan={3} className="px-5 py-3 text-xs font-medium text-gray-500">
                  {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                </td>
                <td className="px-5 py-3 text-right font-semibold text-navy text-sm">{fmtMinutes(totalMinutes)}</td>
                <td className="px-5 py-3 text-right font-semibold text-navy text-sm">${billableAmount.toFixed(2)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showModal && (
        <EntryModal
          entry={editingEntry}
          deals={deals}
          contacts={contacts}
          onClose={() => { setShowModal(false); setEditingEntry(null) }}
          onSave={handleSave}
        />
      )}

      {convertEntries && (
        <ConvertModal
          entries={convertEntries}
          dealTitle={dealForConvert?.title}
          onClose={() => setConvertEntries(null)}
          onCreate={inv => {
            setConvertEntries(null)
            setInvoiceCreated(inv)
          }}
        />
      )}
    </div>
  )
}
