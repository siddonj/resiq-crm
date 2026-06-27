import { useState } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const CADENCES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
]

export default function RetainerOfferModal({ deal, contactName, onClose, onSent }) {
  const { token } = useAuth()
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  const [amount, setAmount] = useState('')
  const [cadence, setCadence] = useState('monthly')
  const [description, setDescription] = useState(`${deal.title} — Ongoing Retainer`)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  const handleSkip = async () => {
    try {
      await axios.patch(`/api/deals/${deal.id}/retainer-skip`, {}, authHeaders)
    } catch {}
    onClose()
  }

  const handleSend = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setError('Enter a valid amount')
      return
    }
    setSending(true)
    setError(null)
    try {
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + 7)

      const { data: invoice } = await axios.post('/api/invoices', {
        title: description,
        deal_id: deal.id,
        invoice_type: 'retainer',
        recurring_cadence: cadence,
        line_items: [{ description: description, quantity: 1, rate: Number(amount), discount: 0, tax: 0 }],
        due_date: dueDate.toISOString().slice(0, 10),
      }, authHeaders)

      await axios.patch(`/api/deals/${deal.id}/retainer-link`, { retainer_invoice_id: invoice.id }, authHeaders)

      if (invoice.id) {
        try {
          await axios.post(`/api/invoices/${invoice.id}/send`, {}, authHeaders)
        } catch {}
      }

      onSent(invoice)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create retainer invoice')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Offer a retainer?</h2>
          <p className="text-sm text-gray-500 mt-1">
            {contactName
              ? `This is a great moment to offer ${contactName} ongoing support.`
              : 'Offer ongoing support while the relationship is fresh.'}
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
              <input
                type="number"
                min="0"
                step="50"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="e.g. 2000"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Cadence</label>
              <select
                value={cadence}
                onChange={e => setCadence(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              >
                {CADENCES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="p-6 border-t border-gray-100 flex gap-3 justify-end">
          <button
            onClick={handleSkip}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="bg-teal text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-teal/90 transition-colors disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send Retainer Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}
