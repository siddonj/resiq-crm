import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import AskAIBtn from '../components/AskAIBtn'

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-yellow-100 text-yellow-700',
  signed: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-600',
}

const DEFAULT_SECTIONS = [
  { id: 'scope', title: 'Scope of Work', content: '' },
  { id: 'deliverables', title: 'Deliverables', content: '' },
  { id: 'terms', title: 'Terms & Conditions', content: '' },
]

const newLineItem = () => ({
  id: Math.random().toString(36).slice(2),
  description: '',
  quantity: 1,
  rate: 0,
  tax: 0,
  discount: 0,
})

function lineTotal(item) {
  const gross = item.quantity * item.rate
  const discounted = gross * (1 - item.discount / 100)
  return discounted * (1 + item.tax / 100)
}

function proposalTotal(lineItems) {
  return lineItems.reduce((sum, item) => sum + lineTotal(item), 0)
}

function generateHTML(proposal, deal, authorName) {
  const total = proposalTotal(proposal.line_items)

  const sectionHTML = proposal.sections
    .filter(s => s.content?.trim())
    .map(s => `
      <div style="margin-bottom:28px">
        <h2 style="font-size:15px;font-weight:600;color:#0f1f3d;margin:0 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:6px">${s.title}</h2>
        <p style="font-size:14px;color:#374151;white-space:pre-wrap;line-height:1.7;margin:0">${s.content}</p>
      </div>
    `).join('')

  const hasItems = proposal.line_items.some(i => i.description)
  const lineItemHTML = hasItems ? `
    <div style="margin-top:32px">
      <h2 style="font-size:15px;font-weight:600;color:#0f1f3d;margin:0 0 12px;border-bottom:1px solid #e5e7eb;padding-bottom:6px">Pricing</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:10px 14px;text-align:left;color:#6b7280;font-weight:500;border:1px solid #e5e7eb">Description</th>
            <th style="padding:10px 14px;text-align:right;color:#6b7280;font-weight:500;border:1px solid #e5e7eb">Qty</th>
            <th style="padding:10px 14px;text-align:right;color:#6b7280;font-weight:500;border:1px solid #e5e7eb">Rate</th>
            <th style="padding:10px 14px;text-align:right;color:#6b7280;font-weight:500;border:1px solid #e5e7eb">Total</th>
          </tr>
        </thead>
        <tbody>
          ${proposal.line_items.filter(i => i.description).map(item => `
            <tr>
              <td style="padding:9px 14px;border:1px solid #e5e7eb">${item.description}</td>
              <td style="padding:9px 14px;text-align:right;border:1px solid #e5e7eb">${item.quantity}</td>
              <td style="padding:9px 14px;text-align:right;border:1px solid #e5e7eb">$${Number(item.rate).toFixed(2)}</td>
              <td style="padding:9px 14px;text-align:right;font-weight:500;border:1px solid #e5e7eb">$${lineTotal(item).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#f9fafb">
            <td colspan="3" style="padding:10px 14px;font-weight:600;text-align:right;border:1px solid #e5e7eb">Total</td>
            <td style="padding:10px 14px;text-align:right;font-weight:700;font-size:15px;color:#0f1f3d;border:1px solid #e5e7eb">$${total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  ` : ''

  const signatureHTML = proposal.status === 'signed' && proposal.signature_name ? `
    <div style="margin-top:40px;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
      <p style="color:#15803d;font-weight:600;font-size:14px;margin:0">Electronically signed by ${proposal.signature_name}</p>
      <p style="color:#16a34a;font-size:12px;margin:6px 0 0">${new Date(proposal.signature_at).toLocaleString()}</p>
    </div>
  ` : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${proposal.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; margin: 0; padding: 48px; color: #1f2937; }
    @media print { body { padding: 24px; } @page { margin: 1cm; } }
  </style>
</head>
<body>
  <div style="max-width:720px;margin:0 auto">
    <div style="margin-bottom:36px;padding-bottom:24px;border-bottom:3px solid #0f1f3d">
      <h1 style="font-size:26px;font-weight:700;color:#0f1f3d;margin:0 0 8px">${proposal.title}</h1>
      ${deal ? `<p style="color:#6b7280;margin:0 0 4px;font-size:14px">Re: ${deal.title}</p>` : ''}
      <p style="color:#9ca3af;font-size:13px;margin:0">Prepared by ${authorName} &middot; ${new Date(proposal.created_at).toLocaleDateString()}</p>
    </div>
    ${sectionHTML}
    ${lineItemHTML}
    ${signatureHTML}
  </div>
</body>
</html>`
}

// ── Proposal edit/create modal ───────────────────────────────────────────────

function ProposalModal({ form, setForm, deals, editingId, saving, formError, onSubmit, onClose }) {
  const updateSection = (idx, field, value) => {
    const sections = form.sections.map((s, i) => i === idx ? { ...s, [field]: value } : s)
    setForm(f => ({ ...f, sections }))
  }

  const addItem = () => setForm(f => ({ ...f, line_items: [...f.line_items, newLineItem()] }))

  const removeItem = (id) => setForm(f => ({ ...f, line_items: f.line_items.filter(i => i.id !== id) }))

  const updateItem = (id, field, value) => {
    setForm(f => ({ ...f, line_items: f.line_items.map(i => i.id === id ? { ...i, [field]: value } : i) }))
  }

  const total = proposalTotal(form.line_items)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h3 className="font-syne text-lg font-bold text-navy">{editingId ? 'Edit Proposal' : 'New Proposal'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {formError && (
            <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">{formError}</div>
          )}
          
          <AskAIBtn 
            toolName="Proposals" 
            label="✨ Ask AI for a proposal copy template or pricing strategy"
            contextData={{ deal_id: form.deal_id, title: form.title, lineItems: form.line_items }}
          />

          {/* Basic info */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                placeholder="Proposal title"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Linked Deal</label>
              <select
                value={form.deal_id}
                onChange={e => setForm(f => ({ ...f, deal_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal bg-white"
              >
                <option value="">— No deal —</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
          </div>

          {/* Sections */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Sections</h4>
            <div className="space-y-3">
              {form.sections.map((section, idx) => (
                <div key={section.id} className="border border-gray-100 rounded-xl p-4">
                  <input
                    type="text"
                    value={section.title}
                    onChange={e => updateSection(idx, 'title', e.target.value)}
                    className="w-full text-sm font-semibold text-navy border-none border-b border-gray-100 pb-1 mb-2 focus:outline-none"
                    placeholder="Section title"
                  />
                  <textarea
                    value={section.content}
                    onChange={e => updateSection(idx, 'content', e.target.value)}
                    rows={3}
                    className="w-full text-sm text-gray-600 border-none focus:outline-none resize-none"
                    placeholder="Write section content…"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Line Items</h4>
              <button type="button" onClick={addItem} className="text-xs text-teal font-medium hover:text-teal/80">
                + Add Item
              </button>
            </div>
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Description</th>
                    <th className="text-right px-2 py-2 text-gray-500 font-medium w-10">Qty</th>
                    <th className="text-right px-2 py-2 text-gray-500 font-medium w-20">Rate ($)</th>
                    <th className="text-right px-2 py-2 text-gray-500 font-medium w-12">Tax %</th>
                    <th className="text-right px-2 py-2 text-gray-500 font-medium w-14">Disc %</th>
                    <th className="text-right px-3 py-2 text-gray-500 font-medium w-20">Total</th>
                    <th className="w-5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {form.line_items.map(item => (
                    <tr key={item.id}>
                      <td className="px-3 py-1.5">
                        <input type="text" value={item.description}
                          onChange={e => updateItem(item.id, 'description', e.target.value)}
                          className="w-full text-xs focus:outline-none" placeholder="Item description" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={item.quantity} min="0" step="1"
                          onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                          className="w-full text-right text-xs focus:outline-none" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={item.rate} min="0" step="0.01"
                          onChange={e => updateItem(item.id, 'rate', Number(e.target.value))}
                          className="w-full text-right text-xs focus:outline-none" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={item.tax} min="0" max="100"
                          onChange={e => updateItem(item.id, 'tax', Number(e.target.value))}
                          className="w-full text-right text-xs focus:outline-none" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={item.discount} min="0" max="100"
                          onChange={e => updateItem(item.id, 'discount', Number(e.target.value))}
                          className="w-full text-right text-xs focus:outline-none" />
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold text-navy">
                        ${lineTotal(item).toFixed(2)}
                      </td>
                      <td className="pr-2">
                        {form.line_items.length > 1 && (
                          <button type="button" onClick={() => removeItem(item.id)}
                            className="text-gray-300 hover:text-red-400 leading-none">&times;</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-100">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-xs font-semibold text-gray-600 text-right">Total</td>
                    <td className="px-3 py-2 text-sm font-bold text-navy text-right">${total.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={onSubmit} disabled={saving}
            className="flex-1 bg-teal text-white text-sm font-semibold py-2 rounded-lg hover:bg-teal/90 disabled:opacity-60">
            {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Proposal'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Preview modal ────────────────────────────────────────────────────────────

function PreviewModal({ proposal, deal, authorName, onClose, onStatusChange, onSign, onPrint }) {
  const total = proposalTotal(proposal.line_items)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="font-syne text-lg font-bold text-navy truncate">{proposal.title}</h3>
            <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[proposal.status]}`}>
              {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-4">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-2xl mx-auto">
            {/* Header */}
            <div className="mb-8 pb-6 border-b-2 border-navy">
              <h1 className="font-syne text-2xl font-bold text-navy">{proposal.title}</h1>
              {deal && <p className="text-brand-gray mt-1 text-sm">Re: {deal.title}</p>}
              <p className="text-gray-400 text-xs mt-1">
                Prepared by {authorName} &middot; {new Date(proposal.created_at).toLocaleDateString()}
              </p>
            </div>

            {/* Sections */}
            {proposal.sections.filter(s => s.content?.trim()).map(section => (
              <div key={section.id} className="mb-6">
                <h2 className="text-sm font-semibold text-navy mb-2 pb-1.5 border-b border-gray-100">{section.title}</h2>
                <p className="text-gray-600 text-sm whitespace-pre-wrap leading-relaxed">{section.content}</p>
              </div>
            ))}

            {/* Pricing table */}
            {proposal.line_items.some(i => i.description) && (
              <div className="mt-8">
                <h2 className="text-sm font-semibold text-navy mb-3 pb-1.5 border-b border-gray-100">Pricing</h2>
                <table className="w-full text-sm border border-gray-100 rounded-xl overflow-hidden">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-gray-500 font-medium text-xs">Description</th>
                      <th className="text-right px-4 py-2.5 text-gray-500 font-medium text-xs">Qty</th>
                      <th className="text-right px-4 py-2.5 text-gray-500 font-medium text-xs">Rate</th>
                      <th className="text-right px-4 py-2.5 text-gray-500 font-medium text-xs">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {proposal.line_items.filter(i => i.description).map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2.5 text-sm">{item.description}</td>
                        <td className="px-4 py-2.5 text-right text-sm">{item.quantity}</td>
                        <td className="px-4 py-2.5 text-right text-sm">${Number(item.rate).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-sm font-medium">${lineTotal(item).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-100">
                    <tr>
                      <td colSpan={3} className="px-4 py-2.5 text-sm font-semibold text-right">Total</td>
                      <td className="px-4 py-2.5 text-base font-bold text-navy text-right">${total.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Signature block */}
            {proposal.status === 'signed' && proposal.signature_name && (
              <div className="mt-8 p-4 bg-green-50 border border-green-200 rounded-xl">
                <p className="text-green-700 font-semibold text-sm">
                  Electronically signed by {proposal.signature_name}
                </p>
                <p className="text-green-600 text-xs mt-1">
                  {new Date(proposal.signature_at).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 flex-shrink-0">
          <button onClick={onPrint}
            className="text-sm text-gray-500 hover:text-teal border border-gray-200 px-4 py-2 rounded-lg transition-colors">
            Print / Save as PDF
          </button>
          <div className="flex gap-2">
            {proposal.status === 'draft' && (
              <button onClick={() => onStatusChange('sent')}
                className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                Send Proposal
              </button>
            )}
            {(proposal.status === 'sent' || proposal.status === 'viewed') && (
              <>
                <button onClick={() => onStatusChange('declined')}
                  className="border border-red-200 text-red-500 text-sm font-medium px-4 py-2 rounded-lg hover:bg-red-50 transition-colors">
                  Decline
                </button>
                <button onClick={onSign}
                  className="bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-green-700 transition-colors">
                  Sign
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

const EMPTY_FORM = () => ({
  title: '',
  deal_id: '',
  sections: DEFAULT_SECTIONS.map(s => ({ ...s })),
  line_items: [newLineItem()],
})

export default function Proposals() {
  const { token, user } = useAuth()
  const [searchParams] = useSearchParams()

  const [proposals, setProposals] = useState([])
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDeal, setFilterDeal] = useState(searchParams.get('deal_id') || '')

  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [previewProposal, setPreviewProposal] = useState(null)
  const [signTarget, setSignTarget] = useState(null)
  const [signName, setSignName] = useState('')

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  const fetchProposals = async () => {
    const params = {}
    if (filterStatus) params.status = filterStatus
    if (filterDeal) params.deal_id = filterDeal
    try {
      const { data } = await axios.get('/api/proposals', { ...authHeaders, params })
      setProposals(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    axios.get('/api/deals', authHeaders).then(r => setDeals(r.data)).catch(console.error)
  }, [token])

  useEffect(() => {
    fetchProposals()
  }, [token, filterStatus, filterDeal])

  const openNew = () => {
    const f = EMPTY_FORM()
    if (filterDeal) f.deal_id = filterDeal
    setForm(f)
    setFormError('')
    setEditingId(null)
    setShowModal(true)
  }

  const openEdit = (p) => {
    setForm({
      title: p.title,
      deal_id: p.deal_id || '',
      sections: p.sections?.length ? p.sections : DEFAULT_SECTIONS.map(s => ({ ...s })),
      line_items: p.line_items?.length ? p.line_items : [newLineItem()],
    })
    setFormError('')
    setEditingId(p.id)
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!form.title.trim()) { setFormError('Title is required'); return }
    setSaving(true)
    setFormError('')
    try {
      const payload = {
        title: form.title,
        deal_id: form.deal_id || null,
        sections: form.sections,
        line_items: form.line_items,
      }
      if (editingId) {
        const { data } = await axios.put(`/api/proposals/${editingId}`, payload, authHeaders)
        setProposals(prev => prev.map(p => p.id === editingId ? data : p))
      } else {
        const { data } = await axios.post('/api/proposals', payload, authHeaders)
        setProposals(prev => [data, ...prev])
      }
      setShowModal(false)
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this proposal?')) return
    try {
      await axios.delete(`/api/proposals/${id}`, authHeaders)
      setProposals(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  const handleStatusChange = async (id, status) => {
    try {
      const { data } = await axios.patch(`/api/proposals/${id}/status`, { status }, authHeaders)
      setProposals(prev => prev.map(p => p.id === id ? data : p))
      if (previewProposal?.id === id) setPreviewProposal(data)
    } catch (err) {
      console.error(err)
    }
  }

  const handleSign = async () => {
    if (!signName.trim()) return
    try {
      const { data } = await axios.post(`/api/proposals/${signTarget.id}/sign`, { name: signName }, authHeaders)
      setProposals(prev => prev.map(p => p.id === signTarget.id ? data : p))
      setSignTarget(null)
      setSignName('')
    } catch (err) {
      console.error(err)
    }
  }

  const handlePrint = (proposal) => {
    const deal = deals.find(d => d.id === proposal.deal_id)
    const html = generateHTML(proposal, deal, user?.name || '')
    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 400)
  }

  const getDeal = (deal_id) => deals.find(d => d.id === deal_id)

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-syne text-2xl font-bold text-navy">Proposals</h2>
          <p className="text-brand-gray text-sm mt-0.5">Build and track client proposals</p>
        </div>
        <button onClick={openNew}
          className="bg-teal text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-teal/90 transition-colors">
          + New Proposal
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal">
          <option value="">All Statuses</option>
          {['draft', 'sent', 'viewed', 'signed', 'declined'].map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <select value={filterDeal} onChange={e => setFilterDeal(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal">
          <option value="">All Deals</option>
          {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-brand-gray text-sm">Loading…</p>
      ) : proposals.length === 0 ? (
        <div className="text-center py-24 text-brand-gray">
          <p className="text-5xl mb-4">📄</p>
          <p className="font-medium text-navy">No proposals yet</p>
          <p className="text-sm mt-1">Create your first proposal to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map(proposal => {
            const deal = getDeal(proposal.deal_id)
            const total = proposalTotal(proposal.line_items)
            return (
              <div key={proposal.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center justify-between gap-4 hover:shadow-md transition-shadow">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-semibold text-navy">{proposal.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[proposal.status]}`}>
                      {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 flex-wrap">
                    {deal && <p className="text-brand-gray text-sm">{deal.title}</p>}
                    {total > 0 && <p className="text-teal text-sm font-semibold">${total.toFixed(2)}</p>}
                    <p className="text-gray-400 text-xs">{new Date(proposal.created_at).toLocaleDateString()}</p>
                  </div>
                  {proposal.status === 'signed' && proposal.signature_name && (
                    <p className="text-xs text-green-600 mt-1">
                      Signed by {proposal.signature_name} · {new Date(proposal.signature_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => setPreviewProposal(proposal)}
                    className="text-xs text-gray-500 hover:text-teal border border-gray-200 px-3 py-1.5 rounded-lg transition-colors">
                    Preview
                  </button>
                  {proposal.status === 'draft' && (
                    <button onClick={() => openEdit(proposal)}
                      className="text-xs text-gray-500 hover:text-teal border border-gray-200 px-3 py-1.5 rounded-lg transition-colors">
                      Edit
                    </button>
                  )}
                  <button onClick={() => handleDelete(proposal.id)}
                    className="text-xs text-red-400 hover:text-red-600 border border-red-100 px-3 py-1.5 rounded-lg transition-colors">
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <ProposalModal
          form={form}
          setForm={setForm}
          deals={deals}
          editingId={editingId}
          saving={saving}
          formError={formError}
          onSubmit={handleSubmit}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Preview Modal */}
      {previewProposal && (
        <PreviewModal
          proposal={previewProposal}
          deal={getDeal(previewProposal.deal_id)}
          authorName={user?.name || ''}
          onClose={() => setPreviewProposal(null)}
          onStatusChange={(status) => handleStatusChange(previewProposal.id, status)}
          onSign={() => { setSignTarget(previewProposal); setPreviewProposal(null) }}
          onPrint={() => handlePrint(previewProposal)}
        />
      )}

      {/* Sign Modal */}
      {signTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-syne text-lg font-bold text-navy mb-1">Sign Proposal</h3>
            <p className="text-brand-gray text-sm mb-5">{signTarget.title}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={signName}
                  onChange={e => setSignName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSign()}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                  placeholder="Type your full name to sign"
                  autoFocus
                />
              </div>
              <p className="text-xs text-gray-400">
                By entering your name and clicking Sign, you agree to the terms in this proposal.
                Timestamp: {new Date().toLocaleString()}
              </p>
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setSignTarget(null); setSignName('') }}
                  className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={handleSign} disabled={!signName.trim()}
                  className="flex-1 bg-green-600 text-white text-sm font-semibold py-2 rounded-lg hover:bg-green-700 disabled:opacity-50">
                  Sign Proposal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
