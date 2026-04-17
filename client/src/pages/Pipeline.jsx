import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const STAGES = [
  { key: 'lead', label: 'Lead' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'active', label: 'Active' },
  { key: 'closed_won', label: 'Closed Won' },
  { key: 'closed_lost', label: 'Closed Lost' },
]

export default function Pipeline() {
  const { token } = useAuth()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axios.get('/api/deals', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setDeals(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [token])

  const dealsByStage = (stage) => deals.filter(d => d.stage === stage)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-syne text-2xl font-bold text-navy">Pipeline</h2>
        <button className="bg-teal text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-teal/90 transition-colors">
          + Add Deal
        </button>
      </div>

      {loading ? (
        <p className="text-brand-gray text-sm">Loading...</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map(({ key, label }) => (
            <div key={key} className="flex-shrink-0 w-56">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-brand-gray uppercase tracking-wide">{label}</span>
                <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{dealsByStage(key).length}</span>
              </div>
              <div className="space-y-2 min-h-[200px]">
                {dealsByStage(key).length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-xl h-24 flex items-center justify-center">
                    <p className="text-xs text-gray-300">No deals</p>
                  </div>
                ) : (
                  dealsByStage(key).map(deal => (
                    <div key={deal.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
                      <p className="font-medium text-navy text-sm">{deal.title}</p>
                      {deal.value && (
                        <p className="text-teal text-xs font-semibold mt-1">${Number(deal.value).toLocaleString()}</p>
                      )}
                      {deal.service_line && (
                        <p className="text-brand-gray text-xs mt-1 capitalize">{deal.service_line.replace(/_/g, ' ')}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
