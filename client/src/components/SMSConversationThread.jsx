import React, { useState, useEffect } from 'react';
import axios from 'axios';

/**
 * SMSConversationThread
 * Displays SMS conversation history for a contact
 * Shows both inbound and outbound messages with status
 */
function SMSConversationThread({ contact }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  const LIMIT = 20;

  useEffect(() => {
    // Fetch SMS history for contact
    const fetchMessages = async () => {
      try {
        setLoading(true);
        setError('');

        const response = await axios.get(
          `/api/contacts/${contact.id}/messages`,
          { params: { limit: LIMIT, offset: page * LIMIT } }
        );

        if (response.data.success) {
          if (page === 0) {
            setMessages(response.data.messages);
          } else {
            setMessages(prev => [...prev, ...response.data.messages]);
          }

          setTotal(response.data.pagination.total);
          setHasMore(response.data.pagination.pages > page + 1);
        }
      } catch (err) {
        console.error('Failed to fetch SMS history:', err);
        setError('Failed to load SMS history');
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [contact.id, page]);

  /**
   * Get status badge styling
   */
  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      sent: 'bg-blue-100 text-blue-800',
      delivered: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      read: 'bg-purple-100 text-purple-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  /**
   * Format timestamp
   */
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  /**
   * Format full timestamp
   */
  const formatFullTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading && messages.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p className="text-gray-600 mt-2">Loading SMS history...</p>
      </div>
    );
  }

  if (error && messages.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="text-center text-red-600">{error}</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
        <p className="text-gray-500">No SMS messages yet</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900">SMS Conversation</h3>
        <p className="text-sm text-gray-600 mt-1">{total} message{total !== 1 ? 's' : ''}</p>
      </div>

      {/* Messages */}
      <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`px-6 py-4 ${
              message.direction === 'outbound'
                ? 'bg-blue-50 border-l-4 border-blue-500'
                : 'bg-gray-50 border-l-4 border-gray-300'
            }`}
          >
            {/* Message Header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {message.direction === 'outbound' ? 'You' : 'Contact'}
                </span>
                <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(message.status)}`}>
                  {message.status}
                </span>
              </div>
              <div className="text-xs text-gray-500 font-mono" title={formatFullTime(message.created_at)}>
                {formatTime(message.created_at)}
              </div>
            </div>

            {/* Message Content */}
            <div className="text-gray-900 leading-relaxed whitespace-pre-wrap break-words mb-2">
              {message.content}
            </div>

            {/* Message Footer */}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{message.phone_from} → {message.phone_to}</span>
              {message.delivery_time && (
                <span>
                  Delivered: {new Date(message.delivery_time).toLocaleTimeString()}
                </span>
              )}
            </div>

            {/* Error Message (if failed) */}
            {message.status === 'failed' && message.error_message && (
              <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                Error: {message.error_message}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="px-6 py-4 text-center border-t border-gray-200">
          <button
            onClick={() => setPage(page + 1)}
            disabled={loading}
            className="text-blue-600 hover:text-blue-700 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 text-xs text-gray-600">
        Showing {messages.length} of {total} messages
      </div>
    </div>
  );
}

export default SMSConversationThread;
