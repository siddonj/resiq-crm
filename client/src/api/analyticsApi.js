import api, { getAuthHeaders } from './api'

export const analyticsApi = {
  /**
   * Win/loss analytics.
   * @param {string} token
   */
  getWinLoss: (token) =>
    api.get('/analytics/deals/win-loss', getAuthHeaders(token)),

  /**
   * Deal velocity analytics.
   * @param {string} token
   */
  getVelocity: (token) =>
    api.get('/analytics/deals/velocity', getAuthHeaders(token)),

  /**
   * MRR analytics.
   * @param {string} token
   */
  getMrr: (token) =>
    api.get('/analytics/deals/mrr', getAuthHeaders(token)),

  /**
   * Service-line breakdown analytics.
   * @param {string} token
   */
  getServiceLines: (token) =>
    api.get('/analytics/deals/service-lines', getAuthHeaders(token)),

  /**
   * Forecasting data.
   * @param {string} token
   */
  getForecast: (token) =>
    api.get('/analytics/deals/forecast', getAuthHeaders(token)),

  /**
   * Stage probabilities.
   * @param {string} token
   */
  getStageProbabilities: (token) =>
    api.get('/analytics/deals/stage-probabilities', getAuthHeaders(token)),

  /**
   * Update stage probabilities.
   * @param {string} token
   * @param {object} probabilities
   */
  updateStageProbabilities: (token, probabilities) =>
    api.put('/analytics/deals/stage-probabilities', { probabilities }, getAuthHeaders(token)),
}
