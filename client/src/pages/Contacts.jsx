import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function Contacts() {
  const { token } = useAuth()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axios.get('/api/contacts', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setContacts(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [token])

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-syne text-2xl font-bold text-navy">Contacts</h2>
        <button className="bg-teal text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-teal/90 transition-colors">
          + Add Contact
        </button>
      </div>

      {loading ? (
        <p className="text-brand-gray text-sm">Loading...</p>
      ) : contacts.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="font-syne text-lg text-navy font-semibold mb-2">No contacts yet</p>
          <p className="text-brand-gray text-sm">Add your first contact to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Name', 'Company', 'Email', 'Type', 'Service Line'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-gray uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {contacts.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-navy">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.company || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-teal/10 text-teal rounded-full text-xs font-medium capitalize">{c.type}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{c.service_line?.replace(/_/g, ' ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
