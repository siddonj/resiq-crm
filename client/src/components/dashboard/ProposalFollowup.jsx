/**
 * ProposalFollowup — Dashboard widget
 *
 * Fetches deals stuck in the proposal stage that have pending auto-generated
 * follow-up tasks (5-day or 10-day). Lets the seller review the draft and
 * click "Send" to fire the email via Gmail, or "Dismiss" to skip it.
 *
 * No emails are sent automatically — the seller always reviews first.
 */

import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'

function formatDayOffset(offset) {
  return offset >= 10 ? '10-day follow-up' : '5-day follow-up'
}

export default function ProposalFollowup() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  // taskId -> 'sending' | 'sent' | 'dismissing' | 'dismissed' | 'error'
  const [taskState, setTaskState] = useState({})
  // taskId -> boolean (show draft expanded)
  const [expanded, setExpanded] = useState({})

  const fetchTasks = useCallback(() => {
    if (!token) return
    axios.get('/api/deals/followup-pending', headers)
      .then(r => setTasks(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const handleSend = async (task) => {
    setTaskState(s => ({ ...s, [task.task_id]: 'sending' }))
    try {
      await axios.post(
        `/api/deals/${task.deal_id}/followup-tasks/${task.task_id}/send`,
        {},
        headers
      )
      setTaskState(s => ({ ...s, [task.task_id]: 'sent' }))
      // Remove from list after a short delay so seller sees "Sent" feedback
      setTimeout(() => {
        setTasks(prev => prev.filter(t => t.task_id !== task.task_id))
        setTaskState(s => { const n = { ...s }; delete n[task.task_id]; return n })
      }, 1500)
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to send'
      setTaskState(s => ({ ...s, [task.task_id]: `error:${message}` }))
    }
  }

  const handleDismiss = async (task) => {
    setTaskState(s => ({ ...s, [task.task_id]: 'dismissing' }))
    try {
      await axios.post(
        `/api/deals/${task.deal_id}/followup-tasks/${task.task_id}/dismiss`,
        {},
        headers
      )
      setTasks(prev => prev.filter(t => t.task_id !== task.task_id))
      setTaskState(s => { const n = { ...s }; delete n[task.task_id]; return n })
    } catch {
      setTaskState(s => ({ ...s, [task.task_id]: 'error:Could not dismiss' }))
    }
  }

  const toggleExpanded = (taskId) => {
    setExpanded(prev => ({ ...prev, [taskId]: !prev[taskId] }))
  }

  if (loading) return null
  if (tasks.length === 0) return null

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
        <h3 className="font-syne font-bold text-sm text-amber-600 flex items-center gap-2">
          <span className="w-2 h-2 bg-amber-400 rounded-full" />
          Proposals needing follow-up ({tasks.length})
        </h3>
        <button
          onClick={() => navigate('/deals')}
          className="text-xs text-gray-400 hover:text-teal"
        >
          All deals →
        </button>
      </div>

      <div className="divide-y divide-gray-50">
        {tasks.map(task => {
          const state = taskState[task.task_id]
          const isSending = state === 'sending'
          const isSent = state === 'sent'
          const isDismissing = state === 'dismissing'
          const isError = state?.startsWith('error:')
          const errorMsg = isError ? state.slice(6) : null
          const isExpanded = expanded[task.task_id]

          return (
            <div key={task.task_id} className="px-6 py-4">
              {/* Deal + contact header */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-navy truncate">{task.deal_title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {task.contact_name && (
                      <span className="text-xs text-gray-400">{task.contact_name}</span>
                    )}
                    <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full font-medium">
                      {formatDayOffset(task.day_offset)}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  {isSent ? (
                    <span className="text-xs text-teal font-semibold">Sent!</span>
                  ) : (
                    <>
                      <button
                        onClick={() => handleSend(task)}
                        disabled={isSending || isDismissing}
                        className="text-xs bg-teal text-white font-semibold px-3 py-1.5 rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors"
                      >
                        {isSending ? 'Sending…' : 'Send follow-up'}
                      </button>
                      <button
                        onClick={() => handleDismiss(task)}
                        disabled={isSending || isDismissing}
                        className="text-xs text-gray-400 hover:text-gray-600 font-medium px-2 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        {isDismissing ? '…' : 'Dismiss'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Task body */}
              <p className="text-xs text-gray-500 mb-2">{task.task_body}</p>

              {/* Expand / collapse draft */}
              <button
                onClick={() => toggleExpanded(task.task_id)}
                className="text-xs text-teal hover:underline"
              >
                {isExpanded ? 'Hide draft' : 'Preview draft email'}
              </button>

              {isExpanded && (
                <div
                  className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-700 border border-gray-100 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: task.email_draft }}
                />
              )}

              {isError && (
                <p className="text-xs text-red-500 mt-1">{errorMsg}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
