import { useState, useEffect } from 'react'
import axios from 'axios'

const DEFAULT_HTML = `<div style="font-family:sans-serif;padding:32px;max-width:700px;margin:auto">
  <h1 style="color:#0f1f3d;font-size:24px">{{title}}</h1>
  <p style="color:#6b7280;font-size:13px">Invoice #{{number}} | Due: {{due_date}}</p>
  {{line_items}}
  {{payment_section}}
</div>`

const DEFAULT_CSS = `body { margin: 0; }`

export default function InvoiceTemplates({ token }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [previewTpl, setPreviewTpl] = useState(null)

  const headers = { Authorization: `Bearer ${token}` }

  async function load() {
    setLoading(true)
    try {
      const res = await axios.get('/api/invoices/templates/all', { headers })
      setTemplates(res.data || [])
    } catch (_) {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id) {
    if (!confirm('Delete this template?')) return
    try {
      await axios.delete(`/api/invoices/templates/${id}`, { headers })
      load()
    } catch (_) { alert('Failed to delete') }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">Manage invoice templates used when generating PDFs and previews.</p>
        <button
          onClick={() => { setEditing(null); setShowModal(true) }}
          className="bg-teal text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal/90"
        >
          + New Template
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center">No templates yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(t => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-navy text-sm">{t.name}</div>
                  {t.is_default && (
                    <span className="text-xs bg-teal/10 text-teal px-2 py-0.5 rounded-full font-medium">Default</span>
                  )}
                </div>
              </div>
              {t.description && <p className="text-xs text-gray-500">{t.description}</p>}
              <div className="flex gap-2 mt-auto">
                <button
                  onClick={() => setPreviewTpl(t)}
                  className="flex-1 text-xs border rounded-lg px-3 py-1.5 hover:bg-gray-50"
                >
                  Preview
                </button>
                <button
                  onClick={() => { setEditing(t); setShowModal(true) }}
                  className="flex-1 text-xs border rounded-lg px-3 py-1.5 hover:bg-gray-50"
                >
                  Edit
                </button>
                {!t.is_default && (
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="text-xs border border-red-200 text-red-500 rounded-lg px-3 py-1.5 hover:bg-red-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <TemplateModal
          template={editing}
          token={token}
          onClose={() => setShowModal(false)}
          onSave={() => { setShowModal(false); load() }}
        />
      )}

      {previewTpl && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-navy">{previewTpl.name} — Preview</h3>
              <button onClick={() => setPreviewTpl(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <style>{previewTpl.css || ''}</style>
              <div dangerouslySetInnerHTML={{ __html: (previewTpl.html_content || '').replace('{{title}}', 'Sample Invoice').replace('{{number}}', 'INV-001').replace('{{due_date}}', '2026-06-01').replace('{{line_items}}', '<p style="color:#6b7280;font-size:13px">[Line items appear here]</p>').replace('{{payment_section}}', '') }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TemplateModal({ template, token, onClose, onSave }) {
  const [name, setName] = useState(template?.name || '')
  const [description, setDescription] = useState(template?.description || '')
  const [htmlContent, setHtmlContent] = useState(template?.html_content || DEFAULT_HTML)
  const [css, setCss] = useState(template?.css || DEFAULT_CSS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const headers = { Authorization: `Bearer ${token}` }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { name, description, html_content: htmlContent, css }
      if (template?.id) {
        await axios.put(`/api/invoices/templates/${template.id}`, payload, { headers })
      } else {
        await axios.post('/api/invoices/templates', payload, { headers })
      }
      onSave()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold text-navy">{template?.id ? 'Edit Template' : 'New Template'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Standard, Minimal, Branded"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional description"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">HTML Content</label>
            <p className="text-xs text-gray-400 mb-1">Use placeholders: {'{{title}}'}, {'{{number}}'}, {'{{due_date}}'}, {'{{line_items}}'}, {'{{payment_section}}'}</p>
            <textarea
              value={htmlContent}
              onChange={e => setHtmlContent(e.target.value)}
              rows={10}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CSS</label>
            <textarea
              value={css}
              onChange={e => setCss(e.target.value)}
              rows={4}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-teal text-white rounded-lg text-sm font-medium hover:bg-teal/90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
