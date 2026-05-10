import { useState } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'

const SPRINT_STATUS_OPTIONS = ['planning', 'active', 'closed']

export default function SprintBoard({ projectId, sprints = [], backlogTasks = [], columns = [], onReload }) {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [showCreate, setShowCreate] = useState(false)
  const [sprintForm, setSprintForm] = useState({ name: '', goal: '', start_date: '', end_date: '' })
  const [selectedSprintId, setSelectedSprintId] = useState('')
  const [draggingTask, setDraggingTask] = useState(null)

  const activeSprint = sprints.find((s) => s.status === 'active')
  const selectedSprint = sprints.find((s) => s.id === selectedSprintId) || activeSprint || sprints[0]

  const handleCreateSprint = async () => {
    if (!sprintForm.name.trim()) return
    try {
      await axios.post(`/api/projects/${projectId}/sprints`, sprintForm, headers)
      setShowCreate(false)
      setSprintForm({ name: '', goal: '', start_date: '', end_date: '' })
      onReload?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create sprint')
    }
  }

  const handleStatusChange = async (sprintId, status) => {
    try {
      await axios.put(`/api/projects/${projectId}/sprints/${sprintId}`, { status }, headers)
      onReload?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update sprint')
    }
  }

  const handleAddToSprint = async (taskId, sprintId, storyPoints = null) => {
    try {
      await axios.post(`/api/projects/${projectId}/sprints/${sprintId}/tasks`, {
        task_id: taskId,
        story_points: storyPoints,
      }, headers)
      onReload?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add task to sprint')
    }
  }

  const handleRemoveFromSprint = async (taskId, sprintId) => {
    try {
      await axios.delete(`/api/projects/${projectId}/sprints/${sprintId}/tasks/${taskId}`, headers)
      onReload?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove task from sprint')
    }
  }

  const onDragStart = (task) => setDraggingTask(task)
  const onDragOver = (e) => e.preventDefault()
  const onDrop = async (sprintId) => {
    if (!draggingTask) return
    await handleAddToSprint(draggingTask.id, sprintId)
    setDraggingTask(null)
  }

  const statusCol = columns.find((c) => c.key === 'status' || c.type === 'dropdown')
  const statusOptions = statusCol?.config?.options || []

  return (
    <div className="space-y-6">
      {/* Sprint selector + create */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border-gray-300 text-sm"
            value={selectedSprint?.id || ''}
            onChange={(e) => setSelectedSprintId(e.target.value)}
          >
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
            ))}
          </select>
          {selectedSprint && (
            <select
              className="rounded-md border-gray-300 text-sm text-xs"
              value={selectedSprint.status}
              onChange={(e) => handleStatusChange(selectedSprint.id, e.target.value)}
            >
              {SPRINT_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-2 text-sm rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
        >
          + Sprint
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-50 border rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              className="rounded-md border-gray-300 text-sm"
              placeholder="Sprint name"
              value={sprintForm.name}
              onChange={(e) => setSprintForm({ ...sprintForm, name: e.target.value })}
            />
            <input
              className="rounded-md border-gray-300 text-sm"
              placeholder="Goal"
              value={sprintForm.goal}
              onChange={(e) => setSprintForm({ ...sprintForm, goal: e.target.value })}
            />
            <input
              type="date"
              className="rounded-md border-gray-300 text-sm"
              value={sprintForm.start_date}
              onChange={(e) => setSprintForm({ ...sprintForm, start_date: e.target.value })}
            />
            <input
              type="date"
              className="rounded-md border-gray-300 text-sm"
              value={sprintForm.end_date}
              onChange={(e) => setSprintForm({ ...sprintForm, end_date: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreateSprint}
              className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Create Sprint
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-sm rounded-md text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectedSprint && (
        <div className="bg-white border rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900">{selectedSprint.name}</h3>
              {selectedSprint.goal && <p className="text-xs text-gray-600">{selectedSprint.goal}</p>}
              <p className="text-xs text-gray-500">
                {selectedSprint.start_date && new Date(selectedSprint.start_date).toLocaleDateString()} — {selectedSprint.end_date && new Date(selectedSprint.end_date).toLocaleDateString()}
              </p>
            </div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              selectedSprint.status === 'active' ? 'bg-green-100 text-green-700' :
              selectedSprint.status === 'closed' ? 'bg-gray-100 text-gray-700' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {selectedSprint.status}
            </span>
          </div>

          <div className="space-y-2">
            {selectedSprint.tasks?.length === 0 ? (
              <p className="text-sm text-gray-500">No tasks in this sprint. Drag tasks from the backlog.</p>
            ) : (
              selectedSprint.tasks?.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{t.task_id || '—'}</span>
                    <span className="font-medium text-gray-900">{t.task_name || t.name}</span>
                    {t.story_points !== null && t.story_points !== undefined && (
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded px-1.5 py-0.5">{t.story_points} pts</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveFromSprint(t.task_id || t.id, selectedSprint.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Backlog */}
      <div className="bg-white border rounded-lg shadow-sm p-4">
        <h3 className="text-base font-semibold text-gray-900 mb-3">Backlog</h3>
        <p className="text-xs text-gray-600 mb-2">Drag tasks to a sprint or click Add.</p>
        <div className="space-y-1">
          {backlogTasks.length === 0 ? (
            <p className="text-sm text-gray-500">Backlog is empty.</p>
          ) : (
            backlogTasks.map((task) => (
              <div
                key={task.id}
                draggable
                onDragStart={() => onDragStart(task)}
                className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm cursor-move hover:bg-gray-100"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{task.task_id || '—'}</span>
                  <span className="font-medium text-gray-900">{task.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  {sprints.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleAddToSprint(task.id, s.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                      title={`Add to ${s.name}`}
                    >
                      + {s.name.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
