import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function Teams() {
  const { token, user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [teams, setTeams] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [teamDetail, setTeamDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')

  // Create/edit form state
  const [showForm, setShowForm] = useState(false)
  const [editingTeam, setEditingTeam] = useState(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formError, setFormError] = useState('')
  const [formLoading, setFormLoading] = useState(false)

  // Add member state
  const [addUserId, setAddUserId] = useState('')
  const [addUserRole, setAddUserRole] = useState('member')
  const [addMemberError, setAddMemberError] = useState('')
  const [addMemberLoading, setAddMemberLoading] = useState(false)

  useEffect(() => {
    fetchTeams()
    if (isAdmin) fetchAllUsers()
  }, [])

  useEffect(() => {
    if (selectedTeam) fetchTeamDetail(selectedTeam.id)
    else setTeamDetail(null)
  }, [selectedTeam])

  const fetchTeams = async () => {
    try {
      const res = await axios.get('/api/teams', headers)
      setTeams(res.data)
    } catch (err) {
      setError('Failed to load teams')
    } finally {
      setLoading(false)
    }
  }

  const fetchAllUsers = async () => {
    try {
      const res = await axios.get('/api/users', headers)
      setAllUsers(res.data.filter(u => u.is_active))
    } catch {}
  }

  const fetchTeamDetail = async (id) => {
    setDetailLoading(true)
    try {
      const res = await axios.get(`/api/teams/${id}`, headers)
      setTeamDetail(res.data)
    } catch {
      setTeamDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const openCreate = () => {
    setEditingTeam(null)
    setFormName('')
    setFormDesc('')
    setFormError('')
    setShowForm(true)
  }

  const openEdit = (team) => {
    setEditingTeam(team)
    setFormName(team.name)
    setFormDesc(team.description || '')
    setFormError('')
    setShowForm(true)
  }

  const handleFormSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    setFormLoading(true)
    try {
      if (editingTeam) {
        await axios.put(`/api/teams/${editingTeam.id}`, { name: formName, description: formDesc }, headers)
        if (selectedTeam?.id === editingTeam.id) setSelectedTeam({ ...selectedTeam, name: formName })
      } else {
        const res = await axios.post('/api/teams', { name: formName, description: formDesc }, headers)
        setTeams(prev => [...prev, { ...res.data, member_count: 0 }])
      }
      await fetchTeams()
      setShowForm(false)
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save team')
    } finally {
      setFormLoading(false)
    }
  }

  const handleDelete = async (team) => {
    if (!confirm(`Delete team "${team.name}"? This cannot be undone.`)) return
    try {
      await axios.delete(`/api/teams/${team.id}`, headers)
      setTeams(prev => prev.filter(t => t.id !== team.id))
      if (selectedTeam?.id === team.id) setSelectedTeam(null)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete team')
    }
  }

  const handleAddMember = async (e) => {
    e.preventDefault()
    setAddMemberError('')
    setAddMemberLoading(true)
    try {
      await axios.post(`/api/teams/${selectedTeam.id}/members`, { user_id: addUserId, role: addUserRole }, headers)
      setAddUserId('')
      setAddUserRole('member')
      fetchTeamDetail(selectedTeam.id)
      fetchTeams()
    } catch (err) {
      setAddMemberError(err.response?.data?.error || 'Failed to add member')
    } finally {
      setAddMemberLoading(false)
    }
  }

  const handleRemoveMember = async (userId) => {
    try {
      await axios.delete(`/api/teams/${selectedTeam.id}/members/${userId}`, headers)
      fetchTeamDetail(selectedTeam.id)
      fetchTeams()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove member')
    }
  }

  const handleMemberRoleChange = async (userId, newRole) => {
    try {
      await axios.put(`/api/teams/${selectedTeam.id}/members/${userId}/role`, { role: newRole }, headers)
      fetchTeamDetail(selectedTeam.id)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update role')
    }
  }

  const availableToAdd = allUsers.filter(
    u => !teamDetail?.members?.some(m => m.id === u.id)
  )

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-navy font-syne">Teams</h2>
          <p className="text-sm text-brand-gray mt-1">Organize users into teams</p>
        </div>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 transition-colors"
          >
            + New Team
          </button>
        )}
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Team list */}
        <div className="lg:col-span-1 space-y-3">
          {loading ? (
            <p className="text-sm text-brand-gray">Loading...</p>
          ) : teams.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-brand-gray">
              No teams yet.{isAdmin && ' Create one to get started.'}
            </div>
          ) : (
            teams.map(team => (
              <div
                key={team.id}
                onClick={() => setSelectedTeam(team)}
                className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${
                  selectedTeam?.id === team.id
                    ? 'border-teal shadow-sm'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-navy text-sm truncate">{team.name}</p>
                    {team.description && (
                      <p className="text-xs text-brand-gray mt-0.5 truncate">{team.description}</p>
                    )}
                    <p className="text-xs text-brand-gray mt-1">
                      {team.member_count} {team.member_count === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1 ml-2 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(team) }}
                        className="text-xs text-brand-gray hover:text-navy px-1.5 py-1 rounded"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(team) }}
                        className="text-xs text-red-400 hover:text-red-600 px-1.5 py-1 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Team detail panel */}
        <div className="lg:col-span-2">
          {!selectedTeam ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 flex items-center justify-center text-sm text-brand-gray">
              Select a team to view members
            </div>
          ) : detailLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 flex items-center justify-center text-sm text-brand-gray">
              Loading...
            </div>
          ) : teamDetail ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
              <div>
                <h3 className="text-lg font-bold text-navy font-syne">{teamDetail.name}</h3>
                {teamDetail.description && (
                  <p className="text-sm text-brand-gray mt-1">{teamDetail.description}</p>
                )}
                <p className="text-xs text-brand-gray mt-1">Created by {teamDetail.created_by_name}</p>
              </div>

              {/* Members list */}
              <div>
                <p className="text-xs font-semibold text-navy uppercase tracking-wide mb-3">
                  Members ({teamDetail.members.length})
                </p>
                {teamDetail.members.length === 0 ? (
                  <p className="text-sm text-brand-gray">No members yet.</p>
                ) : (
                  <div className="space-y-2">
                    {teamDetail.members.map(member => (
                      <div key={member.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-navy truncate">{member.name}</p>
                          <p className="text-xs text-brand-gray truncate">{member.email}</p>
                        </div>
                        <div className="flex items-center gap-2 ml-3 shrink-0">
                          {isAdmin ? (
                            <select
                              value={member.team_role}
                              onChange={(e) => handleMemberRoleChange(member.id, e.target.value)}
                              className="text-xs border border-gray-200 rounded px-2 py-1 text-navy bg-white"
                            >
                              <option value="member">Member</option>
                              <option value="lead">Lead</option>
                            </select>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded bg-gray-100 text-navy capitalize">
                              {member.team_role}
                            </span>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => handleRemoveMember(member.id)}
                              className="text-xs text-red-400 hover:text-red-600 px-1.5 py-1"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add member form — admin only */}
              {isAdmin && availableToAdd.length > 0 && (
                <form onSubmit={handleAddMember} className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-semibold text-navy uppercase tracking-wide mb-3">Add Member</p>
                  {addMemberError && <p className="text-xs text-red-500 mb-2">{addMemberError}</p>}
                  <div className="flex gap-2">
                    <select
                      value={addUserId}
                      onChange={(e) => setAddUserId(e.target.value)}
                      required
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy"
                    >
                      <option value="">Select user...</option>
                      {availableToAdd.map(u => (
                        <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                      ))}
                    </select>
                    <select
                      value={addUserRole}
                      onChange={(e) => setAddUserRole(e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy"
                    >
                      <option value="member">Member</option>
                      <option value="lead">Lead</option>
                    </select>
                    <button
                      type="submit"
                      disabled={addMemberLoading || !addUserId}
                      className="px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-navy font-syne mb-4">
              {editingTeam ? 'Edit Team' : 'New Team'}
            </h3>
            {formError && <p className="text-sm text-red-500 mb-3">{formError}</p>}
            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-navy mb-1">Team Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy"
                  placeholder="e.g. East Coast Sales"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy mb-1">Description (optional)</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy resize-none"
                  placeholder="What does this team work on?"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-brand-gray hover:text-navy transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors"
                >
                  {formLoading ? 'Saving...' : editingTeam ? 'Save Changes' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
