import { useMemo, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'

const INPUT_BY_TYPE = {
  date: 'date',
  number: 'number',
  currency: 'number',
  checkbox: 'checkbox',
}

export default function GridView({ columns = [], tasks = [], types = [], workflows = [], relations = [], filterText = '', onAddTask, onUpdateTask, onTaskClick, onBulkDelete, onBulkUpdate, onReload }) {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }
  const projectId = tasks[0]?.project_id

  const [newTaskName, setNewTaskName] = useState('')
  const [newTaskTypeId, setNewTaskTypeId] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkStatusTarget, setBulkStatusTarget] = useState('')
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [subtaskInputs, setSubtaskInputs] = useState({})
  const [quickLogTaskId, setQuickLogTaskId] = useState(null)
  const [quickLogHours, setQuickLogHours] = useState('')

  const orderedColumns = useMemo(() => [...columns].sort((a, b) => a.position - b.position), [columns])

  const statusCol = useMemo(() => columns.find((c) => c.type === 'dropdown' || c.type === 'status'), [columns])
  const statusOptions = statusCol?.config?.options || []
  const progressCol = useMemo(() => columns.find((c) => c.type === 'progress' || c.key === 'progress'), [columns])

  // Build workflow map: currentStatus -> [allowedNextStatuses]
  const workflowMap = useMemo(() => {
    const map = {}
    if (!Array.isArray(workflows) || workflows.length === 0) return map
    for (const w of workflows) {
      const from = w.from_status
      const to = w.to_status
      if (!map[from]) map[from] = []
      if (!map[from].includes(to)) map[from].push(to)
    }
    return map
  }, [workflows])

  const getValidStatuses = (currentStatus) => {
    if (!currentStatus) return statusOptions
    const allowed = workflowMap[currentStatus]
    if (!allowed || allowed.length === 0) return statusOptions
    // Always allow keeping current status
    const result = [currentStatus, ...allowed.filter((s) => s !== currentStatus)]
    return result
  }

  // Build task map and visibility
  const taskMap = useMemo(() => {
    const map = new Map()
    tasks.forEach((t) => map.set(t.id, t))
    return map
  }, [tasks])

  // Build relation map per task
  const relationMap = useMemo(() => {
    const map = new Map()
    for (const r of relations) {
      if (!map.has(r.from_task_id)) map.set(r.from_task_id, [])
      if (!map.has(r.to_task_id)) map.set(r.to_task_id, [])
      map.get(r.from_task_id).push({ ...r, direction: 'outgoing' })
      map.get(r.to_task_id).push({ ...r, direction: 'incoming' })
    }
    return map
  }, [relations])

  const RELATION_ICONS = {
    precedes: '→',
    follows: '←',
    blocks: '⊸',
    blocked_by: '⊷',
    duplicates: '⩗',
    relates_to: '↔',
    part_of: '⊂',
  }

  const RELATION_LABELS = {
    precedes: 'precedes',
    follows: 'follows',
    blocks: 'blocks',
    blocked_by: 'blocked by',
    duplicates: 'duplicates',
    relates_to: 'relates to',
    part_of: 'part of',
  }

  // Auto-expand all initially
  useMemo(() => {
    const allParentIds = new Set(tasks.filter((t) => t.subtask_count > 0).map((t) => t.id))
    setExpandedIds(allParentIds)
  }, [tasks])

  // Determine visible tasks based on expand/collapse
  const visibleTasks = useMemo(() => {
    const result = []
    for (const task of tasks) {
      if (task.depth > 0) {
        // Check if all ancestors are expanded
        let parent = taskMap.get(task.parent_id)
        let visible = true
        while (parent) {
          if (!expandedIds.has(parent.id)) {
            visible = false
            break
          }
          parent = taskMap.get(parent.parent_id)
        }
        if (visible) result.push(task)
      } else {
        result.push(task)
      }
    }
    return result
  }, [tasks, expandedIds, taskMap])

  // Client-side filtering
  const lowerFilter = filterText.toLowerCase()
  const filteredTasks = useMemo(() => {
    if (!lowerFilter) return visibleTasks
    return visibleTasks.filter((t) =>
      (t.name || '').toLowerCase().includes(lowerFilter) ||
      (t.task_id || '').toLowerCase().includes(lowerFilter)
    )
  }, [visibleTasks, lowerFilter])

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

  const defaultTypeId = useMemo(() => {
    const sorted = [...types].sort((a, b) => a.position - b.position)
    return sorted[0]?.id || ''
  }, [types])

  useMemo(() => {
    if (defaultTypeId && !newTaskTypeId) setNewTaskTypeId(defaultTypeId)
  }, [defaultTypeId, newTaskTypeId])

  const handleAdd = () => {
    if (!newTaskName.trim()) return
    const payload = { name: newTaskName.trim(), values: {} }
    if (newTaskTypeId) payload.type_id = newTaskTypeId
    onAddTask(payload)
    setNewTaskName('')
  }

  const handleAddSubtask = (parentId, name) => {
    if (!name.trim()) return
    const payload = { name: name.trim(), parent_id: parentId, values: {} }
    if (newTaskTypeId) payload.type_id = newTaskTypeId
    onAddTask(payload)
    setSubtaskInputs((p) => ({ ...p, [parentId]: '' }))
    setExpandedIds((prev) => new Set(prev).add(parentId))
  }

  const handleQuickLog = async (taskId) => {
    if (!quickLogHours || isNaN(quickLogHours) || Number(quickLogHours) <= 0) return
    try {
      await axios.post(`/api/projects/${projectId}/tasks/${taskId}/time-entries`, {
        hours: Number(quickLogHours),
        description: 'Quick log from grid',
      }, headers)
      setQuickLogTaskId(null)
      setQuickLogHours('')
      onReload?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to log time')
    }
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

  const toggleExpand = (taskId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const handleIndent = async (taskId) => {
    if (!projectId) return
    try {
      await axios.post(`/api/projects/${projectId}/tasks/${taskId}/indent`, {}, headers)
      onReload?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to indent')
    }
  }

  const handleOutdent = async (taskId) => {
    if (!projectId) return
    try {
      await axios.post(`/api/projects/${projectId}/tasks/${taskId}/outdent`, {}, headers)
      onReload?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to outdent')
    }
  }

  // Compute rolled-up progress for parent rows
  const rolledUpProgress = useMemo(() => {
    if (!progressCol) return new Map()
    const map = new Map()
    // Process in reverse to calculate from leaves up
    for (let i = tasks.length - 1; i >= 0; i--) {
      const t = tasks[i]
      if (t.subtask_count > 0) {
        const children = tasks.filter((c) => c.parent_id === t.id)
        const total = children.reduce((sum, c) => {
          const val = map.get(c.id) ?? c.values?.[progressCol.key]
          return sum + (Number(val) || 0)
        }, 0)
        const avg = children.length ? Math.round(total / children.length) : 0
        map.set(t.id, avg)
      }
    }
    return map
  }, [tasks, progressCol])

  const renderCellInput = (task, column) => {
    const value = task.values?.[column.key]

    // Show rolled-up progress for parent rows
    if (column.type === 'progress' && task.subtask_count > 0) {
      const rolled = rolledUpProgress.get(task.id) ?? value
      return (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${rolled || 0}%` }} />
          </div>
          <span className="text-xs text-gray-600 w-8 text-right">{rolled || 0}%</span>
        </div>
      )
    }

    if (column.type === 'dropdown' && Array.isArray(column.config?.options)) {
      // Workflow-aware status dropdown
      const isStatusCol = statusCol && column.id === statusCol.id
      const options = isStatusCol ? getValidStatuses(value) : column.config.options
      return (
        <select
          className="w-full border-none bg-transparent focus:ring-0 text-sm"
          value={value ?? ''}
          onChange={(e) => handleValueChange(task, column, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="">—</option>
          {options.map((opt) => (
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
    if (column.type === 'progress') {
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            className="w-16 border-none bg-transparent focus:ring-0 text-sm"
            value={value ?? ''}
            onChange={(e) => handleValueChange(task, column, e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="text-xs text-gray-500">%</span>
        </div>
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
          {types.length > 0 && (
            <select
              className="rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              value={newTaskTypeId}
              onChange={(e) => setNewTaskTypeId(e.target.value)}
              title="Task type"
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.icon || '●'} {t.name}</option>
              ))}
            </select>
          )}
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
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">Type</th>
              {orderedColumns.map((col) => (
                <th key={col.id} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b">
                  {col.name}
                </th>
              ))}
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-sm text-gray-600" colSpan={5 + orderedColumns.length}>
                  {filterText ? 'No tasks match your search.' : 'No tasks yet.'}
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => (
                <tr
                  key={task.id}
                  className={`odd:bg-white even:bg-gray-50 cursor-pointer hover:bg-indigo-50/50 transition-colors ${selectedIds.has(task.id) ? 'bg-indigo-50' : ''} ${task.depth > 0 ? '' : ''}`}
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
                    <div className="flex items-center gap-1" style={{ paddingLeft: `${task.depth * 24}px` }}>
                      {task.subtask_count > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleExpand(task.id) }}
                          className="text-gray-400 hover:text-gray-700 text-xs w-4"
                        >
                          {expandedIds.has(task.id) ? '▼' : '▶'}
                        </button>
                      )}
                      {task.subtask_count === 0 && <span className="w-4" />}
                      <input
                        className="flex-1 border-none bg-transparent focus:ring-0 text-sm font-medium text-gray-900"
                        value={task.name}
                        onChange={(e) => { e.stopPropagation(); onUpdateTask(task.id, { name: e.target.value }) }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      {task.estimated_hours > 0 && (
                        <div className="flex items-center gap-1 ml-1" title={`${Number(task.spent_hours || 0).toFixed(1)}h / ${Number(task.estimated_hours).toFixed(1)}h`}>
                          <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${(task.spent_hours || 0) > task.estimated_hours ? 'bg-red-500' : 'bg-indigo-500'}`}
                              style={{ width: `${Math.min(100, Math.round(((task.spent_hours || 0) / task.estimated_hours) * 100))}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {task.subtask_count > 0 && (
                        <span className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5 ml-1">
                          {task.subtask_count}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const rels = relationMap.get(task.id) || []
                      if (rels.length === 0) return null
                      return (
                        <div className="flex flex-wrap gap-1 mt-1" style={{ paddingLeft: `${(task.depth * 24) + 20}px` }}>
                          {rels.map((rel, idx) => {
                            const otherId = rel.direction === 'outgoing' ? rel.to_task_id : rel.from_task_id
                            const otherTask = taskMap.get(otherId)
                            const label = `${RELATION_ICONS[rel.relation_type] || '•'} ${RELATION_LABELS[rel.relation_type] || rel.relation_type} ${otherTask?.task_id || otherTask?.name?.slice(0, 12) || '…'}`
                            return (
                              <span
                                key={`${rel.id}-${idx}`}
                                className="text-[10px] bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5 border border-indigo-100"
                                title={label}
                              >
                                {label}
                              </span>
                            )
                          })}
                        </div>
                      )
                    })()}
                    {task.subtask_count > 0 && expandedIds.has(task.id) && (
                      <div className="mt-1 flex items-center gap-2" style={{ paddingLeft: `${(task.depth + 1) * 24}px` }}>
                        <input
                          className="flex-1 rounded-md border-gray-200 text-xs p-1 focus:ring-indigo-500 focus:border-indigo-500"
                          placeholder="+ Add subtask"
                          value={subtaskInputs[task.id] || ''}
                          onChange={(e) => setSubtaskInputs((p) => ({ ...p, [task.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { handleAddSubtask(task.id, subtaskInputs[task.id] || ''); e.preventDefault() } }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAddSubtask(task.id, subtaskInputs[task.id] || '') }}
                          className="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100"
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top border-b text-gray-700">{task.task_id || '—'}</td>
                  <td className="px-3 py-2 align-top border-b">
                    {task.type_name ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5"
                        style={{ backgroundColor: task.type_color + '22', color: task.type_color }}
                        title={task.type_name}
                      >
                        {task.type_icon || '●'} {task.type_name}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  {orderedColumns.map((col) => (
                    <td key={col.id} className="px-3 py-2 align-top border-b">
                      {renderCellInput(task, col)}
                    </td>
                  ))}
                  <td className="px-3 py-2 align-top border-b" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {quickLogTaskId === task.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.25"
                            min="0.25"
                            placeholder="h"
                            className="w-14 text-xs rounded border-gray-300 py-0.5"
                            value={quickLogHours}
                            onChange={(e) => setQuickLogHours(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { handleQuickLog(task.id); e.preventDefault() } }}
                            autoFocus
                          />
                          <button
                            onClick={() => handleQuickLog(task.id)}
                            className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => { setQuickLogTaskId(null); setQuickLogHours('') }}
                            className="text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-600"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setQuickLogTaskId(task.id); setQuickLogHours('') }}
                          title="Quick log time"
                          className="text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-600"
                        >
                          🕐
                        </button>
                      )}
                      <button
                        onClick={() => handleIndent(task.id)}
                        title="Indent (make subtask)"
                        className="text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-600"
                        disabled={!!task.parent_id}
                      >
                        →
                      </button>
                      <button
                        onClick={() => handleOutdent(task.id)}
                        title="Outdent (promote)"
                        className="text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-600"
                        disabled={!task.parent_id}
                      >
                        ←
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
