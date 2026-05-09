import { useState } from 'react'
import axios from 'axios'

const ROLES = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
]

export default function MembersPanel({ projectId, members = [], users = [], teams = [], token, currentUserId, onMembersChanged }) {
  const headers = { headers: { Authorization: `Bearer ${token}` } }
  const base = `/api/projects/${projectId}/members`

  const [showAdd, setShowAdd] = useState(false)
  const [addType, setAddType] = useState('user')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [selectedRole, setSelectedRole] = useState('member')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleAdd = async () => {
    setError('')
    setSaving(true)
    try {
      const body = { role: selectedRole }
      if (addType === 'user') body.user_id = selectedUserId
      else body.team_id = selectedTeamId

      await axios.post(base, body, headers)
      setSelectedUserId('')
      setSelectedTeamId('')
      setSelectedRole('member')
      setShowAdd(false)
      onMembersChanged?.()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add member')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (memberId) => {
    try {
      await axios.delete(`${base}/${memberId}`, headers)
      onMembersChanged?.()
    } catch (err) {
      setError('Failed to remove member')
    }
  }

  const handleRoleChange = async (memberId, newRole) => {
    try {
      await axios.put(`${base}/${memberId}`, { role: newRole }, headers)
      onMembersChanged?.()
    } catch (err) {
      setError('Failed to update role')
    }
  }

  // Filter out already added users
  const addedUserIds = new Set(members.filter((m) => m.user_id).map((m) => m.user_id))
  const availableUsers = users.filter((u) => u.id !== currentUserId && !addedUserIds.has(u.id))

  // Filter available teams
  const addedTeamIds = new Set(members.filter((m) => m.team_id).map((m) => m.team_id))
  const availableTeams = teams.filter((t) => !addedTeamIds.has(t.id))

  return (
    <div className="bg-white border rounded-lg shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Members</h3>
          <p className="text-sm text-gray-600">{members.length} member{members.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          + Add
        </button>
      </div>

      {error && <div className="mb-3 text-xs text-red-600">{error}</div>}

      {showAdd && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setAddType('user')}
              className={`px-3 py-1 text-xs rounded-md ${addType === 'user' ? 'bg-indigo-100 text-indigo-700 border border-indigo-300' : 'bg-white text-gray-700 border'}`}
            >
              User
            </button>
            <button
              onClick={() => setAddType('team')}
              className={`px-3 py-1 text-xs rounded-md ${addType === 'team' ? 'bg-indigo-100 text-indigo-700 border border-indigo-300' : 'bg-white text-gray-700 border'}`}
            >
              Team
            </button>
          </div>
          {addType === 'user' ? (
            <select
              className="w-full rounded-md border-gray-300 text-sm"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">Select user</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                   {u.name || u.email}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="w-full rounded-md border-gray-300 text-sm"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
            >
              <option value="">Select team</option>
              {availableTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          <select
            className="w-full rounded-md border-gray-300 text-sm"
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={saving || (addType === 'user' ? !selectedUserId : !selectedTeamId)}
            className="w-full px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add Member'}
          </button>
        </div>
      )}

      <div className="space-y-1">
        {members.length === 0 ? (
          <div className="text-sm text-gray-500">No members added.</div>
        ) : (
          members.map((m) => {
            const displayName = m.user_id
              ? (m.user_name || m.email || m.user_id)
              : m.team_name || m.team_id
            const isTeam = !!m.team_id
            const canManage = currentUserId !== m.user_id && !isTeam

            return (
              <div key={m.id} className="flex items-center justify-between py-1.5 px-2 bg-gray-50 rounded text-sm">
                <div className="flex items-center gap-2 truncate">
                  <span className="truncate text-gray-800">{displayName}</span>
                  {isTeam && <span className="text-[10px] bg-purple-100 text-purple-700 rounded px-1.5">Team</span>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    className="text-xs border-gray-200 rounded py-0.5 focus:ring-indigo-500"
                    value={m.role}
                    onChange={(e) => handleRoleChange(m.id, e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleRemove(m.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                    title={`Remove ${displayName}`}
                  >
                    &times;
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
