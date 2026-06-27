import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function GcalConnect() {
  const { token } = useAuth()
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => { checkStatus() }, [])

  const checkStatus = async () => {
    try {
      const res = await axios.get('/api/integrations/gcal/status', authHeaders)
      setConnected(res.data.connected)
    } catch (err) {
      console.error('Error checking GCal status:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = async () => {
    setConnecting(true)
    setError('')
    try {
      const res = await axios.post('/api/integrations/gcal/connect', {}, authHeaders)
      window.location.href = res.data.authUrl
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start Google Calendar connection')
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar? Synced events will remain but new events won\'t sync.')) return
    try {
      await axios.post('/api/integrations/gcal/disconnect', {}, authHeaders)
      setConnected(false)
      setSuccess('Google Calendar disconnected')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to disconnect Google Calendar')
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setError('')
    try {
      await axios.post('/api/integrations/gcal/sync', {}, authHeaders)
      setSuccess('Calendar sync started. Events will appear shortly.')
      setTimeout(() => setSuccess(''), 5000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to sync Google Calendar')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return null

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      {error && (
        <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-4 px-4 py-2 bg-green-50 border border-green-200 text-green-600 rounded-lg text-sm">{success}</div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="font-semibold text-navy">Google Calendar Integration</h3>
          <p className="text-xs text-brand-gray mt-1">
            {connected ? '✅ Connected' : '❌ Not connected'}
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Sync your Google Calendar events into ResiQ. Events appear on the Calendar page alongside your activities and reminders.
          </p>
        </div>

        {connected ? (
          <div className="flex flex-col gap-2 ml-4">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2 text-sm bg-teal text-white rounded-lg hover:bg-teal/90 transition-colors disabled:opacity-60 whitespace-nowrap"
            >
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors whitespace-nowrap"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="px-4 py-2 text-sm bg-teal text-white rounded-lg hover:bg-teal/90 transition-colors disabled:opacity-60 whitespace-nowrap ml-4"
          >
            {connecting ? 'Connecting...' : 'Connect Google Calendar'}
          </button>
        )}
      </div>
    </div>
  )
}
