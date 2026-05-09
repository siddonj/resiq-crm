export default function ProjectHeader({ project, onStatusChange }) {
  const isArchived = project?.status === 'archived'
  const isActive = project?.status === 'active' || !project?.status

  const handleArchive = () => onStatusChange?.('archived')
  const handleRestore = () => onStatusChange?.('active')

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{project?.name}</h1>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            isArchived ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
          }`}>
            {project?.status || 'active'}
          </span>
        </div>
        <p className="text-sm text-gray-600 mt-1">{project?.description || 'No description'}</p>
        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
          <span>ID: {project?.id?.slice(0, 8)}…</span>
          <span>Created: {new Date(project?.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isActive && (
          <button
            onClick={handleArchive}
            className="px-3 py-2 text-sm rounded-md border border-yellow-300 text-yellow-700 hover:bg-yellow-50"
          >
            Archive
          </button>
        )}
        {isArchived && (
          <button
            onClick={handleRestore}
            className="px-3 py-2 text-sm rounded-md border border-green-300 text-green-700 hover:bg-green-50"
          >
            Restore
          </button>
        )}
      </div>
    </div>
  )
}
