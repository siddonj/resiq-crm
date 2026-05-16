import api, { getAuthHeaders } from './api'

export const usersApi = {
  /**
   * Fetch all users.
   * @param {string} token
   */
  getAll: (token) =>
    api.get('/users', getAuthHeaders(token)),

  /**
   * Get the current user's profile.
   * @param {string} token
   */
  getMe: (token) =>
    api.get('/users/me', getAuthHeaders(token)),

  /**
   * Update the current user's profile.
   * @param {string} token
   * @param {{ name?: string, email?: string }} payload
   */
  updateMe: (token, payload) =>
    api.put('/users/me', payload, getAuthHeaders(token)),

  /**
   * Update current user's password.
   * @param {string} token
   * @param {{ current_password: string, new_password: string }} payload
   */
  updatePassword: (token, payload) =>
    api.put('/users/me/password', payload, getAuthHeaders(token)),

  /**
   * Update a user's role.
   * @param {string} token
   * @param {string|number} userId
   * @param {string} role
   */
  updateRole: (token, userId, role) =>
    api.put(`/users/${userId}/role`, { role }, getAuthHeaders(token)),

  /**
   * Deactivate a user.
   * @param {string} token
   * @param {string|number} userId
   */
  deactivate: (token, userId) =>
    api.put(`/users/${userId}/deactivate`, {}, getAuthHeaders(token)),

  /**
   * Activate a user.
   * @param {string} token
   * @param {string|number} userId
   */
  activate: (token, userId) =>
    api.put(`/users/${userId}/activate`, {}, getAuthHeaders(token)),

  /**
   * Invite a new user.
   * @param {string} token
   * @param {{ name: string, email: string, role: string }} payload
   */
  invite: (token, payload) =>
    api.post('/users/invite', payload, getAuthHeaders(token)),

  /**
   * Fetch client users.
   * @param {string} token
   */
  getClients: (token) =>
    api.get('/users/clients', getAuthHeaders(token)),

  /**
   * Invite a client/guest.
   * @param {string} token
   * @param {object} payload
   */
  inviteClient: (token, payload) =>
    api.post('/auth/client/invite', payload, getAuthHeaders(token)),
}
