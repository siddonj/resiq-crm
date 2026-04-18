import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import WorkflowBuilderModal from '../components/WorkflowBuilderModal'

export default function Workflows() {
  const { token } = useAuth()
  const [workflows, setWorkflows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showBuilder, setShowBuilder] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState(null)
  const [error, setError] = useState('')

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  const fetchWorkflows = () => {
    axios.get('/api/workflows', authHeaders)
      .then(r => setWorkflows(r.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to load workflows'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchWorkflows() }, [token])

  const handleCreateNew = () => {
    setEditingWorkflow(null)
    setShowBuilder(true)
  }

  const handleEdit = (workflow) => {
    setEditingWorkflow(workflow)
    setShowBuilder(true)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this workflow?')) return
    try {
      await axios.delete(`/api/workflows/${id}`, authHeaders)
      setWorkflows(prev => prev.filter(w => w.id !== id))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete workflow')
    }
  }

  const handleToggleEnabled = async (id, enabled) => {
    try {
      const { data } = await axios.patch(`/api/workflows/${id}`, { enabled: !enabled }, authHeaders)
      setWorkflows(prev => prev.map(w => w.id === id ? data : w))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update workflow')
    }
  }

  const handleSaveWorkflow = () => {
    fetchWorkflows()
    setShowBuilder(false)
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-syne text-2xl font-bold text-navy">Workflows</h2>
        <button
          onClick={handleCreateNew}
          className="bg-teal text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-teal/90 transition-colors"
        >
          + New Workflow
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 font-semibold">✕</button>
        </div>
      )}

      {loading ? (
        <p className="text-brand-gray text-sm">Loading workflows...</p>
      ) : workflows.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="font-syne text-lg text-navy font-semibold mb-2">No workflows yet</p>
          <p className="text-brand-gray text-sm mb-4">Create your first workflow to automate tasks, emails, and more.</p>
          <button
            onClick={handleCreateNew}
            className="bg-teal text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-teal/90 transition-colors"
          >
            Create Workflow
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {workflows.map(w => (
            <div key={w.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-syne text-lg font-bold text-navy">{w.name}</h3>
                    <button
                      onClick={() => handleToggleEnabled(w.id, w.enabled)}
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        w.enabled
                          ? 'bg-teal/10 text-teal'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {w.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                  {w.description && (
                    <p className="text-sm text-gray-600 mb-3">{w.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-brand-gray">
                    <span>📍 Trigger: {w.trigger_type.replace('_', ' ').replace(/(?:^|\s)\S/g, a => a.toUpperCase())}</span>
                    <span>⚙️ Actions: {w.actions?.length || 0}</span>
                    <span>📅 Created {new Date(w.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(w)}
                    className="text-xs text-gray-400 hover:text-teal transition-colors px-3 py-1.5 rounded hover:bg-gray-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(w.id)}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors px-3 py-1.5 rounded hover:bg-gray-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showBuilder && (
        <WorkflowBuilderModal
          workflow={editingWorkflow}
          onSave={handleSaveWorkflow}
          onClose={() => setShowBuilder(false)}
          token={token}
        />
      )}
    </div>
  )
}
