import { useMemo, useState } from 'react'

export default function KanbanView({ columns = [], tasks = [], filterText = '', onAddTask, onUpdateTask, onTaskClick }) {
  // Filter tasks
  const lowerFilter = filterText.toLowerCase()
  const filteredTasks = lowerFilter
    ? tasks.filter((t) => (t.name || '').toLowerCase().includes(lowerFilter) || (t.task_id || '').toLowerCase().includes(lowerFilter))
    : tasks

  // Use first dropdown/status column as kanban grouping, or create default "Status" lanes
  const statusColumn = useMemo(() => {
    const dropdown = columns.find((c) => c.type === 'dropdown' || c.type === 'status')
    if (dropdown) return dropdown
    return { key: '_status', name: 'Status', config: { options: ['Backlog', 'To Do', 'In Progress', 'Done'] } }
  }, [columns])

  const laneOptions = statusColumn.config?.options || ['Backlog', 'To Do', 'In Progress', 'Done']

  const lanes = useMemo(() => {
    const map = {}
    laneOptions.forEach((opt) => { map[opt] = [] })
    filteredTasks.forEach((t) => {
      const val = t.values?.[statusColumn.key]
      if (val && map[val]) {
        map[val].push(t)
      } else {
        if (map['Backlog']) map['Backlog'].push(t)
        else map[laneOptions[0]].push(t)
      }
    })
    return Object.entries(map).map(([name, items]) => ({ name, items }))
  }, [tasks, statusColumn.key, laneOptions])

  const [newTaskInputs, setNewTaskInputs] = useState({})
  const [dragOverLane, setDragOverLane] = useState(null)

  const handleDragStart = (e, task) => {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, laneName) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverLane(laneName)
  }

  const handleDragLeave = () => { setDragOverLane(null) }

  const handleDrop = (e, laneName) => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('text/plain')
    setDragOverLane(null)
    if (statusColumn.key === '_status') return
    onUpdateTask(taskId, { values: { [statusColumn.key]: laneName } })
  }

  const handleAdd = (laneName) => {
    const name = (newTaskInputs[laneName] || '').trim()
    if (!name) return
    const values = statusColumn.key !== '_status' ? { [statusColumn.key]: laneName } : {}
    onAddTask({ name, values })
    setNewTaskInputs((p) => ({ ...p, [laneName]: '' }))
  }

  return (
    <div className="bg-white border rounded-lg shadow-sm p-4">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Kanban</h2>
        <p className="text-sm text-gray-600">
            {filterText ? `Filtered: ${filteredTasks.length} of ${tasks.length}` : `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`} · Grouped by: {statusColumn.name}</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ minHeight: '320px' }}>
        {lanes.map((lane) => (
          <div
            key={lane.name}
            className={`flex-shrink-0 w-60 rounded-lg border-2 transition-colors ${
              dragOverLane === lane.name ? 'border-indigo-400 bg-indigo-50/30' : 'border-gray-200 bg-gray-50'
            }`}
            onDragOver={(e) => handleDragOver(e, lane.name)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, lane.name)}
          >
            <div className="px-3 py-2 border-b bg-white rounded-t-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">{lane.name}</h3>
                <span className="text-xs text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{lane.items.length}</span>
              </div>
            </div>
            <div className="p-2 space-y-2 min-h-[60px]">
              {lane.items.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task)}
                  onClick={() => onTaskClick?.(task)}
                  className="bg-white border rounded-md p-2 shadow-sm cursor-pointer hover:border-indigo-400 hover:shadow transition-all"
                >
                  <div className="text-sm font-medium text-gray-900 truncate">{task.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{task.task_id || '—'}</div>
                  {task.description && (
                    <div className="text-xs text-gray-600 mt-1 line-clamp-2">{task.description}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="px-2 pb-2">
              <input
                className="w-full rounded-md border-gray-200 text-xs p-1.5 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="+ Add task"
                value={newTaskInputs[lane.name] || ''}
                onChange={(e) => setNewTaskInputs((p) => ({ ...p, [lane.name]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { handleAdd(lane.name); e.preventDefault() } }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
