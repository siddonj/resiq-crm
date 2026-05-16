import api, { getAuthHeaders } from './api'

export const projectsApi = {
  /**
   * Fetch all projects.
   * @param {string} token
   */
  getAll: (token) =>
    api.get('/projects', getAuthHeaders(token)),

  /**
   * Fetch project templates.
   * @param {string} token
   */
  getTemplates: (token) =>
    api.get('/projects/templates', getAuthHeaders(token)),

  /**
   * Get a single project by ID.
   * @param {string} token
   * @param {string|number} id
   */
  getById: (token, id) =>
    api.get(`/projects/${id}`, getAuthHeaders(token)),

  /**
   * Create a new project.
   * @param {string} token
   * @param {{ name: string, description?: string, template_id?: string, include_tasks?: boolean, deal_id?: string }} payload
   */
  create: (token, payload) =>
    api.post('/projects', payload, getAuthHeaders(token)),

  /**
   * Update a project.
   * @param {string} token
   * @param {string|number} id
   * @param {object} payload
   */
  update: (token, id, payload) =>
    api.put(`/projects/${id}`, payload, getAuthHeaders(token)),

  /**
   * Get project members.
   * @param {string} token
   * @param {string|number} projectId
   */
  getMembers: (token, projectId) =>
    api.get(`/projects/${projectId}/members`, getAuthHeaders(token)),

  /**
   * Save a project as a template.
   * @param {string} token
   * @param {string|number} projectId
   */
  saveAsTemplate: (token, projectId) =>
    api.post(`/projects/${projectId}/save-as-template`, {}, getAuthHeaders(token)),

  /**
   * Get project baselines.
   * @param {string} token
   * @param {string|number} projectId
   */
  getBaselines: (token, projectId) =>
    api.get(`/projects/${projectId}/baselines`, getAuthHeaders(token)),

  /**
   * Create a baseline snapshot.
   * @param {string} token
   * @param {string|number} projectId
   * @param {string} name
   */
  createBaseline: (token, projectId, name) =>
    api.post(`/projects/${projectId}/baselines`, { name }, getAuthHeaders(token)),
}
