import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function DueReminders() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const headers = { headers: { Authorization: `Bearer ${token}` } }
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axios.get('/api/reminders', { ...headers, params: { completed: false } })
      .then(r => setReminders(r.data.filter(rem => new Date(rem.remind_at) <= new Date()).slice(0, 5)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleComplete = async (id) => {
    await axios.patch(`/api/reminders/${id}/complete`, { completed: true }, headers)
    setReminders(prev => prev.filter(r => r.id !== id))
  }

  if (loading) return null
  if (reminders.length === 0) return null

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-navy flex items-center gap-2">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          Overdue Reminders
        </h3>
        <button onClick={() => navigate('/reminders')} className="text-xs text-teal hover:underline">View all</button>
      </div>
      <div className="space-y-2">
        {reminders.map(r => (
          <div key={r.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
            <button
              onClick={() => handleComplete(r.id)}
              className="mt-0.5 w-4 h-4 rounded-full border-2 border-red-300 hover:bg-red-100 flex-shrink-0 transition-colors"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-navy truncate">{r.message}</p>
              <p className="text-xs text-red-500 mt-0.5">
                {new Date(r.remind_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                {r.contact_name && ` · ${r.contact_name}`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
