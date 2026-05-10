import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function Portfolios() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [portfolios, setPortfolios] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedProjectIds, setSelectedProjectIds] = useState([])

  const loadPortfolios = async () => {
    setLoading(true)
    try {
      const [{ data: portData }, { data: projData }] = await Promise.all([
        axios.get('/api/portfolios', headers),
        axios.get('/api/projects', headers).catch(() => ({ data: [] })),
      ])
      setPortfolios(portData)
      setProjects(projData)
      setError('')
    } catch (err) {
      setError('Failed to load portfolios')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) loadPortfolios()
  }, [token])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await axios.post('/api/portfolios', {
        name: name.trim(),
        description: description || null,
        project_ids: selectedProjectIds,
      }, headers)
      setShowForm(false)
      setName('')
      setDescription('')
      setSelectedProjectIds([])
      loadPortfolios()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create portfolio')
    }
  }

  const handleDelete = async (id, title) => {
    if (!window.confirm(`Delete portfolio "${title}"?`)) return
    try {
      await axios.delete(`/api/portfolios/${id}`, headers)
      loadPortfolios()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete portfolio')
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-600">Loading portfolios…</div>

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Portfolios</h1>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
        >
          + New Portfolio
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

      {showForm && (
        <div className="bg-white border rounded-lg p-4 mb-6 max-w-lg">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Create Portfolio</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Name</label>
              <input className="w-full rounded-md border-gray-300 text-sm" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Description</label>
              <textarea className="w-full rounded-md border-gray-300 text-sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Projects</label>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto border rounded-md p-2">
                {projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedProjectIds.includes(p.id)}
                      onChange={(e) => {
                        setSelectedProjectIds((prev) =>
                          e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                        )
                      }}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Create</button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {portfolios.length === 0 && !showForm && (
        <div className="text-sm text-gray-500">No portfolios yet. Create one to group related projects.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {portfolios.map((portfolio) => (
          <div
            key={portfolio.id}
            className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => navigate(`/portfolios/${portfolio.id}`)}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{portfolio.name}</h3>
                {portfolio.description && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{portfolio.description}</p>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(portfolio.id, portfolio.name) }}
                className="text-xs px-2 py-1 rounded hover:bg-red-50 text-red-500"
                title="Delete"
              >
                ×
              </button>
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
              <span>{portfolio.project_count || 0} projects</span>
              <span>Owner: {portfolio.owner_name || '—'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
