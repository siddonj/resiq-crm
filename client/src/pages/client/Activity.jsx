import { useState, useEffect } from 'react'
import { useClientAuth } from '../context/ClientAuthContext'

export default function ClientActivity() {
  const { token } = useClientAuth()
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchActivity()
  }, [token])

  const fetchActivity = async () => {
    try {
      setLoading(true)
      const res = await fetch('http://localhost:5000/api/client/activity', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setActivities(data)
      } else {
        setError('Failed to load activity')
      }
    } catch (err) {
      console.error('Error fetching activity:', err)
      setError('Failed to load activity')
    } finally {
      setLoading(false)
    }
  }

  const getActivityIcon = (action) => {
    if (action.includes('proposal')) return '📄'
    if (action.includes('invoice')) return '💳'
    if (action.includes('file')) return '📁'
    if (action.includes('login')) return '🔓'
    return '⏱️'
  }

  const formatAction = (action) => {
    return action
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading activity...</div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Activity Log</h1>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {activities.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-600 text-lg">No activity yet</p>
        </div>
      ) : (
        <div className="space-y-0">
          {activities.map((activity, idx) => (
            <div
              key={activity.id || idx}
              className={`flex items-start space-x-4 p-4 ${idx < activities.length - 1 ? 'border-b border-gray-200' : ''}`}
            >
              <div className="text-2xl">{getActivityIcon(activity.action)}</div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">{formatAction(activity.action)}</p>
                <p className="text-sm text-gray-500">
                  {new Date(activity.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                  <details className="mt-2 text-xs text-gray-600">
                    <summary className="cursor-pointer hover:text-gray-800">Details</summary>
                    <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-x-auto">
                      {JSON.stringify(activity.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
