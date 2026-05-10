export default function ProjectHeader({ project, onStatusChange, onSaveAsTemplate }) {
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
      <div className="flex items-center gap-2 flex-shrink-0">
        {!isTemplate && (
          <button
            onClick={() => onSaveAsTemplate?.()}
            className="px-3 py-2 text-sm rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
            title="Save this project as a reusable template"
          >
            Save as Template
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
    </div>
  )
}
