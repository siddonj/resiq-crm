import { useMemo, useState } from 'react'

const INPUT_BY_TYPE = {
  date: 'date',
  number: 'number',
  currency: 'number',
  checkbox: 'checkbox',
}

export default function GridView({ columns = [], tasks = [], filterText = '', onAddTask, onUpdateTask, onTaskClick, onBulkDelete, onBulkUpdate }) {
  const [newTaskName, setNewTaskName] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkStatusTarget, setBulkStatusTarget] = useState('')

  const orderedColumns = useMemo(() => [...columns].sort((a, b) => a.position - b.position), [columns])

  // Find a dropdown/status column for bulk "move to" options
  const statusCol = useMemo(() => columns.find((c) => c.type === 'dropdown' || c.type === 'status'), [columns])
  const statusOptions = statusCol?.config?.options || []

  // Client-side filtering
  const lowerFilter = filterText.toLowerCase()
  const filteredTasks = useMemo(() => {
    if (!lowerFilter) return tasks
    return tasks.filter((t) =>
      (t.name || '').toLowerCase().includes(lowerFilter) ||
      (t.task_id || '').toLowerCase().includes(lowerFilter)
    )
  }, [tasks, lowerFilter])

  const allFilteredIds = useMemo(() => new Set(filteredTasks.map((t) => t.id)), [filteredTasks])
  const allFilteredSelected = filteredTasks.length > 0 && filteredTasks.every((t) => selectedIds.has(t.id))
  const someFilteredSelected = filteredTasks.some((t) => selectedIds.has(t.id))

  const toggleSelectAll = () => {
    const next = new Set(selectedIds)
    if (allFilteredSelected) {
      allFilteredIds.forEach((id) => next.delete(id))
    } else {
      allFilteredIds.forEach((id) => next.add(id))
    }
    setSelectedIds(next)
  }

  const toggleSelect = (taskId) => {
    const next = new Set(selectedIds)
    if (next.has(taskId)) next.delete(taskId)
    else next.add(taskId)
    setSelectedIds(next)
  }

  const selectedArray = [...selectedIds]

  const handleBulkDelete = () => {
    if (selectedArray.length === 0) return
    if (!confirm(`Delete ${selectedArray.length} task(s)?`)) return
    onBulkDelete?.(selectedArray)
    setSelectedIds(new Set())
  }

  const handleBulkMove = () => {
    if (!bulkStatusTarget || selectedArray.length === 0 || !statusCol) return
    onBulkUpdate?.(selectedArray, { values: { [statusCol.key]: bulkStatusTarget } })
    setSelectedIds(new Set())
    setBulkStatusTarget('')
  }

  const handleAdd = () => {
    if (!newTaskName.trim()) return
    onAddTask({ name: newTaskName.trim(), values: {} })
    setNewTaskName('')
  }

  const handleValueChange = (task, column, rawValue) => {
    const nextValues = { ...(task.values || {}) }
    if (column.type === 'checkbox') {
      nextValues[column.key] = !!rawValue
    } else if (column.type === 'number' || column.type === 'currency') {
      nextValues[column.key] = rawValue === '' ? null : Number(rawValue)
    } else {
      nextValues[column.key] = rawValue
    }
    onUpdateTask(task.id, { values: nextValues })
  }

  const renderCellInput = (task, column) => {
    const value = task.values?.[column.key]
    if (column.type === 'dropdown' && Array.isArray(column.config?.options)) {
      return (
        <select
          className="w-full border-none bg-transparent focus:ring-0 text-sm"
          value={value ?? ''}
          onChange={(e) => handleValueChange(task, column, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="">—</option>
          {column.config.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )
    }
    if (column.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          className="h-4 w-4 text-indigo-600"
          checked={!!value}
          onChange={(e) => handleValueChange(task, column, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
        />
      )
    }
    const inputType = INPUT_BY_TYPE[column.type] || 'text'
    return (
      <input
        type={inputType}
        className="w-full border-none bg-transparent focus:ring-0 text-sm"
        value={value ?? ''}
        onChange={(e) => handleValueChange(task, column, e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />
    )
  }

  const extraCols = selectedArray.length > 0 ? 1 : 0

  return (
    <div className="bg-white border rounded-lg shadow-sm">
      {/* Header */}
      <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Grid</h2>
          <p className="text-sm text-gray-600">
            {filterText ? `Filtered: ${filteredTasks.length} of ${tasks.length}` : `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-52 rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
            placeholder="Add task name"
            value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { handleAdd(); e.preventDefault() } }}
          />
          <button
            onClick={handleAdd}
            className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Add Task
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedArray.length > 0 && (
        <div className="px-4 py-2 bg-indigo-50 border-t border-b border-indigo-200 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-indigo-800">{selectedArray.length} selected</span>
          <button
            onClick={handleBulkDelete}
            className="px-3 py-1 text-xs font-medium rounded border border-red-300 text-red-700 hover:bg-red-50"
          >
            Delete Selected
          </button>
          {statusCol && statusOptions.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-600">Move to:</span>
              <select
                className="text-xs rounded border-gray-300 py-0.5"
                value={bulkStatusTarget}
                onChange={(e) => setBulkStatusTarget(e.target.value)}
              >
                <option value="">—</option>
                {statusOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <button
                onClick={handleBulkMove}
                disabled={!bulkStatusTarget}
                className="px-2 py-0.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          )}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1 text-xs text-gray-600 hover:text-gray-900"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto">
        <table className="min-w-full border-t text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-8 px-2 py-2 text-center border-b">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 text-indigo-600"
                  checked={allFilteredSelected}
                  ref={(el) => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected }}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">Task</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">Task ID</th>
              {orderedColumns.map((col) => (
                <th key={col.id} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredTasks.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-sm text-gray-600" colSpan={3 + orderedColumns.length}>
                  {filterText ? 'No tasks match your search.' : 'No tasks yet.'}
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => (
                <tr
                  key={task.id}
                  className={`odd:bg-white even:bg-gray-50 cursor-pointer hover:bg-indigo-50/50 transition-colors ${selectedIds.has(task.id) ? 'bg-indigo-50' : ''}`}
                  onClick={() => onTaskClick?.(task)}
                >
                  <td className="px-2 py-2 align-top border-b text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 text-indigo-600"
                      checked={selectedIds.has(task.id)}
                      onChange={() => toggleSelect(task.id)}
                    />
                  </td>
                  <td className="px-3 py-2 align-top border-b">
                    <input
                      className="w-full border-none bg-transparent focus:ring-0 text-sm font-medium text-gray-900"
                      value={task.name}
                      onChange={(e) => { e.stopPropagation(); onUpdateTask(task.id, { name: e.target.value }) }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {task.description ? (
                      <div className="text-xs text-gray-500 mt-1">{task.description}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top border-b text-gray-700">{task.task_id || '—'}</td>
                  {orderedColumns.map((col) => (
                    <td key={col.id} className="px-3 py-2 align-top border-b">
                      {renderCellInput(task, col)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
