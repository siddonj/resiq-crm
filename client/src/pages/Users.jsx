import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function Users() {
  const { token, user } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRole, setSelectedRole] = useState({})

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    if (user?.role !== 'admin') {
      setError('Only admins can access this page')
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

  if (!user || user.role !== 'admin') {
    return (
      <div className="p-8">
        <p className="text-red-500">Only admins can access this page</p>
      </div>
    )
  }

  if (loading) {
    return <div className="p-8">Loading users...</div>
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="font-syne text-2xl font-bold text-navy mb-2">User Management</h2>
        <p className="text-sm text-brand-gray">{users.length} users total</p>
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
              <th className="px-6 py-3 text-left text-xs font-semibold text-navy">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm font-medium text-navy">{u.name}</td>
                <td className="px-6 py-4 text-sm text-brand-gray">{u.email}</td>
                <td className="px-6 py-4 text-sm">
                  <select
                    value={selectedRole[u.id] || u.role}
                    onChange={(e) => updateRole(u.id, e.target.value)}
                    disabled={u.id === user.id}
                    className="px-2 py-1 border border-gray-300 rounded text-sm"
                  >
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="user">User</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${
                    u.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm">
                  {u.id !== user.id && (
                    <>
                      {u.is_active ? (
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
                      )}
                    </>
                  )}
                  {u.id === user.id && <span className="text-gray-400 text-xs">You</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
