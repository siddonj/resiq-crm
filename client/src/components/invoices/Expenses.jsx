import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'

export default function Expenses({ vendors = [], categories = [], onReload }) {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [filterCategory, setFilterCategory] = useState('')
  const [filterBillable, setFilterBillable] = useState('')

  const [vendorId, setVendorId] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [taxAmount, setTaxAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [expenseDate, setExpenseDate] = useState('')
  const [receiptUrl, setReceiptUrl] = useState('')
  const [billable, setBillable] = useState(false)
  const [notes, setNotes] = useState('')

  const loadExpenses = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/invoices/expenses', headers)
      setExpenses(data)
    } catch (err) {
      console.error('Failed to load expenses', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadExpenses()
  }, [])

  const openNew = () => {
    setEditing(null)
    setVendorId('')
    setCategory('')
    setDescription('')
    setAmount('')
    setTaxAmount('')
    setCurrency('USD')
    setExpenseDate('')
    setReceiptUrl('')
    setBillable(false)
    setNotes('')
    setShowForm(true)
  }

  const openEdit = (e) => {
    setEditing(e)
    setVendorId(e.vendor_id || '')
    setCategory(e.category || '')
    setDescription(e.description || '')
    setAmount(e.amount || '')
    setTaxAmount(e.tax_amount || '')
    setCurrency(e.currency || 'USD')
    setExpenseDate(e.expense_date ? e.expense_date.slice(0, 10) : '')
    setReceiptUrl(e.receipt_url || '')
    setBillable(e.billable || false)
    setNotes(e.notes || '')
    setShowForm(true)
  }

  const handleSubmit = async (ev) => {
    ev.preventDefault()
    if (!description.trim() || !amount) return
    const payload = {
      vendor_id: vendorId || null,
      category: category || null,
      description: description.trim(),
      amount: parseFloat(amount),
      tax_amount: parseFloat(taxAmount || 0),
      currency,
      expense_date: expenseDate || new Date().toISOString().slice(0, 10),
      receipt_url: receiptUrl || null,
      billable,
      notes: notes || null,
    }
    try {
      if (editing) {
        await axios.put(`/api/invoices/expenses/${editing.id}`, payload, headers)
      } else {
        await axios.post('/api/invoices/expenses', payload, headers)
      }
      setShowForm(false)
      loadExpenses()
      onReload()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save expense')
    }
  }

  const handleDelete = async (id, desc) => {
    if (!window.confirm(`Delete expense "${desc}"?`)) return
    try {
      await axios.delete(`/api/invoices/expenses/${id}`, headers)
      loadExpenses()
      onReload()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete')
    }
  }

  const filtered = expenses.filter((e) => {
    if (filterCategory && e.category !== filterCategory) return false
    if (filterBillable === 'billable' && !e.billable) return false
    if (filterBillable === 'non-billable' && e.billable) return false
    return true
  })

  const totalAmount = filtered.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0)
  const totalTax = filtered.reduce((sum, e) => sum + parseFloat(e.tax_amount || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={openNew} className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">+ Add Expense</button>
        </div>
        <div className="flex items-center gap-2">
          <select className="text-xs rounded-md border-gray-300" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
          <select className="text-xs rounded-md border-gray-300" value={filterBillable} onChange={(e) => setFilterBillable(e.target.value)}>
            <option value="">All</option>
            <option value="billable">Billable</option>
            <option value="non-billable">Non-Billable</option>
          </select>
        </div>
      </div>

      {showForm && (
        <div className="bg-white border rounded-lg p-4 space-y-3 max-w-xl">
          <h4 className="text-sm font-semibold text-gray-800">{editing ? 'Edit Expense' : 'New Expense'}</h4>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Description</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Vendor</label>
                <select className="w-full rounded-md border-gray-300 text-sm" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">— Select —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Amount</label>
                <input type="number" step="0.01" className="w-full rounded-md border-gray-300 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Tax</label>
                <input type="number" step="0.01" className="w-full rounded-md border-gray-300 text-sm" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Currency</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Category</label>
                <select className="w-full rounded-md border-gray-300 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">— Select —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Date</label>
                <input type="date" className="w-full rounded-md border-gray-300 text-sm" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Receipt URL</label>
              <input className="w-full rounded-md border-gray-300 text-sm" value={receiptUrl} onChange={(e) => setReceiptUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Notes</label>
              <textarea className="w-full rounded-md border-gray-300 text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
              Billable (can be added to invoice)
            </label>
            <div className="flex items-center gap-2">
              <button type="submit" className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">{editing ? 'Update' : 'Save'}</button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>Total: <strong>${totalAmount.toFixed(2)}</strong></span>
        <span>Tax: <strong>${totalTax.toFixed(2)}</strong></span>
        <span>Count: <strong>{filtered.length}</strong></span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-500">No expenses yet.</div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Date</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Description</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Category</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Vendor</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Amount</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Billable</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{e.expense_date ? new Date(e.expense_date).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2 text-gray-900">{e.description}</td>
                  <td className="px-3 py-2">
                    {e.category && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{e.category}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{e.vendor_name || '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-900 font-medium">${parseFloat(e.amount).toFixed(2)}</td>
                  <td className="px-3 py-2 text-center">{e.billable ? <span className="text-green-600 text-xs">●</span> : <span className="text-gray-300 text-xs">○</span>}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openEdit(e)} className="text-xs text-gray-500 hover:text-gray-700 mr-2">Edit</button>
                    <button onClick={() => handleDelete(e.id, e.description)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
