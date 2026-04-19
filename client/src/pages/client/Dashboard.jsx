import { useState, useEffect } from 'react'
import { useClientAuth } from '../../context/ClientAuthContext'

export default function ClientDashboard() {
  const { token } = useClientAuth()
  const [stats, setStats] = useState({
    pendingProposals: 0,
    unpaidInvoices: 0,
    sharedFiles: 0,
    recentActivities: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        setLoading(true)

        // Fetch proposals
        const proposalsRes = await fetch('http://localhost:5000/api/client/proposals', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const proposals = proposalsRes.ok ? await proposalsRes.json() : []
        const pendingProposals = proposals.filter((p) => p.status !== 'signed' && p.status !== 'declined')

        // Fetch invoices
        const invoicesRes = await fetch('http://localhost:5000/api/client/invoices', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const invoices = invoicesRes.ok ? await invoicesRes.json() : []
        const unpaidInvoices = invoices.filter((i) => i.status !== 'paid')

        // Fetch files
        const filesRes = await fetch('http://localhost:5000/api/client/files', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const files = filesRes.ok ? await filesRes.json() : []

        // Fetch activity
        const activityRes = await fetch('http://localhost:5000/api/client/activity', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const activities = activityRes.ok ? await activityRes.json() : []

        setStats({
          pendingProposals: pendingProposals.length,
          unpaidInvoices: unpaidInvoices.length,
          sharedFiles: files.length,
          recentActivities: activities.slice(0, 5),
        })
      } catch (err) {
        console.error('Failed to load dashboard:', err)
        setError('Failed to load dashboard data')
      } finally {
        setLoading(false)
      }
    }

    if (token) {
      fetchDashboard()
    }
  }, [token])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading your dashboard...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Pending Proposals */}
        <a
          href="/client/proposals"
          className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <div className="flex items-center space-x-4">
            <div className="text-4xl">📄</div>
            <div>
              <p className="text-gray-600 text-sm">Pending Proposals</p>
              <p className="text-3xl font-bold text-gray-900">{stats.pendingProposals}</p>
            </div>
          </div>
          <p className="text-xs text-blue-600 mt-4">View proposals →</p>
        </a>

        {/* Unpaid Invoices */}
        <a
          href="/client/invoices"
          className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <div className="flex items-center space-x-4">
            <div className="text-4xl">💳</div>
            <div>
              <p className="text-gray-600 text-sm">Unpaid Invoices</p>
              <p className="text-3xl font-bold text-gray-900">{stats.unpaidInvoices}</p>
            </div>
          </div>
          <p className="text-xs text-blue-600 mt-4">View invoices →</p>
        </a>

        {/* Shared Files */}
        <a
          href="/client/files"
          className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <div className="flex items-center space-x-4">
            <div className="text-4xl">📁</div>
            <div>
              <p className="text-gray-600 text-sm">Shared Files</p>
              <p className="text-3xl font-bold text-gray-900">{stats.sharedFiles}</p>
            </div>
          </div>
          <p className="text-xs text-blue-600 mt-4">View files →</p>
        </a>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Activity</h2>

        {stats.recentActivities.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No activity yet</p>
        ) : (
          <div className="space-y-3">
            {stats.recentActivities.map((activity, idx) => (
              <div key={idx} className="flex items-start space-x-4 pb-3 border-b border-gray-100 last:border-0">
                <div className="text-2xl pt-1">
                  {activity.action.includes('proposal')
                    ? '📄'
                    : activity.action.includes('invoice')
                      ? '💳'
                      : activity.action.includes('file')
                        ? '📁'
                        : '⏱️'}
                </div>
                <div className="flex-1">
                  <p className="text-gray-900 font-medium capitalize">
                    {activity.action.replace(/_/g, ' ')}
                  </p>
                  <p className="text-sm text-gray-500">
                    {new Date(activity.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Call to Action */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-2">What's Next?</h3>
        <ul className="text-gray-700 space-y-2">
          {stats.pendingProposals > 0 && (
            <li className="flex items-center space-x-2">
              <span>✓</span>
              <span>
                You have {stats.pendingProposals} proposal{stats.pendingProposals !== 1 ? 's' : ''} to review
              </span>
            </li>
          )}
          {stats.unpaidInvoices > 0 && (
            <li className="flex items-center space-x-2">
              <span>✓</span>
              <span>
                {stats.unpaidInvoices} invoice{stats.unpaidInvoices !== 1 ? 's' : ''} awaiting payment
              </span>
            </li>
          )}
          {stats.sharedFiles > 0 && (
            <li className="flex items-center space-x-2">
              <span>✓</span>
              <span>{stats.sharedFiles} file(s) shared with you</span>
            </li>
          )}
          {stats.pendingProposals === 0 && stats.unpaidInvoices === 0 && (
            <li className="text-green-600">✓ All caught up! Everything is current.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
