import { useEffect, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const PROVIDERS = ['gmail', 'smtp', 'sendgrid', 'postmark', 'ses', 'resend', 'other']

const AUTH_BADGE = {
  pass: 'bg-green-500/15 text-green-400',
  missing: 'bg-red-500/15 text-red-400',
  fail: 'bg-red-500/15 text-red-400',
  unknown: 'bg-slate-600/40 text-slate-400',
}

function AuthChip({ label, status }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${AUTH_BADGE[status] || AUTH_BADGE.unknown}`}>
      {label}: {status}
    </span>
  )
}

function healthColor(score) {
  if (score >= 80) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

export default function Deliverability() {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [mailboxes, setMailboxes] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [form, setForm] = useState({ email: '', provider: 'gmail', dailyCapTarget: 40, warmupEnabled: true, dkimSelector: '' })

  async function load() {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/deliverability/mailboxes', headers)
      setMailboxes(data.mailboxes)
    } catch {
      setStatus('Failed to load mailboxes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addMailbox(e) {
    e.preventDefault()
    if (!form.email.trim()) return
    setStatus('Adding…')
    try {
      await axios.post(
        '/api/deliverability/mailboxes',
        {
          email: form.email.trim(),
          provider: form.provider,
          dailyCapTarget: Number(form.dailyCapTarget),
          warmupEnabled: form.warmupEnabled,
          dkimSelector: form.dkimSelector.trim() || null,
        },
        headers
      )
      setForm({ email: '', provider: 'gmail', dailyCapTarget: 40, warmupEnabled: true, dkimSelector: '' })
      setStatus('')
      load()
    } catch (err) {
      setStatus(err.response?.data?.error || 'Failed to add mailbox.')
    }
  }

  async function patch(id, fields) {
    try {
      await axios.put(`/api/deliverability/mailboxes/${id}`, fields, headers)
      load()
    } catch (err) {
      setStatus(err.response?.data?.error || 'Update failed.')
    }
  }

  async function checkAuth(id) {
    setStatus('Checking DNS…')
    try {
      await axios.post(`/api/deliverability/mailboxes/${id}/check-auth`, {}, headers)
      setStatus('')
      load()
    } catch {
      setStatus('DNS check failed.')
    }
  }

  async function remove(id) {
    if (!window.confirm('Remove this mailbox?')) return
    try {
      await axios.delete(`/api/deliverability/mailboxes/${id}`, headers)
      setMailboxes((prev) => prev.filter((m) => m.id !== id))
    } catch {
      setStatus('Failed to remove mailbox.')
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Deliverability</h1>
        <p className="text-slate-400 text-sm mt-1">
          Sending mailboxes, domain authentication (SPF/DKIM/DMARC), warmup ramp, and engagement-aware
          throttling. New mailboxes ramp from a small daily cap to keep domains out of spam folders.
        </p>
      </div>

      {status && <div className="text-sm text-blue-400">{status}</div>}

      <form onSubmit={addMailbox} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
        <h2 className="font-medium text-slate-100">Add mailbox</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-100"
            placeholder="sender@yourdomain.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <select
            className="bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-100"
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <label className="text-sm text-slate-300 flex items-center gap-2">
            Daily cap target
            <input
              type="number"
              min={1}
              max={50}
              className="w-20 bg-slate-900 border border-slate-600 rounded-lg p-1.5 text-slate-100"
              value={form.dailyCapTarget}
              onChange={(e) => setForm({ ...form, dailyCapTarget: e.target.value })}
            />
          </label>
          <input
            className="bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-100"
            placeholder="DKIM selector (optional, e.g. google)"
            value={form.dkimSelector}
            onChange={(e) => setForm({ ...form, dkimSelector: e.target.value })}
          />
        </div>
        <label className="text-sm text-slate-300 flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.warmupEnabled}
            onChange={(e) => setForm({ ...form, warmupEnabled: e.target.checked })}
          />
          Warm up gradually (recommended for new domains)
        </label>
        <button className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2 text-sm">
          Add mailbox
        </button>
      </form>

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : mailboxes.length === 0 ? (
        <div className="text-slate-500 text-sm">No mailboxes yet. Add one above to start warming a sending domain.</div>
      ) : (
        <div className="space-y-3">
          {mailboxes.map((m) => (
            <div key={m.id} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-slate-100 font-medium">{m.email}</div>
                  <div className="text-xs text-slate-500">{m.provider} · {m.domain}</div>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-semibold ${healthColor(m.health_score)}`}>{m.health_score}</div>
                  <div className="text-xs text-slate-500">health</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <AuthChip label="SPF" status={m.spf_status} />
                <AuthChip label="DKIM" status={m.dkim_status} />
                <AuthChip label="DMARC" status={m.dmarc_status} />
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-600/40 text-slate-300">
                  {m.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-300">
                <span>Sent today: <strong className="text-slate-100">{m.sent_today}</strong> / {m.effective_daily_cap}</span>
                <span>Remaining: <strong className="text-slate-100">{m.remaining_today}</strong></span>
                <span>Target cap: {m.daily_cap_target}</span>
                <span>Warmup: {m.warmup_enabled ? 'on' : 'off'}</span>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => checkAuth(m.id)}
                  className="bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-1.5 text-xs"
                >
                  Check DNS auth
                </button>
                {m.status !== 'paused' ? (
                  <button
                    onClick={() => patch(m.id, { status: 'paused' })}
                    className="bg-slate-700 hover:bg-slate-600 text-yellow-300 rounded-lg px-3 py-1.5 text-xs"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={() => patch(m.id, { status: 'active' })}
                    className="bg-slate-700 hover:bg-slate-600 text-green-300 rounded-lg px-3 py-1.5 text-xs"
                  >
                    Resume
                  </button>
                )}
                <button
                  onClick={() => patch(m.id, { warmup_enabled: !m.warmup_enabled })}
                  className="bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-1.5 text-xs"
                >
                  {m.warmup_enabled ? 'Disable warmup' : 'Enable warmup'}
                </button>
                <button
                  onClick={() => remove(m.id)}
                  className="text-red-400 hover:text-red-300 rounded-lg px-3 py-1.5 text-xs"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
