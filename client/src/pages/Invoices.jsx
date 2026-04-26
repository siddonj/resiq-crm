import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import AskAIBtn from '../components/AskAIBtn'

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-600',
}

const STATUS_FLOW = {
  draft: ['sent'],
  sent: ['paid', 'overdue'],
  paid: [],
  overdue: ['paid'],
}

const newLineItem = () => ({
  id: Math.random().toString(36).slice(2),
  description: '',
  quantity: 1,
  rate: 0,
  tax: 0,
  discount: 0,
})

function lineTotal(item) {
  const gross = Number(item.quantity) * Number(item.rate)
  const discounted = gross * (1 - Number(item.discount || 0) / 100)
  return discounted * (1 + Number(item.tax || 0) / 100)
}

function invoiceTotal(lineItems) {
  return lineItems.reduce((sum, item) => sum + lineTotal(item), 0)
}

function generateHTML(invoice, authorName) {
  const total = invoiceTotal(invoice.line_items)

  const lineItemHTML = invoice.line_items.some(i => i.description) ? `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:20px">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:10px 14px;text-align:left;color:#6b7280;font-weight:500;border:1px solid #e5e7eb">Description</th>
          <th style="padding:10px 14px;text-align:right;color:#6b7280;font-weight:500;border:1px solid #e5e7eb">Qty</th>
          <th style="padding:10px 14px;text-align:right;color:#6b7280;font-weight:500;border:1px solid #e5e7eb">Rate</th>
          <th style="padding:10px 14px;text-align:right;color:#6b7280;font-weight:500;border:1px solid #e5e7eb">Tax%</th>
          <th style="padding:10px 14px;text-align:right;color:#6b7280;font-weight:500;border:1px solid #e5e7eb">Disc%</th>
          <th style="padding:10px 14px;text-align:right;color:#6b7280;font-weight:500;border:1px solid #e5e7eb">Total</th>
        </tr>
      </thead>
      <tbody>
        ${invoice.line_items.filter(i => i.description).map(item => `
          <tr>
            <td style="padding:9px 14px;border:1px solid #e5e7eb">${item.description}</td>
            <td style="padding:9px 14px;text-align:right;border:1px solid #e5e7eb">${item.quantity}</td>
            <td style="padding:9px 14px;text-align:right;border:1px solid #e5e7eb">$${Number(item.rate).toFixed(2)}</td>
            <td style="padding:9px 14px;text-align:right;border:1px solid #e5e7eb">${item.tax || 0}%</td>
            <td style="padding:9px 14px;text-align:right;border:1px solid #e5e7eb">${item.discount || 0}%</td>
            <td style="padding:9px 14px;text-align:right;font-weight:500;border:1px solid #e5e7eb">$${lineTotal(item).toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr style="background:#f9fafb">
          <td colspan="5" style="padding:10px 14px;font-weight:600;text-align:right;border:1px solid #e5e7eb">Total</td>
          <td style="padding:10px 14px;text-align:right;font-weight:700;font-size:15px;color:#0f1f3d;border:1px solid #e5e7eb">$${total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  ` : ''

  const paymentHTML = invoice.stripe_payment_url ? `
    <div style="margin-top:28px;padding:14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;text-align:center">
      <a href="${invoice.stripe_payment_url}" style="color:#1d4ed8;font-weight:600;font-size:14px;text-decoration:none">Pay Online →</a>
    </div>
  ` : ''

  const paidHTML = invoice.status === 'paid' ? `
    <div style="margin-top:28px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
      <p style="color:#15803d;font-weight:600;font-size:14px;margin:0">PAID${invoice.paid_at ? ` — ${new Date(invoice.paid_at).toLocaleDateString()}` : ''}</p>
    </div>
  ` : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${invoice.invoice_number} — ${invoice.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; margin: 0; padding: 48px; color: #1f2937; }
    @media print { body { padding: 24px; } @page { margin: 1cm; } }
  </style>
</head>
<body>
  <div style="max-width:760px;margin:0 auto">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px">
      <div>
        <h1 style="font-size:28px;font-weight:700;color:#0f1f3d;margin:0">${invoice.invoice_number}</h1>
        <p style="font-size:16px;color:#374151;margin:4px 0 0">${invoice.title}</p>
        ${invoice.contact_name ? `<p style="color:#6b7280;font-size:14px;margin:4px 0 0">Client: ${invoice.contact_name}</p>` : ''}
      </div>
      <div style="text-align:right">
        <span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${invoice.status === 'paid' ? '#f0fdf4' : invoice.status === 'overdue' ? '#fef2f2' : '#eff6ff'};color:${invoice.status === 'paid' ? '#15803d' : invoice.status === 'overdue' ? '#dc2626' : '#1d4ed8'};text-transform:uppercase">${invoice.status}</span>
        ${invoice.due_date ? `<p style="color:#6b7280;font-size:13px;margin:8px 0 0">Due: ${new Date(invoice.due_date).toLocaleDateString()}</p>` : ''}
        <p style="color:#9ca3af;font-size:12px;margin:4px 0 0">Issued: ${new Date(invoice.created_at).toLocaleDateString()}</p>
      </div>
    </div>
    ${lineItemHTML}
    ${invoice.notes ? `<div style="margin-top:28px"><h3 style="font-size:13px;font-weight:600;color:#6b7280;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em">Notes</h3><p style="font-size:14px;color:#374151;white-space:pre-wrap;margin:0">${invoice.notes}</p></div>` : ''}
    ${paymentHTML}
    ${paidHTML}
  </div>
</body>
</html>`
}

// ── Invoice Form Modal ──────────────────────────────────────────────────────
function InvoiceModal({ invoice, proposals, onClose, onSave }) {
  const [title, setTitle] = useState(invoice?.title || '')
  const [proposalId, setProposalId] = useState(invoice?.proposal_id || '')
  const [lineItems, setLineItems] = useState(
    invoice?.line_items?.length ? invoice.line_items : [newLineItem()]
  )
  const [notes, setNotes] = useState(invoice?.notes || '')
  const [dueDate, setDueDate] = useState(invoice?.due_date ? invoice.due_date.slice(0, 10) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { token } = useAuth()

  function updateItem(id, field, value) {
    setLineItems(items => items.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  function removeItem(id) {
    setLineItems(items => items.filter(i => i.id !== id))
  }

  async function handleProposalImport(pid) {
    if (!pid) { setProposalId(''); return }
    setProposalId(pid)
    try {
      const res = await axios.get(`/api/proposals/${pid}`, { headers: { Authorization: `Bearer ${token}` } })
      const p = res.data
      if (!title) setTitle(p.title)
      if (p.line_items?.length) setLineItems(p.line_items.map(i => ({ ...i, id: i.id || Math.random().toString(36).slice(2) })))
    } catch (_) {}
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { title, proposal_id: proposalId || null, line_items: lineItems, notes, due_date: dueDate || null }
      let res
      if (invoice?.id) {
        res = await axios.put(`/api/invoices/${invoice.id}`, payload, { headers: { Authorization: `Bearer ${token}` } })
      } else {
        res = await axios.post('/api/invoices', payload, { headers: { Authorization: `Bearer ${token}` } })
      }
      onSave(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const total = invoiceTotal(lineItems)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold text-navy">{invoice?.id ? 'Edit Invoice' : 'New Invoice'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

          <AskAIBtn 
            toolName="Invoices" 
            label="✨ Ask AI to draft an invoice reminder email or set pricing"
            contextData={{ title, total, dueDate }}
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Invoice title"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Import from Proposal</label>
              <select
                value={proposalId}
                onChange={e => handleProposalImport(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              >
                <option value="">— none —</option>
                {proposals.map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Line Items</label>
              <button type="button" onClick={() => setLineItems(l => [...l, newLineItem()])}
                className="text-xs text-teal hover:underline">+ Add item</button>
            </div>
            <div className="space-y-2">
              {lineItems.map(item => (
                <div key={item.id} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    className="col-span-4 border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal"
                    placeholder="Description"
                    value={item.description}
                    onChange={e => updateItem(item.id, 'description', e.target.value)}
                  />
                  <input
                    className="col-span-1 border rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-teal"
                    placeholder="Qty"
                    type="number" min="0" step="any"
                    value={item.quantity}
                    onChange={e => updateItem(item.id, 'quantity', e.target.value)}
                  />
                  <input
                    className="col-span-2 border rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-teal"
                    placeholder="Rate"
                    type="number" min="0" step="any"
                    value={item.rate}
                    onChange={e => updateItem(item.id, 'rate', e.target.value)}
                  />
                  <input
                    className="col-span-1 border rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-teal"
                    placeholder="Tax%"
                    type="number" min="0" max="100" step="any"
                    value={item.tax}
                    onChange={e => updateItem(item.id, 'tax', e.target.value)}
                  />
                  <input
                    className="col-span-1 border rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-teal"
                    placeholder="Disc%"
                    type="number" min="0" max="100" step="any"
                    value={item.discount}
                    onChange={e => updateItem(item.id, 'discount', e.target.value)}
                  />
                  <div className="col-span-2 text-right text-sm font-medium text-gray-700">
                    ${lineTotal(item).toFixed(2)}
                  </div>
                  <button type="button" onClick={() => removeItem(item.id)}
                    className="col-span-1 text-gray-300 hover:text-red-500 text-lg leading-none text-center">&times;</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3 pt-3 border-t">
              <span className="text-sm font-semibold text-navy">Total: ${total.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Payment terms, bank details, etc."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 text-sm rounded-lg bg-teal text-white font-medium hover:bg-teal/90 disabled:opacity-50">
              {saving ? 'Saving…' : invoice?.id ? 'Update Invoice' : 'Create Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Preview Modal ────────────────────────────────────────────────────────────
function PreviewModal({ invoice, onClose }) {
  const html = generateHTML(invoice)

  function handlePrint() {
    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
    win.print()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-navy">{invoice.invoice_number} — Preview</h2>
          <div className="flex gap-3">
            <button onClick={handlePrint}
              className="px-4 py-1.5 text-sm bg-navy text-white rounded-lg hover:bg-navy/90">
              Download / Print PDF
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
        </div>
        <div className="p-4">
          <iframe
            srcDoc={html}
            className="w-full border rounded-lg"
            style={{ height: '70vh' }}
            title="Invoice Preview"
          />
        </div>
      </div>
    </div>
  )
}

// ── Stripe URL Modal ─────────────────────────────────────────────────────────
function StripeModal({ invoice, onClose, onSave }) {
  const [url, setUrl] = useState(invoice.stripe_payment_url || '')
  const [saving, setSaving] = useState(false)
  const { token } = useAuth()

  async function handleSave() {
    setSaving(true)
    try {
      const res = await axios.patch(`/api/invoices/${invoice.id}/payment-url`,
        { stripe_payment_url: url },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      onSave(res.data)
    } catch (_) {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-navy mb-4">Stripe Payment Link</h2>
        <p className="text-sm text-gray-500 mb-3">Paste a Stripe Payment Link or any payment URL. It will appear as a "Pay Online" button on the invoice.</p>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://buy.stripe.com/..."
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
        />
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-teal text-white rounded-lg hover:bg-teal/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function Invoices() {
  const { token } = useAuth()
  const [invoices, setInvoices] = useState([])
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState(null)
  const [previewInvoice, setPreviewInvoice] = useState(null)
  const [stripeInvoice, setStripeInvoice] = useState(null)

  const headers = { Authorization: `Bearer ${token}` }

  async function load() {
    setLoading(true)
    try {
      const params = {}
      if (filterStatus) params.status = filterStatus
      const [invRes, propRes] = await Promise.all([
        axios.get('/api/invoices', { headers, params }),
        axios.get('/api/proposals', { headers }),
      ])
      setInvoices(invRes.data)
      setProposals(propRes.data.filter(p => p.status === 'signed'))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterStatus])

  async function handleStatusChange(invoice, status) {
    try {
      const res = await axios.patch(`/api/invoices/${invoice.id}/status`, { status }, { headers })
      setInvoices(inv => inv.map(i => i.id === invoice.id ? res.data : i))
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update status')
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this invoice?')) return
    try {
      await axios.delete(`/api/invoices/${id}`, { headers })
      setInvoices(inv => inv.filter(i => i.id !== id))
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete')
    }
  }

  function handleSave(saved) {
    setInvoices(inv => {
      const exists = inv.find(i => i.id === saved.id)
      return exists ? inv.map(i => i.id === saved.id ? saved : i) : [saved, ...inv]
    })
    setShowModal(false)
    setEditingInvoice(null)
  }

  const filtered = invoices.filter(inv => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      inv.title.toLowerCase().includes(q) ||
      inv.invoice_number.toLowerCase().includes(q) ||
      (inv.contact_name || '').toLowerCase().includes(q)
    )
  })

  const statusCounts = invoices.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1
    return acc
  }, {})

  const totalOutstanding = invoices
    .filter(i => i.status === 'sent' || i.status === 'overdue')
    .reduce((sum, i) => sum + invoiceTotal(i.line_items), 0)

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy font-syne">Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
            {totalOutstanding > 0 && ` · $${totalOutstanding.toFixed(2)} outstanding`}
          </p>
        </div>
        <button
          onClick={() => { setEditingInvoice(null); setShowModal(true) }}
          className="bg-teal text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal/90 transition-colors"
        >
          + New Invoice
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {['draft', 'sent', 'paid', 'overdue'].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
            className={`bg-white rounded-xl border p-4 text-left transition-all ${filterStatus === s ? 'border-teal ring-1 ring-teal' : 'border-gray-200 hover:border-gray-300'}`}
          >
            <div className="text-2xl font-bold text-navy">{statusCounts[s] || 0}</div>
            <div className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[s]}`}>{s}</div>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search invoices…"
          className="w-full max-w-sm border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          {invoices.length === 0 ? 'No invoices yet. Create your first one.' : 'No invoices match your filter.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Invoice</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Client</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Due</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(inv => {
                const nextStatuses = STATUS_FLOW[inv.status] || []
                const total = invoiceTotal(inv.line_items)
                return (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-medium text-navy">{inv.invoice_number}</div>
                      <div className="text-gray-500 text-xs mt-0.5 truncate max-w-[180px]">{inv.title}</div>
                    </td>
                    <td className="px-5 py-4 text-gray-600">{inv.contact_name || '—'}</td>
                    <td className="px-5 py-4 text-gray-500">
                      {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-navy">
                      ${total.toFixed(2)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[inv.status]}`}>
                          {inv.status}
                        </span>
                        {nextStatuses.length > 0 && (
                          <div className="flex gap-1">
                            {nextStatuses.map(s => (
                              <button
                                key={s}
                                onClick={() => handleStatusChange(inv, s)}
                                className="text-xs text-gray-400 hover:text-teal transition-colors capitalize"
                                title={`Mark as ${s}`}
                              >
                                → {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {inv.stripe_payment_url && (
                          <a href={inv.stripe_payment_url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline">Pay</a>
                        )}
                        <button onClick={() => setStripeInvoice(inv)}
                          className="text-xs text-gray-400 hover:text-blue-600 transition-colors" title="Set payment link">
                          💳
                        </button>
                        <button onClick={() => setPreviewInvoice(inv)}
                          className="text-xs text-gray-400 hover:text-navy transition-colors" title="Preview / PDF">
                          👁
                        </button>
                        {inv.status === 'draft' && (
                          <button onClick={() => { setEditingInvoice(inv); setShowModal(true) }}
                            className="text-xs text-gray-400 hover:text-teal transition-colors" title="Edit">
                            ✏️
                          </button>
                        )}
                        <button onClick={() => handleDelete(inv.id)}
                          className="text-xs text-gray-300 hover:text-red-500 transition-colors" title="Delete">
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <InvoiceModal
          invoice={editingInvoice}
          proposals={proposals}
          onClose={() => { setShowModal(false); setEditingInvoice(null) }}
          onSave={handleSave}
        />
      )}
      {previewInvoice && (
        <PreviewModal invoice={previewInvoice} onClose={() => setPreviewInvoice(null)} />
      )}
      {stripeInvoice && (
        <StripeModal
          invoice={stripeInvoice}
          onClose={() => setStripeInvoice(null)}
          onSave={saved => {
            setInvoices(inv => inv.map(i => i.id === saved.id ? saved : i))
            setStripeInvoice(null)
          }}
        />
      )}
    </div>
  )
}
