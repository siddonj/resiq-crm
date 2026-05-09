import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
]

export default function Projects() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const loadProjects = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/projects', headers)
      setProjects(data)
    } catch (err) {
      setError('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) loadProjects()
  }, [token])

  const filtered = useMemo(() => {
    let result = projects
    if (statusFilter !== 'all') {
      result = result.filter((p) => p.status === statusFilter)
    }
    const q = search.toLowerCase()
    if (q) {
      result = result.filter((p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      )
    }
    return result
  }, [projects, statusFilter, search])

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    try {
      await axios.post('/api/projects', form, headers)
      setShowModal(false)
      setForm({ name: '', description: '' })
      setError('')
      loadProjects()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-600">Plan and track work across teams.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none"
        >
          New Project
        </button>
      </div>

      {/* Filter bar */}
      <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                statusFilter === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            className="pl-8 pr-8 py-2 w-full text-sm rounded-md border-gray-300 focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              &times;
            </button>
          )}
        </div>
        {search || statusFilter !== 'all' ? (
          <span className="text-xs text-gray-500">
            Showing {filtered.length} of {projects.length}
          </span>
        ) : null}
      </div>

      {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="mt-6 text-sm text-gray-600">Loading projects…</div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 text-sm text-gray-600">
          {projects.length === 0 ? 'No projects yet. Create your first project.' : 'No projects match your filters.'}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="border rounded-lg p-4 hover:border-indigo-500 hover:shadow-sm cursor-pointer transition-all"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 truncate">{p.name}</h3>
                <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  p.status === 'archived' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
                }`}>
                  {p.status || 'active'}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-700 line-clamp-2">{p.description || 'No description'}</p>
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                <span>{new Date(p.created_at).toLocaleDateString()}</span>
                {p.member_count !== undefined && (
                  <span>{p.member_count} member{p.member_count !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900">Create Project</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Rollout Plan"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Deployment plan for data sources"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none disabled:opacity-60"
              >
                {saving ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
