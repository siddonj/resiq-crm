import { useEffect, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const REGIONS = ['US', 'EU', 'UK', 'CA', 'OTHER']

export default function Compliance() {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [config, setConfig] = useState({
    physical_mailing_address: '',
    compliance_region: 'US',
    unsubscribe_footer_enabled: true,
  })
  const [entries, setEntries] = useState([])
  const [search, setSearch] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [bulk, setBulk] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)

  async function loadAll() {
    setLoading(true)
    try {
      const [cfg, sup] = await Promise.all([
        axios.get('/api/compliance/config', headers),
        axios.get('/api/compliance/suppression', headers),
      ])
      setConfig(cfg.data.config)
      setEntries(sup.data.entries)
    } catch {
      setStatus('Failed to load compliance data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveConfig(e) {
    e.preventDefault()
    setStatus('Saving…')
    try {
      const { data } = await axios.put(
        '/api/compliance/config',
        {
          physicalMailingAddress: config.physical_mailing_address,
          complianceRegion: config.compliance_region,
          unsubscribeFooterEnabled: config.unsubscribe_footer_enabled,
        },
        headers
      )
      setConfig(data.config)
      setStatus('Settings saved.')
    } catch (err) {
      setStatus(err.response?.data?.error || 'Failed to save settings.')
    }
  }

  async function addEntry(e) {
    e.preventDefault()
    if (!newEmail.trim()) return
    try {
      await axios.post('/api/compliance/suppression', { email: newEmail.trim() }, headers)
      setNewEmail('')
      loadAll()
    } catch (err) {
      setStatus(err.response?.data?.error || 'Failed to add entry.')
    }
  }

  async function removeEntry(email) {
    try {
      await axios.delete('/api/compliance/suppression', { ...headers, data: { email } })
      setEntries((prev) => prev.filter((x) => x.email !== email))
    } catch {
      setStatus('Failed to remove entry.')
    }
  }

  async function importBulk(e) {
    e.preventDefault()
    const emails = bulk.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
    if (!emails.length) return
    try {
      const { data } = await axios.post('/api/compliance/suppression/import', { emails }, headers)
      setStatus(`Imported ${data.added}, skipped ${data.skipped}.`)
      setBulk('')
      loadAll()
    } catch (err) {
      setStatus(err.response?.data?.error || 'Failed to import.')
    }
  }

  const filtered = entries.filter((x) => x.email.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Outbound Compliance</h1>
        <p className="text-slate-400 text-sm mt-1">
          CAN-SPAM footer, opt-out handling, and your do-not-contact list. Suppressed recipients are blocked
          across every outbound channel.
        </p>
      </div>

      {status && <div className="text-sm text-blue-400">{status}</div>}

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : (
        <>
          <form onSubmit={saveConfig} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <h2 className="font-medium text-slate-100">CAN-SPAM settings</h2>
            <label className="block text-sm text-slate-300">
              Physical mailing address (required in every email)
              <textarea
                className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-100"
                rows={2}
                value={config.physical_mailing_address}
                onChange={(e) => setConfig({ ...config, physical_mailing_address: e.target.value })}
                placeholder="ResiQ Consulting, 123 Main St, Suite 100, City, ST 00000"
              />
            </label>
            <div className="flex items-center gap-4">
              <label className="text-sm text-slate-300">
                Region
                <select
                  className="ml-2 bg-slate-900 border border-slate-600 rounded-lg p-1.5 text-slate-100"
                  value={config.compliance_region}
                  onChange={(e) => setConfig({ ...config, compliance_region: e.target.value })}
                >
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-300 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.unsubscribe_footer_enabled}
                  onChange={(e) => setConfig({ ...config, unsubscribe_footer_enabled: e.target.checked })}
                />
                Append unsubscribe footer to sends
              </label>
            </div>
            <button className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2 text-sm">
              Save settings
            </button>
          </form>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <h2 className="font-medium text-slate-100">Do-not-contact list ({entries.length})</h2>
            <form onSubmit={addEntry} className="flex gap-2">
              <input
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-100"
                placeholder="email@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <button className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 text-sm">Suppress</button>
            </form>

            <form onSubmit={importBulk} className="space-y-2">
              <textarea
                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-100"
                rows={2}
                placeholder="Bulk import — paste emails separated by commas, spaces, or new lines"
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
              />
              <button className="bg-slate-600 hover:bg-slate-500 text-white rounded-lg px-3 py-1.5 text-sm">
                Import list
              </button>
            </form>

            <input
              className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-100"
              placeholder="Search suppression list…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="divide-y divide-slate-700 max-h-80 overflow-y-auto">
              {filtered.length === 0 && <div className="text-slate-500 text-sm py-3">No entries.</div>}
              {filtered.map((x) => (
                <div key={x.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="text-slate-100">{x.email}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {x.source}
                      {x.match_type === 'domain' ? ' · domain' : ''}
                    </span>
                  </div>
                  <button onClick={() => removeEntry(x.email)} className="text-red-400 hover:text-red-300 text-xs">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
