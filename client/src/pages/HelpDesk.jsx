import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import { getTicketWebSocket } from '../context/ticketWebSocket'

const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
const PRIORITIES = { 
  urgent: 'bg-red-100 text-red-700 border-red-300',
  high: 'bg-orange-100 text-orange-700 border-orange-300',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  low: 'bg-blue-100 text-blue-700 border-blue-300'
}

export default function HelpDesk() {
  const { token } = useAuth()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNewTicketModal, setShowNewTicketModal] = useState(false)
  const [newTicket, setNewTicket] = useState({ subject: '', description: '', priority: 'medium' })
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [reply, setReply] = useState('')
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef(null)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  // Initialize WebSocket connection
  useEffect(() => {
    if (!token) return

    const initWebSocket = async () => {
      try {
        const ws = getTicketWebSocket(token)
        wsRef.current = ws
        
        // Connect with JWT token
        await ws.connect()
        setWsConnected(true)
        
        // Subscribe to real-time updates
        ws.on('ticket_created', (newTicket) => {
          console.log('New ticket created:', newTicket)
          setTickets(prev => [newTicket, ...prev])
        })

        ws.on('ticket_updated', (updatedTicket) => {
          console.log('Ticket updated:', updatedTicket)
          setTickets(prev =>
            prev.map(t => t.id === updatedTicket.id ? updatedTicket : t)
          )
          if (selectedTicket?.ticket.id === updatedTicket.id) {
            setSelectedTicket({ ...selectedTicket, ticket: updatedTicket })
          }
        })

        ws.on('reply_added', (data) => {
          console.log('Reply added:', data)
          if (selectedTicket?.ticket.id === data.ticketId) {
            setSelectedTicket(prev => ({
              ...prev,
              replies: [...(prev.replies || []), data.reply]
            }))
          }
        })

        ws.on('disconnected', () => {
          setWsConnected(false)
        })

        ws.on('error', (err) => {
          console.error('WebSocket error:', err)
          setWsConnected(false)
        })
      } catch (err) {
        console.warn('Failed to connect WebSocket:', err.message)
      }
    }

    initWebSocket()

    return () => {
      // Cleanup on unmount
      if (wsRef.current) {
        wsRef.current.disconnect()
      }
    }
  }, [token])

  const fetchTickets = async () => {
    try {
      const params = {}
      if (filter !== 'all') params.status = filter
      const { data } = await axios.get('/api/tickets', { ...authHeaders, params })
      setTickets(data)
      setError('')
    } catch (err) {
      console.error('Error fetching tickets:', err)
      setError('Failed to load tickets')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTickets() }, [filter, token])

  const handleCreateTicket = async (e) => {
    e.preventDefault()
    if (!newTicket.subject.trim()) {
      setError('Subject is required')
      return
    }

    try {
      await axios.post('/api/tickets', newTicket, authHeaders)
      setNewTicket({ subject: '', description: '', priority: 'medium' })
      setShowNewTicketModal(false)
      fetchTickets()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create ticket')
    }
  }

  const handleStatusChange = async (ticketId, newStatus) => {
    try {
      await axios.patch(`/api/tickets/${ticketId}`, { status: newStatus }, authHeaders)
      fetchTickets()
    } catch (err) {
      setError('Failed to update ticket status')
    }
  }

  const handleAddReply = async (e) => {
    e.preventDefault()
    if (!reply.trim()) return

    try {
      await axios.post(
        `/api/tickets/${selectedTicket.ticket.id}/replies`,
        { message: reply },
        authHeaders
      )
      setReply('')
      // Refresh ticket details
      const { data } = await axios.get(
        `/api/tickets/${selectedTicket.ticket.id}`,
        authHeaders
      )
      setSelectedTicket(data)
    } catch (err) {
      setError('Failed to add reply')
    }
  }

  if (loading) return <div className="p-6 text-gray-600">Loading tickets...</div>

  const columnsByStatus = STATUSES.reduce((acc, status) => {
    acc[status] = tickets.filter(t => t.status === status)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-syne text-3xl font-bold text-navy">Help Desk</h1>
          <button
            onClick={() => setShowNewTicketModal(true)}
            className="bg-teal-600 hover:bg-teal-700 text-white font-semibold px-4 py-2 rounded-lg transition"
          >
            + New Ticket
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        {/* WebSocket Status Indicator */}
        <div className="mb-4 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-gray-300'}`}></div>
          <span className={`text-xs font-medium ${wsConnected ? 'text-green-700' : 'text-gray-500'}`}>
            {wsConnected ? '✓ Live Updates Enabled' : 'Connecting...'}
          </span>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {['all', ...STATUSES].map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filter === status
                  ? 'bg-teal-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:border-teal-300'
              }`}
            >
              {status === 'all' ? 'All' : status.replace('_', ' ').toUpperCase()}
              {columnsByStatus[status] && filter !== 'all' && (
                <span className="ml-2 text-xs font-bold">({columnsByStatus[status].length})</span>
              )}
            </button>
          ))}
        </div>

        {/* Kanban Board */}
        {filter === 'all' ? (
          <div className="grid grid-cols-5 gap-4">
            {STATUSES.map(status => (
              <div key={status} className="bg-white rounded-lg p-4 border border-gray-200 min-h-96">
                <h3 className="font-semibold text-navy mb-4 capitalize">
                  {status.replace('_', ' ')}
                  <span className="ml-2 text-gray-500 text-sm font-normal">
                    ({columnsByStatus[status]?.length || 0})
                  </span>
                </h3>
                <div className="space-y-3">
                  {columnsByStatus[status]?.map(ticket => (
                    <div
                      key={ticket.id}
                      onClick={() => setSelectedTicket(null) || fetchTickets()}
                      className="p-3 bg-gray-50 rounded border border-gray-200 hover:border-teal-300 cursor-pointer transition"
                    >
                      <p className="text-sm font-medium text-navy line-clamp-2 mb-2">
                        {ticket.subject}
                      </p>
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs font-bold px-2 py-1 rounded border ${PRIORITIES[ticket.priority] || PRIORITIES.medium}`}
                        >
                          {ticket.priority.toUpperCase()}
                        </span>
                        <select
                          onClick={e => e.stopPropagation()}
                          value={ticket.status}
                          onChange={e => handleStatusChange(ticket.id, e.target.value)}
                          className="text-xs border-none bg-transparent text-gray-600 font-medium"
                        >
                          {STATUSES.map(s => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="space-y-3">
            {tickets.map(ticket => (
              <div
                key={ticket.id}
                onClick={() => {
                  // Fetch full ticket details
                  axios.get(`/api/tickets/${ticket.id}`, authHeaders)
                    .then(({ data }) => setSelectedTicket(data))
                }}
                className="p-4 bg-white rounded-lg border border-gray-200 hover:border-teal-300 cursor-pointer transition"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-navy">{ticket.subject}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      {ticket.contact_name && `${ticket.contact_name} • `}
                      {new Date(ticket.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <span className={`text-xs font-bold px-3 py-1 rounded border ${PRIORITIES[ticket.priority]}`}>
                      {ticket.priority.toUpperCase()}
                    </span>
                    <span className="text-xs font-medium px-3 py-1 bg-gray-100 text-gray-700 rounded capitalize">
                      {ticket.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Ticket Modal */}
      {showNewTicketModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-syne text-lg font-bold text-navy">New Support Ticket</h3>
              <button
                onClick={() => setShowNewTicketModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateTicket} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject *
                </label>
                <input
                  type="text"
                  value={newTicket.subject}
                  onChange={e => setNewTicket({ ...newTicket, subject: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={newTicket.description}
                  onChange={e => setNewTicket({ ...newTicket, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent h-24 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                </label>
                <select
                  value={newTicket.priority}
                  onChange={e => setNewTicket({ ...newTicket, priority: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNewTicketModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 transition"
                >
                  Create Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-syne text-lg font-bold text-navy">
                  {selectedTicket.ticket.subject}
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  #{selectedTicket.ticket.id.substring(0, 8)} • Created {new Date(selectedTicket.ticket.created_at).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => setSelectedTicket(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-6 custom-scrollbar">
              {/* Ticket Info */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600">Status</label>
                  <select
                    value={selectedTicket.ticket.status}
                    onChange={e => handleStatusChange(selectedTicket.ticket.id, e.target.value)}
                    className="mt-1 w-full px-2 py-1 border border-gray-300 rounded text-sm capitalize"
                  >
                    {STATUSES.map(s => (
                      <option key={s} value={s}>{s.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Priority</label>
                  <p className={`mt-1 text-sm font-bold px-2 py-1 rounded inline-block ${PRIORITIES[selectedTicket.ticket.priority]}`}>
                    {selectedTicket.ticket.priority.toUpperCase()}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Assigned To</label>
                  <p className="text-sm text-navy mt-1">{selectedTicket.ticket.assigned_to_name || 'Unassigned'}</p>
                </div>
              </div>

              {selectedTicket.ticket.description && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Description</label>
                  <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{selectedTicket.ticket.description}</p>
                </div>
              )}

              {/* Replies */}
              <div className="border-t border-gray-100 pt-4">
                <h4 className="font-semibold text-navy mb-3">Conversation</h4>
                <div className="space-y-3 max-h-48 overflow-y-auto mb-4">
                  {selectedTicket.replies.map(r => (
                    <div key={r.id} className="p-3 bg-gray-50 rounded border border-gray-200">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-navy">
                          {r.user_name || r.client_name || 'System'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(r.created_at).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-gray-700">{r.message}</p>
                    </div>
                  ))}
                </div>

                {/* Reply Form */}
                <form onSubmit={handleAddReply} className="space-y-2">
                  <textarea
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    placeholder="Add a reply..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none h-20 focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition"
                  >
                    Reply
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
