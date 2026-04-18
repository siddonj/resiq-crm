import { useState, useEffect } from 'react'
import axios from 'axios'

export default function EmailTimeline({ contact, token }) {
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(true)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    fetchTimeline()
  }, [contact?.id])

  const fetchTimeline = async () => {
    if (!contact?.id) return

    try {
      const res = await axios.get(`/api/contacts/${contact.id}/timeline`, authHeaders)
      setTimeline(res.data)
    } catch (err) {
      console.error('Error fetching timeline:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <p className="text-brand-gray text-sm">Loading timeline...</p>
  }

  if (timeline.length === 0) {
    return (
      <div className="text-center py-8 text-brand-gray text-sm">
        <p>📭 No email history yet</p>
        <p className="text-xs mt-1">Connect your Gmail in settings to auto-log emails</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {timeline.map((item) => (
        <div
          key={`${item.item_type}-${item.id}`}
          className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50 transition-colors"
        >
          {item.item_type === 'email' ? (
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-navy line-clamp-2">{item.subject || '(No subject)'}</p>
                  <p className="text-xs text-brand-gray mt-1">
                    <span className={item.is_outbound ? 'text-teal' : 'text-gray-500'}>
                      {item.is_outbound ? '↗️ You sent' : '↙️ Received'} from {item.from}
                    </span>
                  </p>
                </div>
                <span className="text-xs text-brand-gray flex-shrink-0 whitespace-nowrap">
                  {new Date(item.date).toLocaleDateString()}
                </span>
              </div>
              <span className="inline-block mt-2 px-2 py-0.5 bg-teal/10 text-teal rounded text-xs font-medium">
                Email
              </span>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-navy capitalize">{item.type}</p>
                  <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                </div>
                <span className="text-xs text-brand-gray flex-shrink-0 whitespace-nowrap">
                  {new Date(item.date).toLocaleDateString()}
                </span>
              </div>
              <span className="inline-block mt-2 px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">
                Activity
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
