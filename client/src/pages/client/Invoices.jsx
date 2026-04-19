import { useState, useEffect } from 'react'
import { useClientAuth } from '../context/ClientAuthContext'

export default function ClientInvoices() {
  const { token } = useClientAuth()
  const [invoices, setInvoices] = useState([])
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  useEffect(() => {
    fetchInvoices()
  }, [token])

  const fetchInvoices = async () => {
    try {
      setLoading(true)
      const res = await fetch('http://localhost:5000/api/client/invoices', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setInvoices(data)
      } else {
        setError('Failed to load invoices')
      }
    } catch (err) {
      console.error('Error fetching invoices:', err)
      setError('Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }

  const handlePayment = async (invoiceId) => {
    try {
      const res = await fetch(`http://localhost:5000/api/client/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.ok) {
        const data = await res.json()
        if (data.paymentUrl) {
          window.location.href = data.paymentUrl
        } else {
          setError('Payment link not available')
        }
      } else {
        setError('Failed to initiate payment')
      }
    } catch (err) {
      console.error('Error initiating payment:', err)
      setError('Failed to initiate payment')
    }
  }

  const filteredInvoices = filterStatus === 'all' ? invoices : invoices.filter((i) => i.status === filterStatus)

  const getStatusColor = (status) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-800'
      case 'overdue':
        return 'bg-red-100 text-red-800'
      case 'sent':
        return 'bg-blue-100 text-blue-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading invoices...</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Invoices List */}
      <div className="lg:col-span-1">
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-4">Invoices</h2>

            {/* Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
            >
              <option value="all">All Invoices</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>

          {filteredInvoices.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No invoices</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredInvoices.map((invoice) => (
                <button
                  key={invoice.id}
                  onClick={() => setSelectedInvoice(invoice)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                    selectedInvoice?.id === invoice.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="font-medium text-gray-900">{invoice.invoice_number}</p>
                  <p className="text-sm text-gray-600 truncate">{invoice.title}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${getStatusColor(invoice.status)}`}>
                      {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                    </span>
                    <span className="text-sm font-bold text-gray-900">
                      ${invoice.line_items?.reduce((sum, item) => sum + (item.amount || 0), 0).toFixed(2) || '0.00'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Invoice Detail */}
      <div className="lg:col-span-2">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {selectedInvoice ? (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-6 text-white">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-2xl font-bold">{selectedInvoice.invoice_number}</h1>
                  <p className="text-blue-100 mt-2">{selectedInvoice.title}</p>
                </div>
                <span className={`px-4 py-2 rounded-lg text-sm font-bold ${getStatusColor(selectedInvoice.status)}`}>
                  {selectedInvoice.status.charAt(0).toUpperCase() + selectedInvoice.status.slice(1)}
                </span>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-600 text-sm font-medium mb-1">Issue Date</p>
                  <p className="text-gray-900">
                    {new Date(selectedInvoice.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                {selectedInvoice.due_date && (
                  <div>
                    <p className="text-gray-600 text-sm font-medium mb-1">Due Date</p>
                    <p className="text-gray-900">
                      {new Date(selectedInvoice.due_date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                )}
              </div>

              {/* Line Items */}
              {selectedInvoice.line_items && selectedInvoice.line_items.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-3">Invoice Items</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b-2 border-gray-300">
                          <th className="text-left py-2 text-gray-600 font-medium">Description</th>
                          <th className="text-right py-2 text-gray-600 font-medium">Qty</th>
                          <th className="text-right py-2 text-gray-600 font-medium">Rate</th>
                          <th className="text-right py-2 text-gray-600 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedInvoice.line_items.map((item, idx) => (
                          <tr key={idx} className="border-b border-gray-100">
                            <td className="py-3 text-gray-900">{item.description}</td>
                            <td className="text-right text-gray-900">{item.quantity || 1}</td>
                            <td className="text-right text-gray-900">${item.rate?.toFixed(2) || '0.00'}</td>
                            <td className="text-right font-medium text-gray-900">
                              ${item.amount?.toFixed(2) || '0.00'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Totals */}
                  <div className="mt-4 space-y-2 border-t pt-4">
                    <div className="flex justify-end space-x-8">
                      <span className="text-gray-600">Subtotal:</span>
                      <span className="font-medium text-gray-900 w-24 text-right">
                        $
                        {selectedInvoice.line_items
                          .reduce((sum, item) => sum + (item.amount || 0), 0)
                          .toFixed(2)}
                      </span>
                    </div>

                    <div className="flex justify-end space-x-8 text-lg font-bold">
                      <span className="text-gray-900">Total Due:</span>
                      <span className="text-purple-600 w-24 text-right">
                        $
                        {selectedInvoice.line_items
                          .reduce((sum, item) => sum + (item.amount || 0), 0)
                          .toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              {selectedInvoice.notes && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-2">Notes</h3>
                  <p className="text-gray-600 text-sm">{selectedInvoice.notes}</p>
                </div>
              )}

              {/* Payment Status & Action */}
              <div className="border-t pt-6">
                {selectedInvoice.status === 'paid' ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-green-800 font-medium">✓ Invoice Paid</p>
                    {selectedInvoice.paid_at && (
                      <p className="text-sm text-green-600 mt-1">
                        Paid on{' '}
                        {new Date(selectedInvoice.paid_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    )}
                  </div>
                ) : selectedInvoice.status === 'draft' ? (
                  <p className="text-gray-600 text-sm">This invoice has not been sent yet.</p>
                ) : (
                  <button
                    onClick={() => handlePayment(selectedInvoice.id)}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                  >
                    <span>💳</span>
                    <span>Pay Now with Stripe</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
            <p>Select an invoice to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}
