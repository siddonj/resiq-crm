import api, { getAuthHeaders } from './api'

export const contactsApi = {
  /**
   * Fetch contacts with optional filters.
   * @param {string} token
   * @param {{ search?: string, type?: string, service_line?: string }} [filters]
   */
  getAll: (token, filters = {}) => {
    const params = {}
    if (filters.search) params.search = filters.search
    if (filters.type) params.type = filters.type
    if (filters.service_line) params.service_line = filters.service_line
    return api.get('/contacts', { ...getAuthHeaders(token), params })
  },

  /**
   * Get a single contact by ID.
   * @param {string} token
   * @param {string|number} id
   */
  getById: (token, id) =>
    api.get(`/contacts/${id}`, getAuthHeaders(token)),

  /**
   * Create a new contact.
   * @param {string} token
   * @param {object} payload
   */
  create: (token, payload) =>
    api.post('/contacts', payload, getAuthHeaders(token)),

  /**
   * Update an existing contact.
   * @param {string} token
   * @param {string|number} id
   * @param {object} payload
   */
  update: (token, id, payload) =>
    api.put(`/contacts/${id}`, payload, getAuthHeaders(token)),

  /**
   * Delete a contact.
   * @param {string} token
   * @param {string|number} id
   */
  delete: (token, id) =>
    api.delete(`/contacts/${id}`, getAuthHeaders(token)),

  /**
   * Export contacts as CSV blob.
   * @param {string} token
   * @param {{ search?: string, type?: string, service_line?: string }} [filters]
   */
  export: (token, filters = {}) => {
    const params = {}
    if (filters.search) params.search = filters.search
    if (filters.type) params.type = filters.type
    if (filters.service_line) params.service_line = filters.service_line
    return api.get('/contacts/export', {
      ...getAuthHeaders(token),
      params,
      responseType: 'blob',
    })
  },

  /**
   * Import contacts from CSV file.
   * @param {string} token
   * @param {File} file
   * @param {boolean} enrich - whether to auto-enrich in background
   */
  import: (token, file, enrich = false) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post(`/contacts/import?enrich=${enrich}`, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'multipart/form-data',
      },
    })
  },

  /**
   * Enrich a contact using AI (requires OpenAI API key).
   * @param {string} token
   * @param {string|number} id
   */
  enrich: (token, id) =>
    api.post(`/contacts/${id}/enrich`, {}, getAuthHeaders(token)),

  /**
   * Bulk enrich contacts.
   * @param {string} token
   * @param {string[]} ids
   */
  bulkEnrich: (token, ids) =>
    api.post('/contacts/bulk-enrich', { ids }, getAuthHeaders(token)),
}
