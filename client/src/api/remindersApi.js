import api, { getAuthHeaders } from './api'

export const remindersApi = {
  /**
   * Fetch reminders with optional completion filter.
   * @param {string} token
   * @param {{ completed?: boolean }} [filters]
   */
  getAll: (token, filters = {}) => {
    const params = {}
    if (filters.completed !== undefined) params.completed = filters.completed
    return api.get('/reminders', { ...getAuthHeaders(token), params })
  },

  /**
   * Create a new reminder.
   * @param {string} token
   * @param {{ message: string, remind_at: string, contact_id?: string, deal_id?: string }} payload
   */
  create: (token, payload) =>
    api.post('/reminders', payload, getAuthHeaders(token)),

  /**
   * Toggle reminder completion status.
   * @param {string} token
   * @param {string|number} id
   * @param {boolean} completed
   */
  complete: (token, id, completed) =>
    api.patch(`/reminders/${id}/complete`, { completed }, getAuthHeaders(token)),

  /**
   * Delete a reminder.
   * @param {string} token
   * @param {string|number} id
   */
  delete: (token, id) =>
    api.delete(`/reminders/${id}`, getAuthHeaders(token)),
}
