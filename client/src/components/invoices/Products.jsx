import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'

export default function Products({ onSelect }) {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sku, setSku] = useState('')
  const [cost, setCost] = useState('')
  const [price, setPrice] = useState('')
  const [taxRate, setTaxRate] = useState('')
  const [unit, setUnit] = useState('item')

  const loadProducts = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/invoices/products/all', headers)
      setProducts(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProducts() }, [token])

  const openNew = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setSku('')
    setCost('')
    setPrice('')
    setTaxRate('')
    setUnit('item')
    setShowForm(true)
  }

  const openEdit = (p) => {
    setEditing(p)
    setName(p.name)
    setDescription(p.description || '')
    setSku(p.sku || '')
    setCost(p.cost || '')
    setPrice(p.price || '')
    setTaxRate(p.tax_rate || '')
    setUnit(p.unit || 'item')
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const payload = { name: name.trim(), description: description || null, sku: sku || null, cost: cost || 0, price: price || 0, tax_rate: taxRate || 0, unit: unit || 'item' }
    try {
      if (editing) {
        await axios.put(`/api/invoices/products/${editing.id}`, payload, headers)
      } else {
        await axios.post('/api/invoices/products', payload, headers)
      }
      setShowForm(false)
      loadProducts()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save product')
    }
  }

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete product "${name}"?`)) return
    try {
      await axios.delete(`/api/invoices/products/${id}`, headers)
      loadProducts()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Product Library</h3>
        <button onClick={openNew} className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">+ Add Product</button>
      </div>

      {showForm && (
        <div className="bg-white border rounded-lg p-4 max-w-lg">
          <h4 className="text-sm font-semibold text-gray-800 mb-3">{editing ? 'Edit Product' : 'New Product'}</h4>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Name</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">SKU</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={sku} onChange={(e) => setSku(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Description</label>
              <input className="w-full rounded-md border-gray-300 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Cost</label>
                <input type="number" min="0" step="any" className="w-full rounded-md border-gray-300 text-sm" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Price</label>
                <input type="number" min="0" step="any" className="w-full rounded-md border-gray-300 text-sm" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Tax %</label>
                <input type="number" min="0" step="any" className="w-full rounded-md border-gray-300 text-sm" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Unit</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">{editing ? 'Update' : 'Add'}</button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : products.length === 0 ? (
        <div className="text-sm text-gray-500">No products yet.</div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">SKU</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Cost</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Price</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Tax</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-2 text-gray-500">{p.sku || '—'}</td>
                  <td className="px-4 py-2 text-right text-gray-700">${Number(p.cost).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right text-gray-700">${Number(p.price).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{p.tax_rate || 0}%</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {onSelect && (
                        <button onClick={() => onSelect(p)} className="text-xs text-indigo-600 hover:underline">Select</button>
                      )}
                      <button onClick={() => openEdit(p)} className="text-xs text-gray-400 hover:text-gray-600">Edit</button>
                      <button onClick={() => handleDelete(p.id, p.name)} className="text-xs text-gray-300 hover:text-red-500">×</button>
                    </div>
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
