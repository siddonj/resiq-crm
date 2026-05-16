import api, { getAuthHeaders } from './api'

export const proposalsApi = {
  /**
   * Fetch proposals with optional filters.
   * @param {string} token
   * @param {{ status?: string, deal_id?: string }} [filters]
   */
  getAll: (token, filters = {}) => {
    const params = {}
    if (filters.status) params.status = filters.status
    if (filters.deal_id) params.deal_id = filters.deal_id
    return api.get('/proposals', { ...getAuthHeaders(token), params })
  },

  /**
   * Get a single proposal by ID.
   * @param {string} token
   * @param {string|number} id
   */
  getById: (token, id) =>
    api.get(`/proposals/${id}`, getAuthHeaders(token)),

  /**
   * Create a new proposal.
   * @param {string} token
   * @param {object} payload
   */
  create: (token, payload) =>
    api.post('/proposals', payload, getAuthHeaders(token)),

  /**
   * Update an existing proposal.
   * @param {string} token
   * @param {string|number} id
   * @param {object} payload
   */
  update: (token, id, payload) =>
    api.put(`/proposals/${id}`, payload, getAuthHeaders(token)),

  /**
   * Delete a proposal.
   * @param {string} token
   * @param {string|number} id
   */
  delete: (token, id) =>
    api.delete(`/proposals/${id}`, getAuthHeaders(token)),

  /**
   * Update proposal status.
   * @param {string} token
   * @param {string|number} id
   * @param {string} status
   */
  updateStatus: (token, id, status) =>
    api.patch(`/proposals/${id}/status`, { status }, getAuthHeaders(token)),

  /**
   * Sign a proposal electronically.
   * @param {string} token
   * @param {string|number} id
   * @param {string} name - signatory name
   */
  sign: (token, id, name) =>
    api.post(`/proposals/${id}/sign`, { name }, getAuthHeaders(token)),

  /**
   * Parse a docx file to populate proposal sections.
   * @param {string} token
   * @param {File} file
   */
  parseDoc: (token, file) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/proposals/parse-doc', formData, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'multipart/form-data',
      },
    })
  },
}
