import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function GmailConnect() {
  const { token } = useAuth()
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [labels, setLabels] = useState([])
  const [selectedLabels, setSelectedLabels] = useState([])
  const [labelRecommendation, setLabelRecommendation] = useState('')
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

      // If connected, fetch labels
      if (res.data.connected) {
        fetchLabels()
      }
    } catch (err) {
      console.error('Error checking Gmail status:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchLabels = async () => {
    try {
      const res = await axios.get('/api/integrations/gmail/labels', authHeaders)
      setLabels(res.data.labels)
      if (res.data.recommendation) {
        setLabelRecommendation(res.data.recommendation)
      }
    } catch (err) {
      console.error('Error fetching labels:', err)
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
      setLabels([])
      setSelectedLabels([])
      setLabelRecommendation('')
      setSuccess('Gmail disconnected')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to disconnect Gmail')
    }
  }

  const toggleLabel = (labelId) => {
    setSelectedLabels(prev =>
      prev.includes(labelId)
        ? prev.filter(id => id !== labelId)
        : [...prev, labelId]
    )
  }

  const handleSync = async () => {
    setSyncing(true)
    setError('')
    try {
      await axios.post('/api/integrations/gmail/sync', { labelIds: selectedLabels.length > 0 ? selectedLabels : null }, authHeaders)
      const labelText = selectedLabels.length > 0 ? ` (from ${selectedLabels.length} label${selectedLabels.length > 1 ? 's' : ''})` : ''
      setSuccess(`Email sync started${labelText}. Check back in a few seconds...`)
      setTimeout(() => setSuccess(''), 5000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start email sync')
    } finally {
      setSyncing(false)
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
          <div className="flex-1">
            <h3 className="font-semibold text-navy">Gmail Integration</h3>
            <p className="text-xs text-brand-gray mt-1">
              {connected ? '✅ Connected' : '❌ Not connected'}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Connect your Gmail account to automatically log emails to contacts. All communication history will appear in your contact timeline.
            </p>

            {connected && (
              <>
                {labelRecommendation && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-700">
                      <strong>📌 Setup tip:</strong> {labelRecommendation}
                    </p>
                    <p className="text-xs text-blue-600 mt-1">
                      Create labels like: ResiQ-Leads, ResiQ-Prospects, ResiQ-Opportunities, ResiQ-Customers
                    </p>
                  </div>
                )}

                {labels.length > 0 && (
                  <div className="mt-4">
                    <label className="text-xs font-semibold text-navy mb-2 block">
                      Sync from labels (optional):
                    </label>
                    <div className="space-y-2">
                      {labels.map((label) => (
                        <label key={label.id} className="flex items-center text-sm">
                          <input
                            type="checkbox"
                            checked={selectedLabels.includes(label.id)}
                            onChange={() => toggleLabel(label.id)}
                            className="w-4 h-4 rounded border-gray-300 text-teal cursor-pointer"
                          />
                          <span className="ml-2 text-gray-700">{label.name}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Leave unchecked to sync all recent emails
                    </p>
                  </div>
                )}
              </>
            )}
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
              {connecting ? 'Connecting...' : 'Connect Gmail'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
