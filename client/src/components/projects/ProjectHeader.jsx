import { useState } from 'react'
import PhaseTimeline from './PhaseTimeline'

export default function ProjectHeader({ project, phases = [], users = [], members = [], onStatusChange, onSaveAsTemplate, onSaveBaseline, onPhasesChanged }) {
  const [showBaselineForm, setShowBaselineForm] = useState(false)
  const [baselineName, setBaselineName] = useState('')

  const handleSaveBaseline = () => {
    if (!baselineName.trim()) return
    onSaveBaseline?.(baselineName.trim())
    setBaselineName('')
    setShowBaselineForm(false)
  }

  const isArchived = project?.status === 'archived'
  const isActive = project?.status === 'active' || !project?.status
  const isTemplate = project?.is_template

  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{project?.name}</h1>
          {isTemplate && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
              Template
            </span>
          )}
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              isArchived
                ? 'bg-yellow-100 text-yellow-800'
                : isActive
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-800'
            }`}
          >
            {project?.status || 'active'}
          </span>
        </div>
        <p className="text-sm text-gray-600 mt-1">{project?.description || 'No description'}</p>
        <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
          <span>ID: {project?.id?.slice(0, 8)}…</span>
          <span>Created: {new Date(project?.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          {!isTemplate && (
            <button
              onClick={() => onSaveAsTemplate?.()}
              className="px-3 py-2 text-sm rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
              title="Save this project as a reusable template"
            >
              Save as Template
            </button>
          )}
          {!isTemplate && (
            <button
              onClick={() => setShowBaselineForm(!showBaselineForm)}
              className="px-3 py-2 text-sm rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
              title="Save current project state as a baseline"
            >
              Save Baseline
            </button>
          )}
          {project?.status !== 'deleted' && (
            <>
              {isArchived ? (
                <button
                  onClick={() => onStatusChange?.('active')}
                  className="px-3 py-2 text-sm rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                >
                  Activate
                </button>
              ) : (
                <button
                  onClick={() => onStatusChange?.('archived')}
                  className="px-3 py-2 text-sm rounded-md bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100"
                >
                  Archive
                </button>
              )}
            </>
          )}
        </div>
        {showBaselineForm && (
          <div className="flex items-center gap-2 mt-1">
            <input
              className="w-48 rounded-md border-gray-300 text-sm"
              placeholder="Baseline name (e.g., Week 1)"
              value={baselineName}
              onChange={(e) => setBaselineName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveBaseline() }}
            />
            <button
              onClick={handleSaveBaseline}
              disabled={!baselineName.trim()}
              className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => { setShowBaselineForm(false); setBaselineName('') }}
              className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <PhaseTimeline
        projectId={project?.id}
        phases={phases}
        users={users}
        members={members}
        onPhasesChanged={onPhasesChanged}
      />
    </div>
  )
}
