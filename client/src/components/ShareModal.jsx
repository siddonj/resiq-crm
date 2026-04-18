import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function ShareModal({ resourceType, resourceId, resourceName, onClose }) {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [shares, setShares] = useState([])
  const [users, setUsers] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [shareWith, setShareWith] = useState('user')
  const [selectedId, setSelectedId] = useState('')
  const [permission, setPermission] = useState('view')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      axios.get(`/api/sharing/${resourceType}/${resourceId}`, headers),
      axios.get('/api/users', headers).catch(() => ({ data: [] })),
      axios.get('/api/teams', headers).catch(() => ({ data: [] })),
    ]).then(([sharesRes, usersRes, teamsRes]) => {
      setShares(sharesRes.data)
      setUsers(usersRes.data.filter(u => u.is_active))
      setTeams(teamsRes.data)
    }).catch(() => setError('Failed to load sharing info'))
      .finally(() => setLoading(false))
  }, [])

  const alreadySharedUserIds = shares.filter(s => s.shared_with_user_id).map(s => s.shared_with_user_id)
  const alreadySharedTeamIds = shares.filter(s => s.shared_with_team_id).map(s => s.shared_with_team_id)

  const availableUsers = users.filter(u => !alreadySharedUserIds.includes(u.id))
  const availableTeams = teams.filter(t => !alreadySharedTeamIds.includes(t.id))

  const handleAdd = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const body = {
        resource_type: resourceType,
        resource_id: resourceId,
        permission,
        ...(shareWith === 'user' ? { shared_with_user_id: selectedId } : { shared_with_team_id: selectedId }),
      }
      const res = await axios.post('/api/sharing', body, headers)
      const newShare = res.data
      // Re-fetch to get display names
      const sharesRes = await axios.get(`/api/sharing/${resourceType}/${resourceId}`, headers)
      setShares(sharesRes.data)
      setSelectedId('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to share')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (shareId) => {
    try {
      await axios.delete(`/api/sharing/${shareId}`, headers)
      setShares(prev => prev.filter(s => s.id !== shareId))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove share')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-syne text-lg font-bold text-navy">Share</h3>
            <p className="text-xs text-brand-gray mt-0.5 truncate max-w-xs">{resourceName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && <p className="text-sm text-red-500">{error}</p>}

          {loading ? (
            <p className="text-sm text-brand-gray">Loading...</p>
          ) : (
            <>
              {/* Current shares */}
              {shares.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-navy uppercase tracking-wide mb-2">Shared With</p>
                  <div className="space-y-2">
                    {shares.map(s => (
                      <div key={s.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-gray-50">
                        <div>
                          <p className="text-sm font-medium text-navy">
                            {s.shared_with_user_name || s.shared_with_team_name}
                          </p>
                          <p className="text-xs text-brand-gray">
                            {s.shared_with_user_email || 'Team'} · {s.permission}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemove(s.id)}
                          className="text-xs text-red-400 hover:text-red-600 ml-3"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add share form */}
              {(availableUsers.length > 0 || availableTeams.length > 0) ? (
                <form onSubmit={handleAdd} className="space-y-3 border-t border-gray-100 pt-4">
                  <p className="text-xs font-semibold text-navy uppercase tracking-wide">Add Access</p>
                  <div className="flex gap-2">
                    <select
                      value={shareWith}
                      onChange={e => { setShareWith(e.target.value); setSelectedId('') }}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy bg-white"
                    >
                      {availableUsers.length > 0 && <option value="user">User</option>}
                      {availableTeams.length > 0 && <option value="team">Team</option>}
                    </select>
                    <select
                      value={selectedId}
                      onChange={e => setSelectedId(e.target.value)}
                      required
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy bg-white"
                    >
                      <option value="">Select...</option>
                      {shareWith === 'user'
                        ? availableUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)
                        : availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
                      }
                    </select>
                    <select
                      value={permission}
                      onChange={e => setPermission(e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy bg-white"
                    >
                      <option value="view">View</option>
                      <option value="edit">Edit</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={saving || !selectedId}
                    className="w-full py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors"
                  >
                    {saving ? 'Sharing...' : 'Share'}
                  </button>
                </form>
              ) : shares.length === 0 ? (
                <p className="text-sm text-brand-gray text-center py-2">No users or teams available to share with.</p>
              ) : (
                <p className="text-sm text-brand-gray text-center py-2 border-t border-gray-100 pt-4">Shared with all available users and teams.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
