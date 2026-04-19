import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

const DAYS_MAP = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function addMinutes(d, m) {
  return new Date(d.getTime() + m * 60000)
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function generateSlots(date, availability, slotDuration, booked) {
  const dayName = DAYS_MAP[date.getDay()]
  const windows = availability[dayName] || []
  const slots = []

  for (const window of windows) {
    const [sh, sm] = window.start.split(':').map(Number)
    const [eh, em] = window.end.split(':').map(Number)
    let slot = new Date(date)
    slot.setHours(sh, sm, 0, 0)
    const end = new Date(date)
    end.setHours(eh, em, 0, 0)

    while (addMinutes(slot, slotDuration) <= end) {
      const slotEnd = addMinutes(slot, slotDuration)
      // Skip if in the past
      if (slot > new Date()) {
        // Check conflicts
        const conflict = booked.some(b => {
          const bs = new Date(b.start_at), be = new Date(b.end_at)
          return bs < slotEnd && be > slot
        })
        if (!conflict) slots.push({ start: new Date(slot), end: slotEnd })
      }
      slot = addMinutes(slot, slotDuration)
    }
  }
  return slots
}

export default function BookingPage() {
  const { slug } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [step, setStep] = useState('date') // 'date' | 'slot' | 'form' | 'done'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [currentMonth, setCurrentMonth] = useState(new Date())

  useEffect(() => {
    async function load() {
      try {
        const res = await axios.get(`/api/calendar/book/${slug}`)
        setData(res.data)
      } catch (err) {
        setError(err.response?.data?.error || 'Page not found')
      } finally { setLoading(false) }
    }
    load()
  }, [slug])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400">Loading…</div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">😕</div>
        <h1 className="text-xl font-semibold text-gray-700">{error}</h1>
        <p className="text-gray-400 mt-2">This scheduling page doesn't exist or is unavailable.</p>
      </div>
    </div>
  )

  const { settings, booked } = data
  const availability = settings.availability || {}

  // Build calendar days (current month + next 60 days)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
  const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)
  const gridStart = new Date(monthStart); gridStart.setDate(monthStart.getDate() - monthStart.getDay())

  const cells = []
  let d = new Date(gridStart)
  while (d <= monthEnd || cells.length % 7 !== 0) {
    cells.push(new Date(d))
    d = new Date(d); d.setDate(d.getDate() + 1)
    if (cells.length > 42) break
  }

  function hasSlots(day) {
    if (day < today) return false
    const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 60)
    if (day > maxDate) return false
    return generateSlots(day, availability, settings.slot_duration, booked).length > 0
  }

  function handleDateSelect(day) {
    setSelectedDate(day)
    setSelectedSlot(null)
    setStep('slot')
  }

  const slots = selectedDate ? generateSlots(selectedDate, availability, settings.slot_duration, booked) : []

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) { setSubmitError('Name and email are required'); return }
    setSubmitting(true); setSubmitError('')
    try {
      await axios.post(`/api/calendar/book/${slug}`, {
        name, email, notes,
        start_at: selectedSlot.start.toISOString(),
        end_at: selectedSlot.end.toISOString(),
      })
      setStep('done')
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Failed to book. Please try again.')
    } finally { setSubmitting(false) }
  }

  const fmtTime = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const fmtDate = d => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-navy px-8 py-6">
          <h1 className="text-xl font-bold text-white font-syne">{settings.title}</h1>
          {settings.owner_name && <p className="text-brand-gray text-sm mt-0.5">with {settings.owner_name}</p>}
          {settings.description && <p className="text-white/70 text-sm mt-2">{settings.description}</p>}
          <div className="flex items-center gap-2 mt-3 text-brand-gray text-sm">
            <span>⏱</span>
            <span>{settings.slot_duration} min meeting</span>
          </div>
        </div>

        {/* Body */}
        <div className="p-8">
          {step === 'done' ? (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="text-xl font-bold text-navy mb-2">You're booked!</h2>
              <p className="text-gray-500">
                <strong>{fmtDate(selectedSlot.start)}</strong> at <strong>{fmtTime(selectedSlot.start)}</strong>
              </p>
              <p className="text-gray-400 text-sm mt-2">A confirmation has been noted. See you then!</p>
            </div>
          ) : step === 'form' ? (
            <div>
              <button onClick={() => setStep('slot')} className="text-sm text-teal hover:underline mb-4">← Back</button>
              <h2 className="font-semibold text-navy mb-1">Your details</h2>
              <p className="text-sm text-gray-500 mb-5">
                {fmtDate(selectedSlot.start)} · {fmtTime(selectedSlot.start)} – {fmtTime(selectedSlot.end)}
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                {submitError && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{submitError}</div>}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Anything you'd like to share beforehand…"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal resize-none" />
                </div>
                <button type="submit" disabled={submitting}
                  className="w-full bg-teal text-white py-2.5 rounded-lg font-medium hover:bg-teal/90 disabled:opacity-50">
                  {submitting ? 'Confirming…' : 'Confirm Booking'}
                </button>
              </form>
            </div>
          ) : step === 'slot' ? (
            <div>
              <button onClick={() => setStep('date')} className="text-sm text-teal hover:underline mb-4">← Back</button>
              <h2 className="font-semibold text-navy mb-1">Choose a time</h2>
              <p className="text-sm text-gray-500 mb-5">{fmtDate(selectedDate)}</p>
              {slots.length === 0 ? (
                <p className="text-gray-400 text-sm">No available slots on this day. Please pick another date.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((slot, i) => (
                    <button key={i} onClick={() => { setSelectedSlot(slot); setStep('form') }}
                      className="border border-teal text-teal rounded-lg py-2 text-sm font-medium hover:bg-teal hover:text-white transition-colors">
                      {fmtTime(slot.start)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 className="font-semibold text-navy mb-4">Choose a date</h2>
              {/* Month nav */}
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() - 1))}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-500">‹</button>
                <span className="font-medium text-gray-700">{MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
                <button onClick={() => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + 1))}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-500">›</button>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                  <div key={d} className="text-center text-xs text-gray-400 font-medium py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => {
                  const inMonth = day.getMonth() === currentMonth.getMonth()
                  const available = inMonth && hasSlots(day)
                  const isToday = isSameDay(day, today)
                  return (
                    <button key={i}
                      disabled={!available}
                      onClick={() => available && handleDateSelect(day)}
                      className={`aspect-square rounded-lg text-sm font-medium transition-colors
                        ${!inMonth ? 'text-gray-200 cursor-default' :
                          available ? 'text-navy hover:bg-teal hover:text-white border border-teal/30' :
                          'text-gray-300 cursor-default'}
                        ${isToday && available ? 'border-teal font-bold' : ''}
                      `}>
                      {day.getDate()}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
