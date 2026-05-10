import { useEffect, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'subtasks', label: 'Subtasks' },
  { key: 'comments', label: 'Comments' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'assignees', label: 'Assignees' },
  { key: 'dependencies', label: 'Dependencies' },
  { key: 'relations', label: 'Relations' },
]

const RELATION_TYPES = [
  { value: 'precedes', label: 'Precedes' },
  { value: 'follows', label: 'Follows' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'blocked_by', label: 'Blocked by' },
  { value: 'duplicates', label: 'Duplicates' },
  { value: 'relates_to', label: 'Relates to' },
  { value: 'part_of', label: 'Part of' },
]

const DEPENDENCY_TYPES = [
  { value: 'finish_to_start', label: 'Finish → Start' },
  { value: 'start_to_start', label: 'Start → Start' },
  { value: 'finish_to_finish', label: 'Finish → Finish' },
  { value: 'start_to_finish', label: 'Start → Finish' },
]

const RACI_ROLES = [
  { value: 'responsible', label: 'Responsible' },
  { value: 'accountable', label: 'Accountable' },
  { value: 'consulted', label: 'Consulted' },
  { value: 'informed', label: 'Informed' },
]

export default function TaskDetail({ projectId, task, tasks = [], users = [], types = [], workflows = [], onClose, onTaskUpdated }) {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }
  const base = `/api/projects/${projectId}/tasks/${task.id}`

  const [activeTab, setActiveTab] = useState('details')
  const [error, setError] = useState('')

  // Tab state
  const [editName, setEditName] = useState(task.name || '')
  const [editDesc, setEditDesc] = useState(task.description || '')
  const [editTypeId, setEditTypeId] = useState(task.type_id || '')
  const [editEstimated, setEditEstimated] = useState(task.estimated_hours || '')
  const [editSpent, setEditSpent] = useState(task.spent_hours || '')
  const [subtaskName, setSubtaskName] = useState('')
  const [subtasks, setSubtasks] = useState([])
  const [commentText, setCommentText] = useState('')
  const [comments, setComments] = useState([])
  const [attachments, setAttachments] = useState([])
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [assigneeRole, setAssigneeRole] = useState('responsible')
  const [assignees, setAssignees] = useState([])
  const [depTaskId, setDepTaskId] = useState('')
  const [depType, setDepType] = useState('finish_to_start')
  const [deps, setDeps] = useState([])
  const [relTaskId, setRelTaskId] = useState('')
  const [relType, setRelType] = useState('relates_to')
  const [relDelay, setRelDelay] = useState('')
  const [relations, setRelations] = useState([])

  const [loadingTab, setLoadingTab] = useState({})

  const loading = (key) => !!loadingTab[key]
  const setLoading = (key, v) => setLoadingTab((p) => ({ ...p, [key]: v }))

  const loadTabData = async (tab) => {
    if (tab === 'subtasks') await loadSubtasks()
    if (tab === 'comments') await loadComments()
    if (tab === 'attachments') await loadAttachments()
    if (tab === 'assignees') await loadAssignees()
    if (tab === 'dependencies') await loadDeps()
    if (tab === 'relations') await loadRelations()
  }

  useEffect(() => { loadTabData(activeTab) }, [activeTab])

  // ── Details ──────────────────────────────────────────────────

  const handleSaveDetails = async () => {
    if (!editName.trim()) return
    try {
      const { data } = await axios.put(base, {
        name: editName.trim(),
        description: editDesc,
        type_id: editTypeId || null,
        estimated_hours: editEstimated === '' ? null : Number(editEstimated),
        spent_hours: editSpent === '' ? null : Number(editSpent),
      }, headers)
      onTaskUpdated(data)
      setError('')
    } catch (err) {
      setError('Failed to save')
    }
  }

  // ── Subtasks ─────────────────────────────────────────────────

  const loadSubtasks = async () => {
    setLoading('subtasks', true)
    try {
      const { data } = await axios.get(`${base}/subtasks`, headers)
      setSubtasks(data)
    } catch { setError('Failed to load subtasks') }
    finally { setLoading('subtasks', false) }
  }

  const handleAddSubtask = async () => {
    if (!subtaskName.trim()) return
    try {
      await axios.post(`/api/projects/${projectId}/tasks`, { name: subtaskName.trim(), parent_id: task.id }, headers)
      setSubtaskName('')
      loadSubtasks()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add subtask')
    }
  }

  // ── Comments ─────────────────────────────────────────────────

  const loadComments = async () => {
    setLoading('comments', true)
    try {
      const { data } = await axios.get(`${base}/comments`, headers)
      setComments(data)
    } catch { setError('Failed to load comments') }
    finally { setLoading('comments', false) }
  }

  const handleAddComment = async () => {
    if (!commentText.trim()) return
    try {
      await axios.post(`${base}/comments`, { content: commentText.trim() }, headers)
      setCommentText('')
      loadComments()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add comment')
    }
  }

  const handleDeleteComment = async (commentId) => {
    try {
      await axios.delete(`${base}/comments/${commentId}`, headers)
      loadComments()
    } catch { setError('Failed to delete comment') }
  }

  // ── Attachments ──────────────────────────────────────────────

  const loadAttachments = async () => {
    setLoading('attachments', true)
    try {
      const { data } = await axios.get(`${base}/attachments`, headers)
      setAttachments(data)
    } catch { setError('Failed to load attachments') }
    finally { setLoading('attachments', false) }
  }

  const handleUploadFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      await axios.post(`${base}/attachments`, formData, {
        headers: { ...headers.headers, 'Content-Type': 'multipart/form-data' },
      })
      loadAttachments()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload')
    }
  }

  const handleDeleteAttachment = async (attId) => {
    try {
      await axios.delete(`${base}/attachments/${attId}`, headers)
      loadAttachments()
    } catch { setError('Failed to delete attachment') }
  }

  // ── Assignees ────────────────────────────────────────────────

  const loadAssignees = async () => {
    setLoading('assignees', true)
    try {
      const { data } = await axios.get(`${base}/assignees`, headers)
      setAssignees(data)
    } catch { setError('Failed to load assignees') }
    finally { setLoading('assignees', false) }
  }

  const handleAddAssignee = async () => {
    if (!assigneeUserId) return
    try {
      await axios.post(`${base}/assignees`, { user_id: assigneeUserId, role: assigneeRole }, headers)
      setAssigneeUserId('')
      loadAssignees()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add assignee')
    }
  }

  const handleRemoveAssignee = async (id) => {
    try {
      await axios.delete(`${base}/assignees/${id}`, headers)
      loadAssignees()
    } catch { setError('Failed to remove assignee') }
  }

  // ── Dependencies ─────────────────────────────────────────────

  const loadDeps = async () => {
    setLoading('dependencies', true)
    try {
      const { data } = await axios.get(`${base}/dependencies`, headers)
      setDeps(data)
    } catch { setError('Failed to load dependencies') }
    finally { setLoading('dependencies', false) }
  }

  const handleAddDep = async () => {
    if (!depTaskId) return
    try {
      await axios.post(`${base}/dependencies`, { depends_on_task_id: depTaskId, type: depType }, headers)
      setDepTaskId('')
      loadDeps()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add dependency')
    }
  }

  const handleRemoveDep = async (id) => {
    try {
      await axios.delete(`${base}/dependencies/${id}`, headers)
      loadDeps()
    } catch { setError('Failed to remove dependency') }
  }

  // ── Relations ────────────────────────────────────────────────

  const loadRelations = async () => {
    setLoading('relations', true)
    try {
      const { data } = await axios.get(`${base}/relations`, headers)
      setRelations(data)
    } catch { setError('Failed to load relations') }
    finally { setLoading('relations', false) }
  }

  const handleAddRelation = async () => {
    if (!relTaskId) return
    try {
      await axios.post(`${base}/relations`, { to_task_id: relTaskId, relation_type: relType, delay_days: relDelay ? Number(relDelay) : 0 }, headers)
      setRelTaskId('')
      setRelDelay('')
      loadRelations()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add relation')
    }
  }

  const handleRemoveRelation = async (id) => {
    try {
      await axios.delete(`${base}/relations/${id}`, headers)
      loadRelations()
    } catch { setError('Failed to remove relation') }
  }

  // Filter available tasks for dependency (exclude self + already linked)
  const linkedDepIds = new Set(deps.map((d) => d.depends_on_task_id))
  const availableDepTasks = tasks.filter((t) => t.id !== task.id && !linkedDepIds.has(t.id))
  const linkedRelIds = new Set(relations.map((r) => r.to_task_id === task.id ? r.from_task_id : r.to_task_id))
  const availableRelTasks = tasks.filter((t) => t.id !== task.id && !linkedRelIds.has(t.id))

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-end z-50">
      <div className="bg-white w-full max-w-xl h-full shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
          <div className="flex items-center gap-2">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{task.task_id || '#'}</h2>
              <p className="text-xs text-gray-600">{task.name}</p>
            </div>
            {task.type_name && (
              <span
                className="inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5"
                style={{ backgroundColor: task.type_color + '22', color: task.type_color }}
              >
                {task.type_icon || '●'} {task.type_name}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-xl leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b bg-white">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-indigo-500 text-indigo-700'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b">{error}</div>
        )}

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* ── Details Tab ─────────────────────────────────── */}
          {activeTab === 'details' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Type</label>
                <select
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  value={editTypeId}
                  onChange={(e) => setEditTypeId(e.target.value)}
                >
                  <option value="">— Select type —</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>{t.icon || '●'} {t.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Estimated Hours</label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                    value={editEstimated}
                    onChange={(e) => setEditEstimated(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Spent Hours</label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                    value={editSpent}
                    onChange={(e) => setEditSpent(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  rows={4}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                />
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <p>Task ID: {task.task_id || '—'}</p>
                <p>Created: {new Date(task.created_at).toLocaleString()}</p>
                <p>Updated: {new Date(task.updated_at).toLocaleString()}</p>
              </div>
              <button
                onClick={handleSaveDetails}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Save
              </button>
            </div>
          )}

          {/* ── Subtasks Tab ────────────────────────────────── */}
          {activeTab === 'subtasks' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  placeholder="Subtask name"
                  value={subtaskName}
                  onChange={(e) => setSubtaskName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { handleAddSubtask(); e.preventDefault() } }}
                />
                <button
                  onClick={handleAddSubtask}
                  className="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Add
                </button>
              </div>
              {loading('subtasks') ? (
                <div className="text-sm text-gray-600">Loading…</div>
              ) : subtasks.length === 0 ? (
                <div className="text-sm text-gray-500">No subtasks.</div>
              ) : (
                <ul className="space-y-1">
                  {subtasks.map((s) => (
                    <li key={s.id} className="text-sm py-1 px-2 bg-gray-50 rounded flex justify-between">
                      <span>{s.name}</span>
                      <span className="text-xs text-gray-500">{s.task_id || '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── Comments Tab ────────────────────────────────── */}
          {activeTab === 'comments' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  placeholder="Add a comment"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { handleAddComment(); e.preventDefault() } }}
                />
                <button
                  onClick={handleAddComment}
                  className="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Post
                </button>
              </div>
              {loading('comments') ? (
                <div className="text-sm text-gray-600">Loading…</div>
              ) : comments.length === 0 ? (
                <div className="text-sm text-gray-500">No comments.</div>
              ) : (
                <div className="space-y-2">
                  {comments.map((c) => (
                    <div key={c.id} className="p-2 bg-gray-50 rounded">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-700">
                           {c.user_name || c.email}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{new Date(c.created_at).toLocaleString()}</span>
                          <button onClick={() => handleDeleteComment(c.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                        </div>
                      </div>
                      <p className="mt-1 text-sm text-gray-800">{c.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Attachments Tab ─────────────────────────────── */}
          {activeTab === 'attachments' && (
            <div className="space-y-3">
              <label className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer">
                Upload File
                <input type="file" className="hidden" onChange={handleUploadFile} />
              </label>
              {loading('attachments') ? (
                <div className="text-sm text-gray-600">Loading…</div>
              ) : attachments.length === 0 ? (
                <div className="text-sm text-gray-500">No attachments.</div>
              ) : (
                <div className="space-y-2">
                  {attachments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div>
                        <a href={a.file_url} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">
                          {a.file_name}
                        </a>
                        <div className="text-xs text-gray-500">
                          {a.file_size ? `${(a.file_size / 1024).toFixed(1)} KB` : '—'} · {a.mime_type || '—'}
                        </div>
                      </div>
                      <button onClick={() => handleDeleteAttachment(a.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Assignees Tab ───────────────────────────────── */}
          {activeTab === 'assignees' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  value={assigneeUserId}
                  onChange={(e) => setAssigneeUserId(e.target.value)}
                >
                  <option value="">Select user</option>
                  {users.map((u) => (
                     <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
                <select
                  className="rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  value={assigneeRole}
                  onChange={(e) => setAssigneeRole(e.target.value)}
                >
                  {RACI_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleAddAssignee}
                  className="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Assign
                </button>
              </div>
              {loading('assignees') ? (
                <div className="text-sm text-gray-600">Loading…</div>
              ) : assignees.length === 0 ? (
                <div className="text-sm text-gray-500">No assignees.</div>
              ) : (
                <div className="space-y-1">
                  {assignees.map((a) => (
                    <div key={a.id} className="flex items-center justify-between py-1 px-2 bg-gray-50 rounded text-sm">
                       <span>{a.user_name || a.email}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs rounded-full px-2 py-0.5 ${
                          a.role === 'responsible' ? 'bg-blue-100 text-blue-700' :
                          a.role === 'accountable' ? 'bg-orange-100 text-orange-700' :
                          a.role === 'consulted' ? 'bg-purple-100 text-purple-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>{a.role}</span>
                        <button onClick={() => handleRemoveAssignee(a.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Dependencies Tab ────────────────────────────── */}
          {activeTab === 'dependencies' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  value={depTaskId}
                  onChange={(e) => setDepTaskId(e.target.value)}
                >
                  <option value="">Select blocking task</option>
                  {availableDepTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.task_id ? `${t.task_id}: ` : ''}{t.name}</option>
                  ))}
                </select>
                <select
                  className="rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  value={depType}
                  onChange={(e) => setDepType(e.target.value)}
                >
                  {DEPENDENCY_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleAddDep}
                  className="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Link
                </button>
              </div>
              {loading('dependencies') ? (
                <div className="text-sm text-gray-600">Loading…</div>
              ) : deps.length === 0 ? (
                <div className="text-sm text-gray-500">No dependencies.</div>
              ) : (
                <div className="space-y-1">
                  {deps.map((d) => (
                    <div key={d.id} className="flex items-center justify-between py-1 px-2 bg-gray-50 rounded text-sm">
                      <div>
                        <span className="text-gray-800">{d.depends_on_name || d.depends_on_task_id}</span>
                        <span className="mx-2 text-xs text-gray-500">
                          {DEPENDENCY_TYPES.find((dt) => dt.value === d.type)?.label || d.type}
                        </span>
                      </div>
                      <button onClick={() => handleRemoveDep(d.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'relations' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  value={relTaskId}
                  onChange={(e) => setRelTaskId(e.target.value)}
                >
                  <option value="">Select related task</option>
                  {availableRelTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.task_id ? `${t.task_id}: ` : ''}{t.name}</option>
                  ))}
                </select>
                <select
                  className="rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  value={relType}
                  onChange={(e) => setRelType(e.target.value)}
                >
                  {RELATION_TYPES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Delay"
                  className="w-20 rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  value={relDelay}
                  onChange={(e) => setRelDelay(e.target.value)}
                />
                <button
                  onClick={handleAddRelation}
                  className="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Link
                </button>
              </div>
              {loading('relations') ? (
                <div className="text-sm text-gray-600">Loading…</div>
              ) : relations.length === 0 ? (
                <div className="text-sm text-gray-500">No relations.</div>
              ) : (
                <div className="space-y-1">
                  {relations.map((r) => {
                    const isOutgoing = r.from_task_id === task.id
                    const otherName = isOutgoing ? (r.to_task_name || r.to_task_task_id) : (r.from_task_name || r.from_task_task_id)
                    const typeLabel = RELATION_TYPES.find((rt) => rt.value === r.relation_type)?.label || r.relation_type
                    return (
                      <div key={r.id} className="flex items-center justify-between py-1 px-2 bg-gray-50 rounded text-sm">
                        <div>
                          <span className="text-gray-800">{otherName}</span>
                          <span className="mx-2 text-xs text-gray-500">{typeLabel}</span>
                          {r.delay_days > 0 && <span className="text-xs text-gray-500">+{r.delay_days}d</span>}
                        </div>
                        <button onClick={() => handleRemoveRelation(r.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
