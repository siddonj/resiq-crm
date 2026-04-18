import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function GmailConnect() {
  const { token } = useAuth()
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  // Check connection status on mount
  useEffect(() => {
    checkStatus()
  }, [])

  const checkStatus = async () => {
    try {
      const res = await axios.get('/api/integrations/gmail/status', authHeaders)
      setConnected(res.data.connected)
    } catch (err) {
      console.error('Error checking Gmail status:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = async () => {
    setConnecting(true)
    setError('')
    try {
      const res = await axios.post('/api/integrations/gmail/connect', {}, authHeaders)
      // Redirect to Google OAuth
      window.location.href = res.data.authUrl
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start Gmail connection')
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Gmail? Email history will remain but new emails won\'t sync.')) return

    try {
      await axios.post('/api/integrations/gmail/disconnect', {}, authHeaders)
      setConnected(false)
      setSuccess('Gmail disconnected')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to disconnect Gmail')
    }
  }

  if (loading) return <p className="text-brand-gray text-sm">Checking Gmail connection...</p>

  return (
    <div className="space-y-4">
      {error && (
        <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">{error}</div>
      )}
      {success && (
        <div className="px-4 py-2 bg-green-50 border border-green-200 text-green-600 rounded-lg text-sm">{success}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-navy">Gmail Integration</h3>
            <p className="text-xs text-brand-gray mt-1">
              {connected ? '✅ Connected' : '❌ Not connected'}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Connect your Gmail account to automatically log emails to contacts. All communication history will appear in your contact timeline.
            </p>
          </div>
          {connected ? (
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="px-4 py-2 text-sm bg-teal text-white rounded-lg hover:bg-teal/90 transition-colors disabled:opacity-60"
            >
              {connecting ? 'Connecting...' : 'Connect Gmail'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
