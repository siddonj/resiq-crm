import api, { getAuthHeaders } from './api'

export const teamsApi = {
  /**
   * Fetch all teams.
   * @param {string} token
   */
  getAll: (token) =>
    api.get('/teams', getAuthHeaders(token)),

  /**
   * Get a single team by ID (includes members).
   * @param {string} token
   * @param {string|number} id
   */
  getById: (token, id) =>
    api.get(`/teams/${id}`, getAuthHeaders(token)),

  /**
   * Create a new team.
   * @param {string} token
   * @param {{ name: string, description?: string }} payload
   */
  create: (token, payload) =>
    api.post('/teams', payload, getAuthHeaders(token)),

  /**
   * Update a team.
   * @param {string} token
   * @param {string|number} id
   * @param {{ name?: string, description?: string }} payload
   */
  update: (token, id, payload) =>
    api.put(`/teams/${id}`, payload, getAuthHeaders(token)),

  /**
   * Delete a team.
   * @param {string} token
   * @param {string|number} id
   */
  delete: (token, id) =>
    api.delete(`/teams/${id}`, getAuthHeaders(token)),

  /**
   * Add a member to a team.
   * @param {string} token
   * @param {string|number} teamId
   * @param {{ user_id: string, role: string }} member
   */
  addMember: (token, teamId, member) =>
    api.post(`/teams/${teamId}/members`, member, getAuthHeaders(token)),

  /**
   * Remove a member from a team.
   * @param {string} token
   * @param {string|number} teamId
   * @param {string|number} userId
   */
  removeMember: (token, teamId, userId) =>
    api.delete(`/teams/${teamId}/members/${userId}`, getAuthHeaders(token)),

  /**
   * Update a member's role within a team.
   * @param {string} token
   * @param {string|number} teamId
   * @param {string|number} userId
   * @param {string} role
   */
  updateMemberRole: (token, teamId, userId, role) =>
    api.put(
      `/teams/${teamId}/members/${userId}/role`,
      { role },
      getAuthHeaders(token),
    ),
}
