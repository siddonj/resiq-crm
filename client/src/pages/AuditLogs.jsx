import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const RESOURCE_TYPES = ['contact', 'deal', 'team', 'user']

const ACTION_LABELS = {
  create: { label: 'Created', color: 'bg-emerald-50 text-emerald-700' },
  update: { label: 'Updated', color: 'bg-blue-50 text-blue-700' },
  delete: { label: 'Deleted', color: 'bg-red-50 text-red-700' },
  stage_change: { label: 'Stage Changed', color: 'bg-amber-50 text-amber-700' },
  role_change: { label: 'Role Changed', color: 'bg-purple-50 text-purple-700' },
  activate: { label: 'Activated', color: 'bg-emerald-50 text-emerald-700' },
  deactivate: { label: 'Deactivated', color: 'bg-red-50 text-red-700' },
  add_member: { label: 'Member Added', color: 'bg-blue-50 text-blue-700' },
  remove_member: { label: 'Member Removed', color: 'bg-red-50 text-red-700' },
}

function formatMetadata(action, metadata) {
  if (!metadata || Object.keys(metadata).length === 0) return null
  if (action === 'stage_change') return `${metadata.from} → ${metadata.to}`
  if (action === 'role_change') return `New role: ${metadata.new_role}`
  if (action === 'add_member') return `Role: ${metadata.role}`
  return null
}

export default function AuditLogs() {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ resource_type: '', from: '', to: '' })
  const [users, setUsers] = useState([])
  const [selectedUser, setSelectedUser] = useState('')

  const LIMIT = 50

  const fetchLogs = async (pg = page, f = filters, uid = selectedUser) => {
    setLoading(true)
    const params = { page: pg, limit: LIMIT }
    if (f.resource_type) params.resource_type = f.resource_type
    if (f.from) params.from = f.from
    if (f.to) params.to = f.to + 'T23:59:59Z'
    if (uid) params.user_id = uid
    try {
      const res = await axios.get('/api/audit-logs', { ...headers, params })
      setLogs(res.data.logs)
      setTotal(res.data.total)
    } catch {
      setLogs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
    axios.get('/api/users', headers).then(r => setUsers(r.data)).catch(() => {})
  }, [])

  const applyFilters = () => {
    setPage(1)
    fetchLogs(1, filters, selectedUser)
  }

  const clearFilters = () => {
    const empty = { resource_type: '', from: '', to: '' }
    setFilters(empty)
    setSelectedUser('')
    setPage(1)
    fetchLogs(1, empty, '')
  }

  const goToPage = (pg) => {
    setPage(pg)
    fetchLogs(pg, filters, selectedUser)
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-navy font-syne">Audit Logs</h2>
        <p className="text-sm text-brand-gray mt-1">Track all user actions across the CRM</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-navy mb-1">Resource Type</label>
            <select
              value={filters.resource_type}
              onChange={e => setFilters(f => ({ ...f, resource_type: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy bg-white"
            >
              <option value="">All types</option>
              {RESOURCE_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-navy mb-1">User</label>
            <select
              value={selectedUser}
              onChange={e => setSelectedUser(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy bg-white"
            >
              <option value="">All users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-navy mb-1">From</label>
            <input
              type="date"
              value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-navy mb-1">To</label>
            <input
              type="date"
              value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy"
            />
          </div>
          <button
            onClick={applyFilters}
            className="px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 transition-colors"
          >
            Apply
          </button>
          <button
            onClick={clearFilters}
            className="px-4 py-2 text-sm text-brand-gray hover:text-navy transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-brand-gray">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center text-sm text-brand-gray">No log entries found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['When', 'User', 'Action', 'Resource', 'Detail'].map((h, i) => (
                  <th key={i} className="text-left px-4 py-3 text-xs font-semibold text-brand-gray uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map(log => {
                const actionInfo = ACTION_LABELS[log.action] || { label: log.action, color: 'bg-gray-100 text-gray-600' }
                const meta = formatMetadata(log.action, log.metadata)
                return (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-brand-gray whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-navy">{log.user_email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${actionInfo.color}`}>
                        {actionInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs capitalize text-brand-gray">{log.resource_type}</span>
                      {log.resource_name && (
                        <span className="ml-1 text-xs font-medium text-navy">· {log.resource_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-brand-gray">{meta || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-brand-gray">{total} total entries</p>
          <div className="flex gap-2">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="px-3 py-1.5 text-xs text-navy">Page {page} of {totalPages}</span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
