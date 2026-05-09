import { useEffect, useState } from 'react'
import axios from 'axios'

export default function SavedViewsDropdown({ projectId, token, currentView, onApplyView }) {
  const headers = { headers: { Authorization: `Bearer ${token}` } }
  const base = `/api/projects/${projectId}/views`

  const [views, setViews] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [error, setError] = useState('')

  const loadViews = async () => {
    try {
      const { data } = await axios.get(base, headers)
      setViews(data)
    } catch { /* non-critical */ }
  }

  useEffect(() => { if (token && projectId) loadViews() }, [token, projectId])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showDropdown && !e.target.closest('.saved-views-dropdown')) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showDropdown])

  const handleSave = async () => {
    if (!saveName.trim()) return
    try {
      await axios.post(base, { name: saveName.trim(), type: currentView, config: {} }, headers)
      setSaveName('')
      setShowSave(false)
      loadViews()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save view')
    }
  }

  const handleDelete = async (e, viewId) => {
    e.stopPropagation()
    try {
      await axios.delete(`${base}/${viewId}`, headers)
      loadViews()
    } catch { setError('Failed to delete view') }
  }

  const handleApply = (view) => {
    onApplyView?.(view.type)
    setShowDropdown(false)
  }

  const viewsOfType = views.filter((v) => v.type === currentView)
  const otherViews = views.filter((v) => v.type !== currentView)

  return (
    <div className="saved-views-dropdown relative inline-block">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
          </svg>
          Views {views.length > 0 && `(${views.length})`}
        </button>
        <button
          onClick={() => { setShowSave(!showSave); setShowDropdown(false) }}
          className="px-2 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          title="Save current view"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {error && <div className="absolute top-full mt-1 text-xs text-red-600 whitespace-nowrap">{error}</div>}

      {/* Save dialog */}
      {showSave && (
        <div className="absolute top-full mt-1 right-0 bg-white border rounded-lg shadow-lg p-3 z-40 w-56">
          <input
            className="w-full rounded-md border-gray-300 text-sm mb-2 focus:ring-indigo-500"
            placeholder="View name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowSave(false)} className="px-3 py-1 text-xs text-gray-600 hover:text-gray-900">Cancel</button>
            <button onClick={handleSave} className="px-3 py-1 text-xs font-medium rounded text-white bg-indigo-600 hover:bg-indigo-700">Save</button>
          </div>
        </div>
      )}

      {/* Views dropdown */}
      {showDropdown && (
        <div className="absolute top-full mt-1 right-0 bg-white border rounded-lg shadow-lg z-40 w-56 max-h-64 overflow-y-auto">
          {views.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">No saved views. Save your first view with the + button.</div>
          ) : (
            <>
              {viewsOfType.length > 0 && (
                <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  {currentView} views
                </div>
              )}
              {viewsOfType.map((v) => (
                <button
                  key={v.id}
                  onClick={() => handleApply(v)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 flex items-center justify-between group"
                >
                  <span className="truncate">{v.name}</span>
                  <span
                    onClick={(e) => handleDelete(e, v.id)}
                    className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                  >
                    &times;
                  </span>
                </button>
              ))}
              {otherViews.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-t mt-1">
                    Other views
                  </div>
                  {otherViews.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => handleApply(v)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 flex items-center justify-between group"
                    >
                      <span>{v.name}</span>
                      <span className="text-[10px] text-gray-400">{v.type}</span>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
