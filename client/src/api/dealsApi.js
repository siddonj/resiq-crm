import api, { getAuthHeaders } from './api'

export const dealsApi = {
  /**
   * Fetch deals with optional filters.
   * @param {string} token
   * @param {{ search?: string, stage?: string, service_line?: string }} [filters]
   */
  getAll: (token, filters = {}) => {
    const params = {}
    if (filters.search) params.search = filters.search
    if (filters.stage) params.stage = filters.stage
    if (filters.service_line) params.service_line = filters.service_line
    return api.get('/deals', { ...getAuthHeaders(token), params })
  },

  /**
   * Get a single deal by ID.
   * @param {string} token
   * @param {string|number} id
   */
  getById: (token, id) =>
    api.get(`/deals/${id}`, getAuthHeaders(token)),

  /**
   * Create a new deal.
   * @param {string} token
   * @param {object} payload
   */
  create: (token, payload) =>
    api.post('/deals', payload, getAuthHeaders(token)),

  /**
   * Update an existing deal.
   * @param {string} token
   * @param {string|number} id
   * @param {object} payload
   */
  update: (token, id, payload) =>
    api.put(`/deals/${id}`, payload, getAuthHeaders(token)),

  /**
   * Delete a deal.
   * @param {string} token
   * @param {string|number} id
   */
  delete: (token, id) =>
    api.delete(`/deals/${id}`, getAuthHeaders(token)),

  /**
   * Update the stage of a deal (drag & drop).
   * @param {string} token
   * @param {string|number} dealId
   * @param {string} stage
   */
  updateStage: (token, dealId, stage) =>
    api.patch(`/deals/${dealId}/stage`, { stage }, getAuthHeaders(token)),

  /**
   * Export deals as CSV blob.
   * @param {string} token
   * @param {{ search?: string, stage?: string, service_line?: string }} [filters]
   */
  export: (token, filters = {}) => {
    const params = {}
    if (filters.search) params.search = filters.search
    if (filters.stage) params.stage = filters.stage
    if (filters.service_line) params.service_line = filters.service_line
    return api.get('/deals/export', {
      ...getAuthHeaders(token),
      params,
      responseType: 'blob',
    })
  },
}
