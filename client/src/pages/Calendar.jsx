import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const TYPE_COLORS = {
  event: { bg: 'bg-teal', dot: 'bg-teal', label: 'Event' },
  activity: { bg: 'bg-blue-500', dot: 'bg-blue-500', label: 'Activity' },
  reminder: { bg: 'bg-amber-500', dot: 'bg-amber-500', label: 'Reminder' },
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}
function startOfWeek(d) {
  const s = new Date(d); s.setDate(d.getDate() - d.getDay()); return s
}
function addDays(d, n) {
  const r = new Date(d); r.setDate(d.getDate() + n); return r
}

// ── Event Form Modal ──────────────────────────────────────────────────────────
function EventModal({ event, initialDate, deals, contacts, onClose, onSave, onDelete }) {
  const { token } = useAuth()
  const [title, setTitle] = useState(event?.title || '')
  const [description, setDescription] = useState(event?.description || '')
  const [startAt, setStartAt] = useState(
    event?.start_at ? event.start_at.slice(0, 16) :
    initialDate ? `${initialDate.toISOString().slice(0,10)}T09:00` : ''
  )
  const [endAt, setEndAt] = useState(
    event?.end_at ? event.end_at.slice(0, 16) :
    initialDate ? `${initialDate.toISOString().slice(0,10)}T10:00` : ''
  )
  const [dealId, setDealId] = useState(event?.deal_id || '')
  const [contactId, setContactId] = useState(event?.contact_id || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    if (!startAt || !endAt) { setError('Start and end time are required'); return }
    setSaving(true); setError('')
    try {
      const payload = { title, description, start_at: new Date(startAt).toISOString(), end_at: new Date(endAt).toISOString(), deal_id: dealId || null, contact_id: contactId || null }
      let res
      if (event?.id) {
        res = await axios.put(`/api/calendar/events/${event.id}`, payload, { headers: { Authorization: `Bearer ${token}` } })
      } else {
        res = await axios.post('/api/calendar/events', payload, { headers: { Authorization: `Bearer ${token}` } })
      }
      onSave({ ...res.data, _type: 'event' })
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save')
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirm('Delete this event?')) return
    try {
      await axios.delete(`/api/calendar/events/${event.id}`, { headers: { Authorization: `Bearer ${token}` } })
      onDelete(event.id)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-navy">{event?.id ? 'Edit Event' : 'New Event'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
              <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
              <input type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
          <div className="flex items-center justify-between pt-2">
            {event?.id && (
              <button type="button" onClick={handleDelete} className="text-sm text-red-400 hover:text-red-600">Delete</button>
            )}
            <div className="flex gap-3 ml-auto">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving}
                className="px-5 py-2 text-sm bg-teal text-white rounded-lg font-medium hover:bg-teal/90 disabled:opacity-50">
                {saving ? 'Saving…' : event?.id ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Day Detail Panel ──────────────────────────────────────────────────────────
function DayPanel({ date, items, onClose, onNew }) {
  const fmt = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-navy">{date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-4 max-h-80 overflow-y-auto space-y-2">
          {items.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Nothing scheduled</p>}
          {items.map((item, i) => (
            <div key={i} className={`flex gap-3 p-3 rounded-lg ${TYPE_COLORS[item._type]?.bg || 'bg-gray-100'}/10 border border-current/10`}>
              <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${TYPE_COLORS[item._type]?.dot || 'bg-gray-400'}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{item.title}</p>
                <p className="text-xs text-gray-500">{fmt(item.start_at)}{item._type === 'event' ? ` — ${fmt(item.end_at)}` : ''}</p>
                {(item.contact_name || item.deal_title) && (
                  <p className="text-xs text-gray-400 mt-0.5">{item.contact_name || item.deal_title}</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t">
          <button onClick={() => { onClose(); onNew(date) }}
            className="w-full bg-teal text-white rounded-lg py-2 text-sm font-medium hover:bg-teal/90">
            + New Event
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Month View ────────────────────────────────────────────────────────────────
function MonthView({ current, items, onDayClick }) {
  const today = new Date()
  const monthStart = startOfMonth(current)
  const monthEnd = endOfMonth(current)
  const gridStart = startOfWeek(monthStart)

  const cells = []
  let d = new Date(gridStart)
  while (d <= monthEnd || cells.length % 7 !== 0) {
    cells.push(new Date(d))
    d = addDays(d, 1)
    if (cells.length > 42) break
  }

  function itemsForDay(day) {
    return items.filter(item => isSameDay(new Date(item.start_at), day))
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {DAYS.map(d => (
          <div key={d} className="py-2 text-center text-xs font-medium text-gray-400 uppercase tracking-wide">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const dayItems = itemsForDay(day)
          const isThisMonth = day.getMonth() === current.getMonth()
          const isToday = isSameDay(day, today)
          return (
            <div key={i} onClick={() => onDayClick(day, dayItems)}
              className={`min-h-[90px] p-2 border-b border-r border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${!isThisMonth ? 'bg-gray-50/50' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm mb-1 ${isToday ? 'bg-teal text-white font-bold' : isThisMonth ? 'text-gray-700' : 'text-gray-300'}`}>
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((item, j) => (
                  <div key={j} className={`text-xs px-1.5 py-0.5 rounded truncate text-white ${TYPE_COLORS[item._type]?.bg || 'bg-gray-400'}`}>
                    {item.title}
                  </div>
                ))}
                {dayItems.length > 3 && (
                  <div className="text-xs text-gray-400 pl-1">+{dayItems.length - 3} more</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Week View ─────────────────────────────────────────────────────────────────
function WeekView({ current, items, onDayClick }) {
  const today = new Date()
  const weekStart = startOfWeek(current)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const hours = Array.from({ length: 24 }, (_, i) => i)

  function itemsForDay(day) {
    return items.filter(item => isSameDay(new Date(item.start_at), day))
  }

  function topPct(dt) {
    const d = new Date(dt)
    return ((d.getHours() + d.getMinutes() / 60) / 24) * 100
  }
  function heightPct(start, end) {
    const s = new Date(start), e = new Date(end)
    const mins = Math.max(30, (e - s) / 60000)
    return (mins / (24 * 60)) * 100
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="grid border-b border-gray-100" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
        <div />
        {days.map((day, i) => {
          const isToday = isSameDay(day, today)
          return (
            <div key={i} className="py-2 text-center border-l border-gray-100 cursor-pointer hover:bg-gray-50"
              onClick={() => onDayClick(day, itemsForDay(day))}>
              <div className="text-xs text-gray-400 uppercase">{DAYS[day.getDay()]}</div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm mx-auto mt-0.5 ${isToday ? 'bg-teal text-white font-bold' : 'text-gray-700'}`}>
                {day.getDate()}
              </div>
            </div>
          )
        })}
      </div>
      {/* Time grid */}
      <div className="overflow-y-auto max-h-[60vh]">
        <div className="relative grid" style={{ gridTemplateColumns: '48px repeat(7, 1fr)', minHeight: '960px' }}>
          {/* Hour labels */}
          <div className="sticky left-0">
            {hours.map(h => (
              <div key={h} style={{ height: '40px' }} className="flex items-start justify-end pr-2">
                <span className="text-xs text-gray-400">{h === 0 ? '' : `${h}:00`}</span>
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map((day, di) => (
            <div key={di} className="relative border-l border-gray-100">
              {hours.map(h => (
                <div key={h} style={{ height: '40px' }} className="border-b border-gray-50" />
              ))}
              {itemsForDay(day).map((item, j) => (
                <div key={j}
                  style={{ position: 'absolute', top: `${topPct(item.start_at)}%`, height: `${heightPct(item.start_at, item.end_at)}%`, left: '2px', right: '2px', minHeight: '20px' }}
                  className={`${TYPE_COLORS[item._type]?.bg || 'bg-gray-400'} rounded text-white text-xs px-1 py-0.5 overflow-hidden cursor-pointer hover:opacity-90`}
                  title={item.title}>
                  <p className="font-medium truncate">{item.title}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Scheduling Settings Panel ─────────────────────────────────────────────────
function SchedulingPanel({ token, user }) {
  const [settings, setSettings] = useState(null)
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('Book a meeting')
  const [description, setDescription] = useState('')
  const [slotDuration, setSlotDuration] = useState(30)
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [gcalConnected, setGcalConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [settRes, gcalRes] = await Promise.all([
          axios.get('/api/calendar/scheduling', { headers: { Authorization: `Bearer ${token}` } }),
          axios.get('/api/integrations/gcal/status', { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (settRes.data) {
          setSettings(settRes.data)
          setSlug(settRes.data.slug)
          setTitle(settRes.data.title)
          setDescription(settRes.data.description || '')
          setSlotDuration(settRes.data.slot_duration)
          setEnabled(settRes.data.enabled)
        } else {
          setSlug(user?.name?.toLowerCase().replace(/\s+/g, '-') || '')
        }
        setGcalConnected(gcalRes.data.connected)
      } catch (_) {}
    }
    load()
  }, [token])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setMsg('')
    try {
      const res = await axios.put('/api/calendar/scheduling',
        { slug, title, description, slot_duration: slotDuration, enabled },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setSettings(res.data)
      setMsg('Saved!')
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to save')
    } finally { setSaving(false) }
  }

  async function connectGcal() {
    try {
      const res = await axios.post('/api/integrations/gcal/connect', {}, { headers: { Authorization: `Bearer ${token}` } })
      window.location.href = res.data.authUrl
    } catch (_) { alert('Failed to start Google Calendar connection') }
  }

  async function disconnectGcal() {
    try {
      await axios.post('/api/integrations/gcal/disconnect', {}, { headers: { Authorization: `Bearer ${token}` } })
      setGcalConnected(false)
    } catch (_) {}
  }

  async function syncGcal() {
    setSyncing(true)
    try {
      const res = await axios.post('/api/integrations/gcal/sync', {}, { headers: { Authorization: `Bearer ${token}` } })
      setMsg(`Synced ${res.data.synced} events from Google Calendar`)
    } catch (err) {
      setMsg(err.response?.data?.error || 'Sync failed')
    } finally { setSyncing(false) }
  }

  const bookingUrl = settings ? `${window.location.origin}/book/${settings.slug}` : null

  return (
    <div className="space-y-6">
      {/* Google Calendar */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-navy mb-3">Google Calendar</h3>
        {gcalConnected ? (
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-gray-600">Connected</span>
            <button onClick={syncGcal} disabled={syncing}
              className="ml-auto px-3 py-1.5 text-sm bg-teal text-white rounded-lg hover:bg-teal/90 disabled:opacity-50">
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
            <button onClick={disconnectGcal} className="text-sm text-red-400 hover:text-red-600">Disconnect</button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-500 mb-3">Connect Google Calendar to sync events and create bookings directly in your calendar.</p>
            <button onClick={connectGcal}
              className="px-4 py-2 text-sm bg-navy text-white rounded-lg hover:bg-navy/90">
              Connect Google Calendar
            </button>
          </div>
        )}
      </div>

      {/* Scheduling page */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-navy mb-1">Public Scheduling Page</h3>
        {bookingUrl && (
          <div className="flex items-center gap-2 mb-4">
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-teal hover:underline truncate">{bookingUrl}</a>
            <button onClick={() => { navigator.clipboard.writeText(bookingUrl); setMsg('Link copied!') }}
              className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0">Copy</button>
          </div>
        )}
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL Slug</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">/book/</span>
              <input value={slug} onChange={e => setSlug(e.target.value)} placeholder="your-name"
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Page Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Slot Duration</label>
              <select value={slotDuration} onChange={e => setSlotDuration(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal">
                {[15, 30, 45, 60, 90].map(m => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 accent-teal" />
                <span className="text-sm text-gray-700">Enabled</span>
              </label>
            </div>
          </div>
          {msg && <p className={`text-sm ${msg.includes('ailed') || msg.includes('taken') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>}
          <button type="submit" disabled={saving}
            className="px-5 py-2 text-sm bg-teal text-white rounded-lg font-medium hover:bg-teal/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Calendar() {
  const { token, user } = useAuth()
  const [view, setView] = useState('month') // 'month' | 'week' | 'settings'
  const [current, setCurrent] = useState(new Date())
  const [items, setItems] = useState([])
  const [deals, setDeals] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showEventModal, setShowEventModal] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)
  const [selectedDayItems, setSelectedDayItems] = useState([])

  const headers = { Authorization: `Bearer ${token}` }

  function getRange() {
    if (view === 'week') {
      const ws = startOfWeek(current)
      return { start: ws.toISOString(), end: addDays(ws, 7).toISOString() }
    }
    const ms = startOfMonth(current)
    const me = endOfMonth(current)
    const start = startOfWeek(ms)
    return { start: start.toISOString(), end: addDays(me, 7).toISOString() }
  }

  async function load() {
    if (view === 'settings') return
    setLoading(true)
    try {
      const { start, end } = getRange()
      const [calRes, dealsRes, contactsRes] = await Promise.all([
        axios.get('/api/calendar', { headers, params: { start, end } }),
        axios.get('/api/deals', { headers }),
        axios.get('/api/contacts', { headers }),
      ])
      setItems(calRes.data)
      setDeals(dealsRes.data)
      setContacts(contactsRes.data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [view, current.getFullYear(), current.getMonth()])

  function navigate(dir) {
    const d = new Date(current)
    if (view === 'week') d.setDate(d.getDate() + dir * 7)
    else d.setMonth(d.getMonth() + dir)
    setCurrent(d)
  }

  function handleDayClick(day, dayItems) {
    setSelectedDay(day)
    setSelectedDayItems(dayItems)
  }

  function handleEventSave(saved) {
    setItems(prev => {
      const exists = prev.find(i => i.id === saved.id)
      return exists ? prev.map(i => i.id === saved.id ? saved : i) : [saved, ...prev]
    })
    setShowEventModal(false)
    setEditingEvent(null)
  }

  function handleEventDelete(id) {
    setItems(prev => prev.filter(i => i.id !== id))
    setShowEventModal(false)
    setEditingEvent(null)
  }

  const navLabel = view === 'week'
    ? `${startOfWeek(current).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(startOfWeek(current), 6).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
    : `${MONTHS[current.getMonth()]} ${current.getFullYear()}`

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-navy font-syne">Calendar</h1>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {['month', 'week', 'settings'].map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${view === v ? 'bg-teal text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {v === 'settings' ? '⚙ Schedule' : v}
              </button>
            ))}
          </div>
          {view !== 'settings' && (
            <button onClick={() => { setEditingEvent(null); setShowEventModal(true) }}
              className="bg-teal text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal/90">
              + Event
            </button>
          )}
        </div>
      </div>

      {view === 'settings' ? (
        <SchedulingPanel token={token} user={user} />
      ) : (
        <>
          {/* Nav bar */}
          <div className="flex items-center gap-4 mb-4">
            <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">‹</button>
            <span className="font-semibold text-navy w-56 text-center">{navLabel}</span>
            <button onClick={() => navigate(1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">›</button>
            <button onClick={() => setCurrent(new Date())} className="text-sm text-teal hover:underline ml-2">Today</button>
            {/* Legend */}
            <div className="ml-auto flex items-center gap-4">
              {Object.entries(TYPE_COLORS).map(([type, { dot, label }]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                  <span className="text-xs text-gray-500">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="text-center py-20 text-gray-400">Loading…</div>
          ) : view === 'month' ? (
            <MonthView current={current} items={items} onDayClick={handleDayClick} />
          ) : (
            <WeekView current={current} items={items} onDayClick={handleDayClick} />
          )}
        </>
      )}

      {showEventModal && (
        <EventModal
          event={editingEvent}
          initialDate={null}
          deals={deals}
          contacts={contacts}
          onClose={() => { setShowEventModal(false); setEditingEvent(null) }}
          onSave={handleEventSave}
          onDelete={handleEventDelete}
        />
      )}

      {selectedDay && (
        <DayPanel
          date={selectedDay}
          items={selectedDayItems}
          onClose={() => setSelectedDay(null)}
          onNew={date => {
            setEditingEvent({ start_at: `${date.toISOString().slice(0,10)}T09:00`, end_at: `${date.toISOString().slice(0,10)}T10:00` })
            setShowEventModal(true)
          }}
        />
      )}
    </div>
  )
}
