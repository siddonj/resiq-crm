import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function EmailCampaigns() {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [tab, setTab] = useState('campaigns')
  const [campaigns, setCampaigns] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Campaign form
  const [form, setForm] = useState({ name: '', template_id: '', subject: '', body_html: '', segment_filter: null })

  // Template form
  const [tplForm, setTplForm] = useState({ name: '', subject: '', body_html: '', category: 'general' })

  // Segment builder
  const [segment, setSegment] = useState({ types: [], tags: [], search: '' })
  const [segmentPreview, setSegmentPreview] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [camps, tmpls] = await Promise.all([
        axios.get('/api/email-campaigns', headers),
        axios.get('/api/email-campaigns/templates', headers),
      ])
      setCampaigns(camps.data)
      setTemplates(tmpls.data)
    } catch (err) {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const previewSegment = async () => {
    try {
      const res = await axios.post('/api/email-campaigns/preview-segment', { filter: segment }, headers)
      setSegmentPreview(res.data)
      setForm(f => ({ ...f, segment_filter: segment }))
    } catch (err) {
      setError('Failed to preview segment')
    }
  }

  const createCampaign = async (e) => {
    e.preventDefault()
    try {
      const res = await axios.post('/api/email-campaigns', {
        ...form,
        segment_filter: segment,
      }, headers)
      setSuccess(`Campaign "${res.data.name}" created`)
      setForm({ name: '', template_id: '', subject: '', body_html: '', segment_filter: null })
      loadData()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create campaign')
    }
  }

  const createTemplate = async (e) => {
    e.preventDefault()
    try {
      await axios.post('/api/email-campaigns/templates', tplForm, headers)
      setSuccess('Template created')
      setTplForm({ name: '', subject: '', body_html: '', category: 'general' })
      loadData()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create template')
    }
  }

  const handleSend = async (id) => {
    try {
      const res = await axios.post(`/api/email-campaigns/${id}/send`, {}, headers)
      if (res.data.queued) {
        setSuccess(`Sending to ${res.data.recipients} recipients`)
      }
      loadData()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send')
    }
  }

  const handlePause = async (id) => {
    try {
      await axios.post(`/api/email-campaigns/${id}/pause`, {}, headers)
      setSuccess('Campaign paused')
      loadData()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to pause')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this campaign?')) return
    try {
      await axios.delete(`/api/email-campaigns/${id}`, headers)
      setSuccess('Campaign deleted')
      loadData()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete')
    }
  }

  const statusBadge = (status) => {
    const colors = {
      draft: 'bg-gray-100 text-gray-600',
      scheduled: 'bg-blue-100 text-blue-700',
      sending: 'bg-yellow-100 text-yellow-700',
      sent: 'bg-green-100 text-green-700',
      paused: 'bg-orange-100 text-orange-700',
      cancelled: 'bg-red-100 text-red-700',
    }
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>{status}</span>
  }

  if (loading) return <div className="p-8"><p className="text-gray-500">Loading...</p></div>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-navy mb-6">Email Campaigns</h1>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">{success}</div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {['campaigns', 'templates', 'create-campaign', 'create-template'].map(t => (
          <button key={t}
            onClick={() => { setTab(t); setError(''); setSuccess('') }}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? 'border-teal text-teal' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >{t.replace('-', ' ')}</button>
        ))}
      </div>

      {/* ── Campaign List ──────────────────────────────────────── */}
      {tab === 'campaigns' && (
        <div className="bg-white rounded-lg shadow-sm border">
          {campaigns.length === 0 ? (
            <p className="p-8 text-center text-gray-400">No campaigns yet. Create one to get started.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500 uppercase">
                  <th className="p-3 font-medium">Name</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Sent</th>
                  <th className="p-3 font-medium">Opens</th>
                  <th className="p-3 font-medium">Rate</th>
                  <th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="p-3 font-medium text-navy">{c.name}</td>
                    <td className="p-3">{statusBadge(c.status)}</td>
                    <td className="p-3 text-gray-600">{c.sent_count || 0}/{c.total_recipients || 0}</td>
                    <td className="p-3 text-gray-600">{c.open_count || 0}</td>
                    <td className="p-3 text-gray-600">
                      {c.sent_count > 0 ? `${Math.round((c.open_count / c.sent_count) * 100)}%` : '-'}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex gap-1 justify-end">
                        {c.status === 'draft' && (
                          <button onClick={() => handleSend(c.id)}
                            className="px-3 py-1 text-xs bg-teal text-white rounded hover:bg-teal/90">Send</button>
                        )}
                        {c.status === 'sending' && (
                          <button onClick={() => handlePause(c.id)}
                            className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600">Pause</button>
                        )}
                        {(c.status === 'draft' || c.status === 'scheduled' || c.status === 'paused') && (
                          <button onClick={() => handleDelete(c.id)}
                            className="px-3 py-1 text-xs bg-gray-200 text-gray-600 rounded hover:bg-gray-300">Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Templates ──────────────────────────────────────────── */}
      {tab === 'templates' && (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.length === 0 ? (
            <p className="p-8 text-center text-gray-400 col-span-2">No templates yet.</p>
          ) : templates.map(t => (
            <div key={t.id} className="bg-white rounded-lg shadow-sm border p-4">
              <h3 className="font-semibold text-navy">{t.name}</h3>
              <p className="text-xs text-gray-500 mt-1">Subject: {t.subject}</p>
              <p className="text-xs text-gray-400 mt-1 capitalize">{t.category}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Create Campaign ────────────────────────────────────── */}
      {tab === 'create-campaign' && (
        <form onSubmit={createCampaign} className="bg-white rounded-lg shadow-sm border p-6 space-y-4 max-w-2xl">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
            <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
              className="w-full px-3 py-2 border rounded-lg text-sm" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
            <select value={form.template_id} onChange={e => {
              const tpl = templates.find(t => t.id === e.target.value)
              setForm(f => ({...f, template_id: e.target.value, subject: tpl?.subject || '', body_html: tpl?.body_html || ''}))
            }} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="">None (enter subject/body manually)</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <input value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))}
              className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Hello {{contact.name}}!" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">HTML Body</label>
            <textarea value={form.body_html} onChange={e => setForm(f => ({...f, body_html: e.target.value}))}
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono" rows={8}
              placeholder={'<h1>Hello {{contact.name}}!</h1>\n<p>Your content here.</p>'} />
            <p className="text-xs text-gray-400 mt-1">Use {'{{contact.name}}'} and {'{{contact.company}}'} for personalization</p>
          </div>

          {/* Segment Builder */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Target Segment</label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-500">Contact Types</label>
                <select multiple value={segment.types} onChange={e => setSegment(s => ({...s, types: Array.from(e.target.selectedOptions, o => o.value)}))}
                  className="w-full px-2 py-1 border rounded text-sm h-20">
                  <option value="lead">Lead</option>
                  <option value="prospect">Prospect</option>
                  <option value="partner">Partner</option>
                  <option value="vendor">Vendor</option>
                  <option value="customer">Customer</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Search</label>
                <input value={segment.search} onChange={e => setSegment(s => ({...s, search: e.target.value}))}
                  placeholder="name or email..."
                  className="w-full px-2 py-1 border rounded text-sm" />
              </div>
              <div className="flex items-end">
                <button type="button" onClick={previewSegment}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 border rounded text-sm hover:bg-gray-200">
                  Preview
                </button>
              </div>
            </div>
            {segmentPreview && (
              <p className="text-xs text-gray-500 mt-1">
                {segmentPreview.count} contacts in segment
                {segmentPreview.count > 0 && (
                  <span className="text-gray-400 ml-1">
                    (e.g. {segmentPreview.contacts.slice(0, 3).map(c => c.name || c.email).join(', ')}...)
                  </span>
                )}
              </p>
            )}
          </div>

          <button type="submit" className="px-4 py-2 bg-teal text-white rounded-lg text-sm font-medium hover:bg-teal/90">
            Create Campaign
          </button>
        </form>
      )}

      {/* ── Create Template ─────────────────────────────────────── */}
      {tab === 'create-template' && (
        <form onSubmit={createTemplate} className="bg-white rounded-lg shadow-sm border p-6 space-y-4 max-w-2xl">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
            <input value={tplForm.name} onChange={e => setTplForm(f => ({...f, name: e.target.value}))}
              className="w-full px-3 py-2 border rounded-lg text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select value={tplForm.category} onChange={e => setTplForm(f => ({...f, category: e.target.value}))}
              className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="general">General</option>
              <option value="newsletter">Newsletter</option>
              <option value="announcement">Announcement</option>
              <option value="follow-up">Follow-up</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <input value={tplForm.subject} onChange={e => setTplForm(f => ({...f, subject: e.target.value}))}
              className="w-full px-3 py-2 border rounded-lg text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">HTML Body</label>
            <textarea value={tplForm.body_html} onChange={e => setTplForm(f => ({...f, body_html: e.target.value}))}
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono" rows={10} required
              placeholder={'<h1>Hello {{contact.name}}!</h1>\n<p>Body with {{contact.company}} variable.</p>'} />
          </div>
          <button type="submit" className="px-4 py-2 bg-teal text-white rounded-lg text-sm font-medium hover:bg-teal/90">
            Save Template
          </button>
        </form>
      )}
    </div>
  )
}
