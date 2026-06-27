import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'
import { Link } from 'react-router-dom'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function isOverdue(d) {
  return d && d.slice(0, 10) < today()
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function lineItemsTotal(lineItems) {
  if (!lineItems) return 0
  const items = typeof lineItems === 'string' ? JSON.parse(lineItems) : lineItems
  return items.reduce((s, i) => s + Number(i.quantity || 1) * Number(i.rate || i.unit_price || 0), 0)
}

function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function UnpaidInvoices() {
  const { token } = useAuth()
  const headers = { Authorization: `Bearer ${token}` }
  const [invoices, setInvoices] = useState([])
  const [sending, setSending] = useState({}) // { [invoiceId]: 'sending' | 'sent' | 'error' }
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    Promise.all([
      axios.get('/api/invoices', { headers: { Authorization: `Bearer ${token}` }, params: { status: 'sent' } }),
      axios.get('/api/invoices', { headers: { Authorization: `Bearer ${token}` }, params: { status: 'overdue' } }),
    ])
      .then(([sentRes, overdueRes]) => {
        setInvoices([...sentRes.data, ...overdueRes.data])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  async function handleSendReminder(inv) {
    setSending(s => ({ ...s, [inv.id]: 'sending' }))
    try {
      await axios.post(`/api/invoices/${inv.id}/reminders/send`, {}, { headers })
      setSending(s => ({ ...s, [inv.id]: 'sent' }))
      setTimeout(() => setSending(s => { const n = { ...s }; delete n[inv.id]; return n }), 2000)
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed'
      setSending(s => ({ ...s, [inv.id]: 'error:' + msg }))
      setTimeout(() => setSending(s => { const n = { ...s }; delete n[inv.id]; return n }), 3000)
    }
  }

  if (loading) return null

  const overdueInvoices = invoices.filter(inv => isOverdue(inv.due_date))
  if (invoices.length === 0) return null

  const total = invoices.reduce((s, inv) => s + lineItemsTotal(inv.line_items), 0)

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-navy">
          Unpaid Invoices · {formatMoney(total)}
        </h3>
        <Link to="/invoices" className="text-xs text-teal hover:underline">All invoices →</Link>
      </div>
      <div className="space-y-0">
        {invoices.slice(0, 6).map(inv => {
          const overdue = isOverdue(inv.due_date)
          const sendState = sending[inv.id]
          return (
            <div key={inv.id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
              <div className="min-w-0 flex-1">
                <Link to="/invoices" className="font-medium text-sm text-navy hover:text-teal truncate block">
                  {inv.title}
                </Link>
                <div className="flex items-center gap-2 mt-0.5">
                  {inv.contact_name && <span className="text-xs text-gray-400">{inv.contact_name}</span>}
                  {inv.due_date && (
                    <span className={`text-xs ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                      Due {formatDate(inv.due_date)}{overdue ? ' · Overdue' : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <span className="text-sm font-semibold text-gray-700">{formatMoney(lineItemsTotal(inv.line_items))}</span>
                {overdue && (
                  <button
                    onClick={() => handleSendReminder(inv)}
                    disabled={!!sendState}
                    className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
                      sendState === 'sent'
                        ? 'bg-green-50 text-green-600 cursor-default'
                        : sendState?.startsWith('error:')
                        ? 'bg-red-50 text-red-500 cursor-default'
                        : sendState === 'sending'
                        ? 'bg-gray-100 text-gray-400 cursor-default'
                        : 'bg-orange-50 text-orange-600 hover:bg-orange-100'
                    }`}
                    title={sendState?.startsWith('error:') ? sendState.slice(6) : undefined}
                  >
                    {sendState === 'sent' ? 'Sent!' : sendState === 'sending' ? '...' : sendState?.startsWith('error:') ? 'Error' : 'Remind'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {invoices.length > 6 && (
        <p className="text-xs text-gray-400 mt-3">
          +{invoices.length - 6} more — <Link to="/invoices" className="text-teal hover:underline">view all</Link>
        </p>
      )}
    </div>
  )
}
