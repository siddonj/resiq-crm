import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'

export default function BaselineComparison({ projectId, baselines = [], onBaselineChange }) {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [selectedBaselineId, setSelectedBaselineId] = useState('')
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadComparison = async (baselineId) => {
    if (!baselineId) return
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(
        `/api/projects/${projectId}/baselines/${baselineId}/compare`,
        headers
      )
      setComparison(data)
    } catch (err) {
      setError('Failed to load comparison')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedBaselineId) loadComparison(selectedBaselineId)
    else setComparison(null)
  }, [selectedBaselineId])

  const handleDelete = async (baselineId) => {
    if (!confirm('Delete this baseline?')) return
    try {
      await axios.delete(`/api/projects/${projectId}/baselines/${baselineId}`, headers)
      onBaselineChange?.()
      if (selectedBaselineId === baselineId) setSelectedBaselineId('')
    } catch (err) {
      alert('Failed to delete baseline')
    }
  }

  const selectedBaseline = baselines.find((b) => b.id === selectedBaselineId)

  return (
    <div className="bg-white border rounded-lg shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Baseline Comparison</h2>
          <p className="text-sm text-gray-600">Compare current project state against a saved baseline.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border-gray-300 text-sm"
            value={selectedBaselineId}
            onChange={(e) => setSelectedBaselineId(e.target.value)}
          >
            <option value="">Select baseline…</option>
            {baselines.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({new Date(b.created_at).toLocaleDateString()})
              </option>
            ))}
          </select>
          {selectedBaseline && (
            <button
              onClick={() => handleDelete(selectedBaselineId)}
              className="text-xs text-red-600 hover:text-red-800 px-2"
              title="Delete baseline"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      {!selectedBaselineId && (
        <div className="text-sm text-gray-500 py-8 text-center">
          Select a baseline to see what's changed.
        </div>
      )}

      {loading && <div className="text-sm text-gray-600">Loading comparison…</div>}

      {comparison && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-5 gap-2">
            <div className="bg-gray-50 rounded p-2 text-center">
              <div className="text-lg font-bold text-gray-900">{comparison.summary.total_baseline}</div>
              <div className="text-xs text-gray-600">Baseline Tasks</div>
            </div>
            <div className="bg-gray-50 rounded p-2 text-center">
              <div className="text-lg font-bold text-gray-900">{comparison.summary.total_current}</div>
              <div className="text-xs text-gray-600">Current Tasks</div>
            </div>
            <div className="bg-green-50 rounded p-2 text-center">
              <div className="text-lg font-bold text-green-700">+{comparison.summary.added_count}</div>
              <div className="text-xs text-green-600">Added</div>
            </div>
            <div className="bg-red-50 rounded p-2 text-center">
              <div className="text-lg font-bold text-red-700">-{comparison.summary.removed_count}</div>
              <div className="text-xs text-red-600">Removed</div>
            </div>
            <div className="bg-yellow-50 rounded p-2 text-center">
              <div className="text-lg font-bold text-yellow-700">{comparison.summary.changed_count}</div>
              <div className="text-xs text-yellow-600">Changed</div>
            </div>
          </div>

          {/* Added tasks */}
          {comparison.added.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-green-700 mb-2">Added Tasks</h3>
              <div className="space-y-1">
                {comparison.added.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm bg-green-50 rounded px-2 py-1">
                    <span className="text-green-600 font-bold">+</span>
                    <span className="font-medium">{t.name}</span>
                    {t.status && <span className="text-xs text-gray-500">({t.status})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Removed tasks */}
          {comparison.removed.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-red-700 mb-2">Removed Tasks</h3>
              <div className="space-y-1">
                {comparison.removed.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm bg-red-50 rounded px-2 py-1">
                    <span className="text-red-600 font-bold">-</span>
                    <span className="font-medium line-through">{t.name}</span>
                    {t.status && <span className="text-xs text-gray-500">({t.status})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Changed tasks */}
          {comparison.changed.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-yellow-700 mb-2">Changed Tasks</h3>
              <div className="space-y-2">
                {comparison.changed.map((item) => (
                  <div key={item.task.id} className="bg-yellow-50 rounded px-2 py-1.5">
                    <div className="text-sm font-medium">{item.task.name}</div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {item.changes.map((c, idx) => (
                        <span key={idx} className="text-xs bg-white rounded px-1.5 py-0.5 border border-yellow-200">
                          {c.field}: <span className="text-gray-500">{c.from || '—'}</span> → <span className="font-medium">{c.to || '—'}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {comparison.added.length === 0 && comparison.removed.length === 0 && comparison.changed.length === 0 && (
            <div className="text-sm text-gray-500 py-4 text-center">No changes since this baseline.</div>
          )}
        </div>
      )}
    </div>
  )
}
