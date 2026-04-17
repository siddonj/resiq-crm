import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function Overview() {
  const { token } = useAuth()
  const [stats, setStats] = useState({
    totalContacts: 0,
    activeDeals: 0,
    pipelineValue: 0,
    closedWon: 0,
  })
  const [recentItems, setRecentItems] = useState([])
  const [loading, setLoading] = useState(true)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [contactsRes, dealsRes] = await Promise.all([
          axios.get('/api/contacts', authHeaders),
          axios.get('/api/deals', authHeaders),
        ])

        const contacts = contactsRes.data || []
        const deals = dealsRes.data || []

        // Calculate stats
        const totalContacts = contacts.length
        const activeDeals = deals.filter(d => ['lead', 'qualified', 'proposal', 'active'].includes(d.stage)).length
        const pipelineValue = deals
          .filter(d => !['closed_won', 'closed_lost'].includes(d.stage))
          .reduce((sum, d) => sum + (Number(d.value) || 0), 0)
        const closedWon = deals
          .filter(d => d.stage === 'closed_won')
          .reduce((sum, d) => sum + (Number(d.value) || 0), 0)

        setStats({ totalContacts, activeDeals, pipelineValue, closedWon })

        // Combine recent items (contacts + deals)
        const recentContacts = contacts
          .slice(0, 3)
          .map(c => ({ id: c.id, type: 'contact', name: c.name, company: c.company, created_at: c.created_at }))
        const recentDeals = deals
          .slice(0, 3)
          .map(d => ({ id: d.id, type: 'deal', name: d.title, value: d.value, created_at: d.created_at }))
        const combined = [...recentDeals, ...recentContacts]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 5)
        setRecentItems(combined)
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [token])

  const statCards = [
    { label: 'Total Contacts', value: stats.totalContacts, color: 'bg-teal' },
    { label: 'Active Deals', value: stats.activeDeals, color: 'bg-navy' },
    {
      label: 'Pipeline Value',
      value: `$${(stats.pipelineValue / 1000).toFixed(0)}k`,
      color: 'bg-brand-gray',
    },
    { label: 'Closed Won', value: `$${(stats.closedWon / 1000).toFixed(0)}k`, color: 'bg-teal' },
  ]

  return (
    <div className="p-8">
      <h2 className="font-syne text-2xl font-bold text-navy mb-6">Overview</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm p-6">
            <div className={`w-2 h-8 rounded-full ${color} mb-3`} />
            <p className="text-2xl font-syne font-bold text-navy">
              {loading ? '—' : value}
            </p>
            <p className="text-sm text-brand-gray mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="font-syne font-semibold text-navy mb-4">Recent Activity</h3>
        {loading ? (
          <p className="text-brand-gray text-sm">Loading...</p>
        ) : recentItems.length === 0 ? (
          <p className="text-brand-gray text-sm">No recent activity yet. Start by adding contacts or deals.</p>
        ) : (
          <div className="space-y-3">
            {recentItems.map(item => (
              <div key={`${item.type}-${item.id}`} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-b-0 last:pb-0">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${item.type === 'deal' ? 'bg-teal' : 'bg-navy'}`} />
                <div className="flex-1 min-w-0">
                  {item.type === 'deal' ? (
                    <>
                      <p className="text-sm font-medium text-navy truncate">{item.name}</p>
                      {item.value && (
                        <p className="text-xs text-teal font-semibold">${Number(item.value).toLocaleString()}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-navy truncate">{item.name}</p>
                      <p className="text-xs text-brand-gray">{item.company || 'No company'}</p>
                    </>
                  )}
                </div>
                <p className="text-xs text-brand-gray flex-shrink-0">
                  {item.type === 'deal' ? 'Deal' : 'Contact'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
