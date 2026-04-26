import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Manager',
  rep: 'Rep',
  user: 'Rep',
  viewer: 'Viewer',
}

const ALL_ROLES = ['admin', 'manager', 'rep', 'user', 'viewer']

export default function Users() {
  const { token, user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isManager = user?.role === 'manager'

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRole, setSelectedRole] = useState({})

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'rep' })
  const [inviteError, setInviteError] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteResult, setInviteResult] = useState(null)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    if (!isAdmin && !isManager) {
      setError('Access restricted to admins and managers')
      setLoading(false)
      return
    }
    fetchUsers()
  }, [token, user])

  const fetchUsers = async () => {
    try {
      const res = await axios.get('/api/users', authHeaders)
      setUsers(res.data)
      setError(null)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch users')
    } finally {
      setLoading(false)
    }
  }

  const updateRole = async (userId, newRole) => {
    try {
      const res = await axios.put(`/api/users/${userId}/role`, { role: newRole }, authHeaders)
      setUsers(users.map(u => u.id === userId ? res.data : u))
      setSelectedRole({ ...selectedRole, [userId]: newRole })
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update role')
    }
  }

  const deactivateUser = async (userId) => {
    if (!confirm('Deactivate this user?')) return
    try {
      const res = await axios.put(`/api/users/${userId}/deactivate`, {}, authHeaders)
      setUsers(users.map(u => u.id === userId ? res.data : u))
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to deactivate user')
    }
  }

  const activateUser = async (userId) => {
    try {
      const res = await axios.put(`/api/users/${userId}/activate`, {}, authHeaders)
      setUsers(users.map(u => u.id === userId ? res.data : u))
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to activate user')
    }
  }

  const handleInviteSubmit = async (e) => {
    e.preventDefault()
    setInviteError('')
    setInviteLoading(true)
    try {
      const res = await axios.post('/api/users/invite', inviteForm, authHeaders)
      setInviteResult(res.data)
      fetchUsers()
    } catch (err) {
      setInviteError(err.response?.data?.error || 'Failed to invite user')
    } finally {
      setInviteLoading(false)
    }
  }

  const closeInvite = () => {
    setShowInvite(false)
    setInviteForm({ name: '', email: '', role: 'rep' })
    setInviteError('')
    setInviteResult(null)
  }

  if (!isAdmin && !isManager) {
    return (
      <div className="p-8">
        <p className="text-red-500">Access restricted to admins and managers</p>
      </div>
    )
  }

  if (loading) {
    return <div className="p-8">Loading users...</div>
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="font-syne text-2xl font-bold text-navy mb-2">User Management</h2>
          <p className="text-sm text-brand-gray">{users.length} user{users.length !== 1 ? 's' : ''}{isManager ? ' on your team' : ' total'}</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowInvite(true)}
            className="px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 transition-colors"
          >
            + Invite User
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-navy">Name</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-navy">Email</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-navy">Role</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-navy">Status</th>
              {isAdmin && <th className="px-6 py-3 text-left text-xs font-semibold text-navy">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm font-medium text-navy">{u.name}</td>
                <td className="px-6 py-4 text-sm text-brand-gray">{u.email}</td>
                <td className="px-6 py-4 text-sm">
                  {isAdmin && u.id !== user.id ? (
                    <select
                      value={selectedRole[u.id] || u.role}
                      onChange={(e) => updateRole(u.id, e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      {ALL_ROLES.map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-navy capitalize">
                      {ROLE_LABELS[u.role] || u.role}
                      {u.id === user.id && <span className="ml-1 text-xs text-brand-gray">(you)</span>}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${
                    u.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 text-sm">
                    {u.id !== user.id ? (
                      u.is_active ? (
                        <button
                          onClick={() => deactivateUser(u.id)}
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => activateUser(u.id)}
                          className="text-green-600 hover:text-green-800 text-xs"
                        >
                          Activate
                        </button>
                      )
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invite User Modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-navy font-syne mb-4">Invite User</h3>
            {inviteResult ? (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 border border-green-200 rounded text-sm text-green-800">
                  <p className="font-semibold mb-1">User invited successfully!</p>
                  <p>Share this temporary password with <strong>{inviteResult.user.email}</strong>:</p>
                  <p className="mt-2 font-mono text-base bg-white border border-green-300 rounded px-3 py-2 select-all">
                    {inviteResult.tempPassword}
                  </p>
                  <p className="mt-2 text-xs text-green-700">They should change this password after first login.</p>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={closeInvite}
                    className="px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleInviteSubmit} className="space-y-4">
                {inviteError && (
                  <p className="text-sm text-red-500">{inviteError}</p>
                )}
                <div>
                  <label className="block text-xs font-semibold text-navy mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={inviteForm.name}
                    onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy"
                    placeholder="Jane Smith"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={inviteForm.email}
                    onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy"
                    placeholder="jane@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy mb-1">Role</label>
                  <select
                    value={inviteForm.role}
                    onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy"
                  >
                    {ALL_ROLES.map(r => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeInvite}
                    className="px-4 py-2 text-sm text-brand-gray hover:text-navy transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={inviteLoading}
                    className="px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors"
                  >
                    {inviteLoading ? 'Inviting...' : 'Send Invite'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
