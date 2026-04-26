import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function EngagementTimeline({ contactId }) {
  const { token } = useAuth()
  const [engagements, setEngagements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!contactId) return

    const fetchEngagements = async () => {
      try {
        const { data } = await axios.get(`/api/engagement/contact/${contactId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        setEngagements(data.trackingRecords || [])
        setError('')
      } catch (err) {
        console.error('Error fetching engagements:', err)
        setError('Failed to load engagement data')
      } finally {
        setLoading(false)
      }
    }

    fetchEngagements()
  }, [contactId, token])

  const getAssetIcon = (type) => {
    switch (type) {
      case 'proposal':
        return '📄'
      case 'invoice':
        return '💰'
      case 'email':
        return '📧'
      default:
        return '📎'
    }
  }

  const getStatusColor = (opened) => {
    return opened ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
  }

  const getStatusBadge = (opened) => {
    return opened ? (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded">
        ✓ Opened
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 text-xs font-semibold rounded">
        ⧖ Not opened
      </span>
    )
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Loading engagement data...</div>
  }

  if (engagements.length === 0) {
    return <div className="text-sm text-gray-500 italic">No tracked engagements yet.</div>
  }

  return (
    <div className="space-y-3">
      {engagements.map((engagement) => (
        <div
          key={engagement.id}
          className={`p-3 rounded-lg border ${getStatusColor(engagement.opened)} transition-colors`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <span className="text-lg flex-shrink-0 mt-0.5">
                {getAssetIcon(engagement.assetType)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-navy truncate">
                  {engagement.assetTitle || `${engagement.assetType} (${engagement.assetId.substring(0, 8)}...)`}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {engagement.assetType.charAt(0).toUpperCase() + engagement.assetType.slice(1)}
                </p>
              </div>
            </div>

            <div className="flex-shrink-0">
              {getStatusBadge(engagement.opened)}
            </div>
          </div>

          {engagement.opened && (
            <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
              <p className="text-xs text-gray-600">
                <strong>Opened:</strong> {new Date(engagement.openedAt).toLocaleString()}
              </p>
              {engagement.ipAddress && (
                <p className="text-xs text-gray-600">
                  <strong>IP:</strong> {engagement.ipAddress}
                </p>
              )}
              {engagement.userAgent && (
                <p className="text-xs text-gray-600 truncate">
                  <strong>Device:</strong> {engagement.userAgent.substring(0, 60)}...
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-2">
            Tracked: {new Date(engagement.createdAt).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  )
}
