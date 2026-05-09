import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import GridView from '../components/projects/GridView'
import KanbanView from '../components/projects/KanbanView'
import GanttView from '../components/projects/GanttView'
import CalendarView from '../components/projects/CalendarView'
import ColumnCustomizer from '../components/projects/ColumnCustomizer'
import TaskDetail from '../components/projects/TaskDetail'
import ProjectHeader from '../components/projects/ProjectHeader'
import MembersPanel from '../components/projects/MembersPanel'
import SavedViewsDropdown from '../components/projects/SavedViewsDropdown'

export default function ProjectDetail() {
  const { projectId } = useParams()
  const { token, user } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [project, setProject] = useState(null)
  const [columns, setColumns] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('grid')
  const [selectedTask, setSelectedTask] = useState(null)
  const [users, setUsers] = useState([])
  const [members, setMembers] = useState([])
  const [teams, setTeams] = useState([])
  const [filterText, setFilterText] = useState('')

  const loadProject = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`/api/projects/${projectId}`, headers)
      setProject(data.project)
      setColumns(data.columns || [])
      setTasks(data.tasks || [])
      setMembers(data.members || [])
      setError('')
    } catch (err) {
      setError('Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token && projectId) loadProject()
    if (token) { loadUsers(); loadTeams() }
  }, [token, projectId])

  const loadUsers = async () => {
    try {
      const { data } = await axios.get('/api/users', headers)
      setUsers(data)
    } catch { /* non-critical */ }
  }

  const loadTeams = async () => {
    try {
      const { data } = await axios.get('/api/teams', headers)
      setTeams(data)
    } catch { /* non-critical */ }
  }

  const loadMembers = async () => {
    try {
      const { data } = await axios.get(`/api/projects/${projectId}/members`, headers)
      setMembers(data)
    } catch { /* non-critical */ }
  }

  const handleStatusChange = async (newStatus) => {
    try {
      const { data } = await axios.put(`/api/projects/${projectId}`, { status: newStatus }, headers)
      setProject(data)
      setError('')
    } catch (err) {
      setError('Failed to update project status')
    }
  }

  const handleBulkDelete = async (taskIds) => {
    try {
      await axios.post(`/api/projects/${projectId}/tasks/bulk-delete`, { task_ids: taskIds }, headers)
      setTasks((prev) => prev.filter((t) => !taskIds.includes(t.id)))
      setError('')
    } catch (err) {
      setError('Failed to delete tasks')
    }
  }

  const handleBulkUpdate = async (taskIds, updates) => {
    try {
      const { data } = await axios.post(`/api/projects/${projectId}/tasks/bulk-update`, { task_ids: taskIds, ...updates }, headers)
      setTasks((prev) => prev.map((t) => {
        const updated = data.tasks.find((u) => u.id === t.id)
        return updated || t
      }))
      setError('')
    } catch (err) {
      setError('Failed to update tasks')
    }
  }

  const handleAddColumn = async (column) => {
    try {
      const { data } = await axios.post(`/api/projects/${projectId}/columns`, column, headers)
      setColumns((prev) => [...prev, data].sort((a, b) => a.position - b.position))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add column')
    }
  }

  const handleDeleteColumn = async (colId) => {
    try {
      await axios.delete(`/api/projects/${projectId}/columns/${colId}`, headers)
      setColumns((prev) => prev.filter((c) => c.id !== colId))
    } catch (err) {
      setError('Failed to delete column')
    }
  }

  const handleAddTask = async (taskInput) => {
    try {
      const { data } = await axios.post(`/api/projects/${projectId}/tasks`, taskInput, headers)
      setTasks((prev) => [...prev, data].sort((a, b) => a.position - b.position))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add task')
    }
  }

  const handleUpdateTask = async (taskId, updates) => {
    try {
      const { data } = await axios.put(`/api/projects/${projectId}/tasks/${taskId}`, updates, headers)
      setTasks((prev) => prev.map((t) => (t.id === taskId ? data : t)))
    } catch (err) {
      setError('Failed to update task')
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-600">Loading project…</div>
  if (!project) return <div className="p-6 text-sm text-red-600">{error || 'Project not found'}</div>

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <ProjectHeader
        project={project}
        onStatusChange={handleStatusChange}
      />

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      <div className="mt-6 flex flex-col lg:flex-row gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 border-b pb-2 mb-4 flex-wrap">
            <div className="flex items-center gap-3">
              {[
                { key: 'grid', label: 'Grid' },
                { key: 'kanban', label: 'Kanban' },
                { key: 'gantt', label: 'Gantt' },
                { key: 'calendar', label: 'Calendar' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`px-3 py-2 text-sm rounded-md ${view === key ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <SavedViewsDropdown
              projectId={projectId}
              token={token}
              currentView={view}
              onApplyView={(v) => setView(v)}
            />
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                className="pl-8 pr-3 py-2 w-48 text-sm rounded-md border-gray-300 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Search tasks…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
              {filterText && (
                <button
                  onClick={() => setFilterText('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          {view === 'grid' && (
            <GridView
              columns={columns}
              tasks={tasks}
              filterText={filterText}
              onAddTask={handleAddTask}
              onUpdateTask={handleUpdateTask}
              onTaskClick={(task) => setSelectedTask(task)}
              onBulkDelete={handleBulkDelete}
              onBulkUpdate={handleBulkUpdate}
              onReload={loadProject}
            />
          )}
          {view === 'kanban' && (
            <KanbanView
              columns={columns}
              tasks={tasks}
              filterText={filterText}
              onAddTask={handleAddTask}
              onUpdateTask={handleUpdateTask}
              onTaskClick={(task) => setSelectedTask(task)}
            />
          )}
          {view === 'gantt' && (
            <GanttView
              columns={columns}
              tasks={tasks}
              filterText={filterText}
              onAddTask={handleAddTask}
              onUpdateTask={handleUpdateTask}
              onTaskClick={(task) => setSelectedTask(task)}
            />
          )}
          {view === 'calendar' && (
            <CalendarView
              columns={columns}
              tasks={tasks}
              filterText={filterText}
              onAddTask={handleAddTask}
              onUpdateTask={handleUpdateTask}
              onTaskClick={(task) => setSelectedTask(task)}
            />
          )}
        </div>

        <div className="w-full lg:w-80 space-y-6">
          <ColumnCustomizer
            columns={columns}
            onAddColumn={handleAddColumn}
            onDeleteColumn={handleDeleteColumn}
          />
          <MembersPanel
            projectId={projectId}
            members={members}
            users={users}
            teams={teams}
            token={token}
            currentUserId={user?.id}
            onMembersChanged={loadMembers}
          />
        </div>
      </div>

      {selectedTask && (
        <TaskDetail
          projectId={projectId}
          task={selectedTask}
          tasks={tasks}
          users={users}
          onClose={() => setSelectedTask(null)}
          onTaskUpdated={(updated) => {
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
            setSelectedTask(updated)
          }}
        />
      )}
    </div>
  )
}
