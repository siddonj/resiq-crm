import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import DashboardCard from './DashboardCard'

export default function ContactsSummary() {
  const { token } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    fetchData()
  }, [token])

  const fetchData = async () => {
    try {
      const res = await axios.get('/api/analytics/contacts/summary', authHeaders)
      setData(res.data)
    } catch (err) {
      console.error('Error fetching contacts summary:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="text-sm text-brand-gray">Loading...</div>
  if (!data) return <div className="text-sm text-brand-gray">No data</div>

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-navy">Contact Management</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DashboardCard
          title="Total Contacts"
          value={data.total}
          subtitle={`${data.with_email} with emails`}
          icon="👥"
          color="teal"
        />
        <DashboardCard
          title="Prospects"
          value={data.by_type.prospect}
          subtitle={`${data.by_type.partner + data.by_type.vendor} other`}
          icon="🎯"
          color="blue"
        />
        <DashboardCard
          title="New This Month"
          value={data.new_this_month}
          subtitle={`of ${data.total} total`}
          icon="✨"
          color="emerald"
        />
        <DashboardCard
          title="Email Engaged"
          value={data.with_email}
          subtitle={`${((data.with_email / data.total) * 100 || 0).toFixed(0)}% of contacts`}
          icon="📧"
          color="amber"
        />
      </div>

      {data.top_tags && data.top_tags.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <p className="text-xs font-semibold text-navy mb-3">Top Tags</p>
          <div className="flex flex-wrap gap-2">
            {data.top_tags.map((tag, idx) => (
              <span key={idx} className="inline-block px-3 py-1 bg-white border border-gray-200 text-xs font-medium text-navy rounded-full">
                {tag.name} <span className="text-brand-gray ml-1">({tag.count})</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
