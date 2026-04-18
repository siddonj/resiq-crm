import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import DashboardCard from './DashboardCard'

export default function EmailMetrics() {
  const { token } = useAuth()
  const [summary, setSummary] = useState(null)
  const [topContacts, setTopContacts] = useState(null)
  const [loading, setLoading] = useState(true)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    fetchData()
  }, [token])

  const fetchData = async () => {
    try {
      const [summaryRes, contactsRes] = await Promise.all([
        axios.get('/api/analytics/emails/summary', authHeaders),
        axios.get('/api/analytics/emails/top-contacts', authHeaders),
      ])
      setSummary(summaryRes.data)
      setTopContacts(contactsRes.data)
    } catch (err) {
      console.error('Error fetching email metrics:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="text-sm text-brand-gray">Loading...</div>
  if (!summary) return <div className="text-sm text-brand-gray">No data</div>

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-navy">Email Activity</h3>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DashboardCard
          title="Total Emails"
          value={summary.total}
          subtitle={`${summary.last_7_days} last 7 days`}
          icon="📧"
          color="teal"
        />
        <DashboardCard
          title="Inbound"
          value={summary.inbound}
          subtitle={`${summary.inbound_outbound_ratio.toFixed(0)}% of total`}
          icon="📬"
          color="blue"
        />
        <DashboardCard
          title="Outbound"
          value={summary.outbound}
          subtitle={`${(100 - summary.inbound_outbound_ratio).toFixed(0)}% sent`}
          icon="📤"
          color="emerald"
        />
        <DashboardCard
          title="Contacts Emailed"
          value={summary.contacts_emailed}
          subtitle={`email history`}
          icon="👥"
          color="amber"
        />
      </div>

      {/* Top Emailed Contacts */}
      {topContacts && topContacts.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <p className="text-xs font-semibold text-navy mb-3">Most Emailed Contacts</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {topContacts.map((contact) => (
              <div key={contact.contact_id} className="flex items-center justify-between p-2 bg-white rounded border border-gray-200">
                <div>
                  <p className="text-sm font-medium text-navy">{contact.contact_name}</p>
                  <p className="text-xs text-brand-gray">{contact.email_count} emails • {contact.thread_count} threads</p>
                </div>
                <p className="text-xs text-brand-gray whitespace-nowrap ml-2">
                  {contact.last_email_date
                    ? new Date(contact.last_email_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    : 'N/A'
                  }
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
