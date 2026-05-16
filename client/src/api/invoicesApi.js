import api, { getAuthHeaders } from './api'

export const invoicesApi = {
  /**
   * Fetch invoices with optional status filter.
   * @param {string} token
   * @param {{ status?: string }} [filters]
   */
  getAll: (token, filters = {}) => {
    const params = {}
    if (filters.status) params.status = filters.status
    return api.get('/invoices', { ...getAuthHeaders(token), params })
  },

  /**
   * Create a new invoice.
   * @param {string} token
   * @param {object} payload
   */
  create: (token, payload) =>
    api.post('/invoices', payload, getAuthHeaders(token)),

  /**
   * Update an existing invoice.
   * @param {string} token
   * @param {string|number} id
   * @param {object} payload
   */
  update: (token, id, payload) =>
    api.put(`/invoices/${id}`, payload, getAuthHeaders(token)),

  /**
   * Delete an invoice.
   * @param {string} token
   * @param {string|number} id
   */
  delete: (token, id) =>
    api.delete(`/invoices/${id}`, getAuthHeaders(token)),

  /**
   * Update invoice status.
   * @param {string} token
   * @param {string|number} id
   * @param {string} status
   */
  updateStatus: (token, id, status) =>
    api.patch(`/invoices/${id}/status`, { status }, getAuthHeaders(token)),

  /**
   * Set Stripe payment URL for an invoice.
   * @param {string} token
   * @param {string|number} id
   * @param {string} stripePaymentUrl
   */
  createPaymentLink: (token, id, stripePaymentUrl) =>
    api.patch(
      `/invoices/${id}/payment-url`,
      { stripe_payment_url: stripePaymentUrl },
      getAuthHeaders(token),
    ),

  /**
   * Record a manual payment on an invoice.
   * @param {string} token
   * @param {string|number} id
   * @param {{ amount: number, method: string, transaction_id?: string }} payment
   */
  recordPayment: (token, id, payment) =>
    api.post(`/invoices/${id}/payments`, payment, getAuthHeaders(token)),

  // ── Sub-resources (vendors, categories, products, templates) ──────

  /** @param {string} token */
  getVendors: (token) =>
    api.get('/invoices/vendors', getAuthHeaders(token)),

  /** @param {string} token */
  getExpenseCategories: (token) =>
    api.get('/invoices/expense-categories', getAuthHeaders(token)),

  /** @param {string} token */
  getProducts: (token) =>
    api.get('/invoices/products/all', getAuthHeaders(token)),

  /** @param {string} token */
  getTemplates: (token) =>
    api.get('/invoices/templates/all', getAuthHeaders(token)),
}
