import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'

export default function Vendors({ onReload }) {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [country, setCountry] = useState('')
  const [taxNumber, setTaxNumber] = useState('')
  const [notes, setNotes] = useState('')

  const loadVendors = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/invoices/vendors', headers)
      setVendors(data)
    } catch (err) {
      console.error('Failed to load vendors', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadVendors()
  }, [])

  const openNew = () => {
    setEditing(null)
    setName('')
    setEmail('')
    setPhone('')
    setAddress('')
    setCity('')
    setState('')
    setPostalCode('')
    setCountry('')
    setTaxNumber('')
    setNotes('')
    setShowForm(true)
  }

  const openEdit = (v) => {
    setEditing(v)
    setName(v.name || '')
    setEmail(v.email || '')
    setPhone(v.phone || '')
    setAddress(v.address || '')
    setCity(v.city || '')
    setState(v.state || '')
    setPostalCode(v.postal_code || '')
    setCountry(v.country || '')
    setTaxNumber(v.tax_number || '')
    setNotes(v.notes || '')
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    const payload = {
      name: name.trim(),
      email: email || null,
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
      postal_code: postalCode || null,
      country: country || null,
      tax_number: taxNumber || null,
      notes: notes || null,
    }
    try {
      if (editing) {
        await axios.put(`/api/invoices/vendors/${editing.id}`, payload, headers)
      } else {
        await axios.post('/api/invoices/vendors', payload, headers)
      }
      setShowForm(false)
      loadVendors()
      onReload()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save vendor')
    }
  }

  const handleDelete = async (id, vname) => {
    if (!window.confirm(`Delete vendor "${vname}"?`)) return
    try {
      await axios.delete(`/api/invoices/vendors/${id}`, headers)
      loadVendors()
      onReload()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={openNew} className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">+ Add Vendor</button>
      </div>

      {showForm && (
        <div className="bg-white border rounded-lg p-4 space-y-3 max-w-xl">
          <h4 className="text-sm font-semibold text-gray-800">{editing ? 'Edit Vendor' : 'New Vendor'}</h4>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Name</label>
              <input className="w-full rounded-md border-gray-300 text-sm" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Email</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Phone</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Address</label>
              <input className="w-full rounded-md border-gray-300 text-sm" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">City</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">State</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Postal</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Country</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={country} onChange={(e) => setCountry(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Tax Number</label>
                <input className="w-full rounded-md border-gray-300 text-sm" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Notes</label>
              <textarea className="w-full rounded-md border-gray-300 text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">{editing ? 'Update' : 'Save'}</button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : vendors.length === 0 ? (
        <div className="text-sm text-gray-500">No vendors yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendors.map((v) => (
            <div key={v.id} className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <h5 className="text-sm font-semibold text-gray-900">{v.name}</h5>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(v)} className="text-xs text-gray-500 hover:text-gray-700">Edit</button>
                  <button onClick={() => handleDelete(v.id, v.name)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                </div>
              </div>
              {v.email && <div className="text-xs text-gray-500 mt-1">{v.email}</div>}
              {v.phone && <div className="text-xs text-gray-500">{v.phone}</div>}
              {(v.address || v.city) && (
                <div className="text-xs text-gray-400 mt-1">
                  {[v.address, v.city, v.state, v.postal_code].filter(Boolean).join(', ')}
                </div>
              )}
              {v.tax_number && <div className="text-xs text-gray-400 mt-1">Tax: {v.tax_number}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
