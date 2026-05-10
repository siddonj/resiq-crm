import { useState } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'

const STATUS_COLORS = {
  not_started: 'bg-gray-200 text-gray-600 border-gray-300',
  in_progress: 'bg-blue-100 text-blue-700 border-blue-300',
  completed: 'bg-green-100 text-green-700 border-green-300',
  skipped: 'bg-yellow-100 text-yellow-700 border-yellow-300',
}

const STATUS_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
  skipped: 'Skipped',
}

export default function PhaseTimeline({ projectId, phases = [], users = [], members = [], onPhasesChanged }) {
  const { token, user } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }
  const [expandedId, setExpandedId] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPosition, setNewPosition] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editStatus, setEditStatus] = useState('')

  const isOwnerOrAdmin = members.some((m) => m.user_id === user?.id && (m.role === 'owner' || m.role === 'admin')) || user?.role === 'admin'

  const handleAdd = async () => {
    if (!newName.trim()) return
    try {
      await axios.post(`/api/projects/${projectId}/phases`, {
        name: newName.trim(),
        position: Number(newPosition) || phases.length,
      }, headers)
      setNewName('')
      setNewPosition('')
      setShowAddForm(false)
      onPhasesChanged?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add phase')
    }
  }

  const handleUpdate = async (phaseId) => {
    try {
      await axios.put(`/api/projects/${projectId}/phases/${phaseId}`, {
        name: editName,
        status: editStatus,
      }, headers)
      setEditingId(null)
      onPhasesChanged?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update phase')
    }
  }

  const handleDelete = async (phaseId) => {
    if (!confirm('Delete this phase?')) return
    try {
      await axios.delete(`/api/projects/${projectId}/phases/${phaseId}`, headers)
      onPhasesChanged?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete phase')
    }
  }

  const handleApproveGate = async (phaseId) => {
    try {
      await axios.post(`/api/projects/${projectId}/phases/${phaseId}/gate`, {}, headers)
      onPhasesChanged?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to approve gate')
    }
  }

  const handleRevokeGate = async (phaseId) => {
    try {
      await axios.delete(`/api/projects/${projectId}/phases/${phaseId}/gate`, headers)
      onPhasesChanged?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to revoke gate')
    }
  }

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const startEdit = (phase) => {
    setEditingId(phase.id)
    setEditName(phase.name)
    setEditStatus(phase.status)
  }

  const sortedPhases = [...phases].sort((a, b) => a.position - b.position)

  return (
    <div className="bg-white border rounded-lg shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">Project Phases</h3>
        {isOwnerOrAdmin && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
          >
            {showAddForm ? 'Cancel' : '+ Add Phase'}
          </button>
        )}
      </div>

      {showAddForm && (
        <div className="flex items-center gap-2 mb-4">
          <input
            className="flex-1 rounded-md border-gray-300 text-sm"
            placeholder="Phase name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
          />
          <input
            className="w-20 rounded-md border-gray-300 text-sm"
            placeholder="Position"
            type="number"
            value={newPosition}
            onChange={(e) => setNewPosition(e.target.value)}
          />
          <button
            onClick={handleAdd}
            className="px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Add
          </button>
        </div>
      )}

      {sortedPhases.length === 0 ? (
        <p className="text-xs text-gray-500">No phases defined yet.</p>
      ) : (
        <div className="space-y-2">
          {sortedPhases.map((phase, idx) => {
            const isExpanded = expandedId === phase.id
            const deliverables = Array.isArray(phase.deliverables) ? phase.deliverables : []
            const gateApproved = !!phase.gate_approved

            return (
              <div key={phase.id} className="border rounded-md overflow-hidden">
                <div
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 ${STATUS_COLORS[phase.status] || ''}`}
                  onClick={() => toggleExpand(phase.id)}
                >
                  <span className="text-xs font-bold w-5">{idx + 1}</span>
                  {gateApproved && (
                    <span className="text-green-600 text-xs" title="Gate approved">✓</span>
                  )}
                  {editingId === phase.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        className="flex-1 rounded border-gray-300 text-sm"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <select
                        className="text-xs rounded border-gray-300"
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {Object.keys(STATUS_LABELS).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleUpdate(phase.id) }}
                        className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingId(null) }}
                        className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium">{phase.name}</span>
                      <span className="text-xs font-medium">{STATUS_LABELS[phase.status]}</span>
                      {deliverables.length > 0 && (
                        <span className="text-[10px] bg-white/60 rounded-full px-1.5 py-0.5">
                          {deliverables.filter((d) => d.done).length}/{deliverables.length}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {isExpanded && (
                  <div className="px-3 py-2 bg-gray-50 border-t text-sm">
                    {deliverables.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs font-medium text-gray-600 mb-1">Deliverables</p>
                        <ul className="space-y-1">
                          {deliverables.map((d, i) => (
                            <li key={i} className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={!!d.done}
                                readOnly
                                className="h-3 w-3 text-indigo-600"
                              />
                              <span className={d.done ? 'line-through text-gray-400' : 'text-gray-700'}>
                                {d.text}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-2">
                      {gateApproved ? (
                        <div className="flex items-center gap-2 text-xs text-green-700">
                          <span>✓ Gate approved</span>
                          {isOwnerOrAdmin && (
                            <button
                              onClick={() => handleRevokeGate(phase.id)}
                              className="text-red-600 hover:text-red-800 underline"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>Gate pending</span>
                          {isOwnerOrAdmin && (
                            <button
                              onClick={() => handleApproveGate(phase.id)}
                              className="text-indigo-600 hover:text-indigo-800 underline"
                            >
                              Approve
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {isOwnerOrAdmin && (
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => startEdit(phase)}
                          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(phase.id)}
                          className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
