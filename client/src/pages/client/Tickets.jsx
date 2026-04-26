import { useState, useEffect } from 'react'
import axios from 'axios'
import { useClientAuth } from '../../context/ClientAuthContext'

export default function ClientTickets() {
  const { client, token } = useClientAuth()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)

  const [formData, setFormData] = useState({
    subject: '',
    description: '',
    priority: 'medium',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Fetch tickets on mount
  useEffect(() => {
    fetchTickets()
  }, [])

  const fetchTickets = async () => {
    try {
      setLoading(true)
      const response = await axios.get('/api/client-portal/tickets', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      setTickets(response.data || [])
      setError(null)
    } catch (err) {
      console.error('Error fetching tickets:', err)
      setError('Failed to load tickets')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateTicket = async (e) => {
    e.preventDefault()
    if (!formData.subject.trim() || !formData.description.trim()) {
      setError('Please fill in all fields')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      const response = await axios.post('/api/client-portal/tickets', formData, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      setTickets([response.data, ...tickets])
      setFormData({ subject: '', description: '', priority: 'medium' })
      setShowCreateForm(false)
      setSuccess('Ticket created successfully!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      console.error('Error creating ticket:', err)
      setError(err.response?.data?.error || 'Failed to create ticket')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddReply = async (e) => {
    e.preventDefault()
    if (!replyText.trim()) {
      setError('Reply cannot be empty')
      return
    }

    try {
      setSubmittingReply(true)
      setError(null)
      await axios.post(
        `/api/client-portal/tickets/${selectedTicket.id}/replies`,
        { message: replyText },
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      )
      setReplyText('')
      
      // Refresh ticket detail
      const response = await axios.get(`/api/client-portal/tickets/${selectedTicket.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      setSelectedTicket(response.data)
      setSuccess('Reply added successfully!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      console.error('Error adding reply:', err)
      setError(err.response?.data?.error || 'Failed to add reply')
    } finally {
      setSubmittingReply(false)
    }
  }

  const getStatusColor = (status) => {
    const colors = {
      open: 'bg-blue-100 text-blue-800',
      'in_progress': 'bg-yellow-100 text-yellow-800',
      waiting: 'bg-orange-100 text-orange-800',
      resolved: 'bg-green-100 text-green-800',
      closed: 'bg-gray-100 text-gray-800',
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  const getPriorityColor = (priority) => {
    const colors = {
      urgent: 'text-red-600 font-bold',
      high: 'text-orange-600',
      medium: 'text-yellow-600',
      low: 'text-green-600',
    }
    return colors[priority] || 'text-gray-600'
  }

  if (selectedTicket) {
    return (
      <div className="p-8">
        <button
          onClick={() => setSelectedTicket(null)}
          className="mb-4 text-blue-600 hover:text-blue-800 flex items-center gap-2"
        >
          ← Back to Tickets
        </button>

        <div className="bg-white rounded-lg shadow-md p-6">
          {/* Ticket Header */}
          <div className="mb-6 pb-6 border-b">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  {selectedTicket.subject}
                </h1>
                <p className="text-gray-600">Ticket #{selectedTicket.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <div className="flex gap-3">
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                    selectedTicket.status
                  )}`}
                >
                  {selectedTicket.status.replace('_', ' ')}
                </span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getPriorityColor(selectedTicket.priority)}`}>
                  {selectedTicket.priority}
                </span>
              </div>
            </div>
            <p className="text-gray-600">
              Created {new Date(selectedTicket.created_at).toLocaleDateString()} at{' '}
              {new Date(selectedTicket.created_at).toLocaleTimeString()}
            </p>
          </div>

          {/* Ticket Description */}
          <div className="mb-8 pb-8 border-b">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Description</h2>
            <p className="text-gray-700 whitespace-pre-wrap">{selectedTicket.description}</p>
          </div>

          {/* Replies */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Replies</h2>
            <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
              {selectedTicket.replies && selectedTicket.replies.length > 0 ? (
                selectedTicket.replies.map((reply) => (
                  <div key={reply.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-semibold text-gray-900">
                        {reply.user_name || reply.client_name || 'Support Team'}
                      </p>
                      <span className="text-sm text-gray-500">
                        {new Date(reply.created_at).toLocaleDateString()} at{' '}
                        {new Date(reply.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-gray-700 whitespace-pre-wrap">{reply.message}</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 italic">No replies yet</p>
              )}
            </div>

            {/* Add Reply Form */}
            <form onSubmit={handleAddReply} className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <label className="block text-sm font-semibold text-gray-900 mb-3">
                Add Your Reply
              </label>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply here..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                rows="4"
              />
              <button
                type="submit"
                disabled={submittingReply || !replyText.trim()}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {submittingReply ? 'Sending...' : 'Send Reply'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Support Tickets</h1>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
        >
          {showCreateForm ? 'Cancel' : '🎟️ Create Ticket'}
        </button>
      </div>

      {/* Create Ticket Form */}
      {showCreateForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6 border-l-4 border-blue-600">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Create New Support Ticket</h2>
          <form onSubmit={handleCreateTicket} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Subject *
              </label>
              <input
                type="text"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                placeholder="Brief summary of your issue"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Description *
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Provide details about your issue..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows="5"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Priority
              </label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {submitting ? 'Creating...' : 'Create Ticket'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false)
                  setError(null)
                }}
                className="bg-gray-300 text-gray-900 px-6 py-2 rounded-lg hover:bg-gray-400 font-medium"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-6 text-sm">
          ✓ {success}
        </div>
      )}

      {/* Tickets List */}
      {loading ? (
        <div className="text-center py-12">
          <p className="text-gray-500">Loading tickets...</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <p className="text-gray-500 text-lg mb-4">You haven't created any tickets yet</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            Create Your First Ticket
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <div
              key={ticket.id}
              onClick={() => setSelectedTicket(ticket)}
              className="bg-white rounded-lg shadow-md p-4 hover:shadow-lg cursor-pointer transition-shadow border-l-4 border-blue-500"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {ticket.subject}
                  </h3>
                  <p className="text-gray-600 text-sm line-clamp-2">{ticket.description}</p>
                  <p className="text-gray-500 text-xs mt-2">
                    Created {new Date(ticket.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-3 ml-4">
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${getStatusColor(
                      ticket.status
                    )}`}
                  >
                    {ticket.status.replace('_', ' ')}
                  </span>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${getPriorityColor(
                      ticket.priority
                    )}`}
                  >
                    {ticket.priority}
                  </span>
                </div>
              </div>
              {ticket.replies && ticket.replies.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600">
                  💬 {ticket.replies.length} {ticket.replies.length === 1 ? 'reply' : 'replies'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
