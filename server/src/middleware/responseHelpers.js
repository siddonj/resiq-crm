/**
 * Standardized API response envelope helpers.
 *
 * Attach to Express response objects via middleware:
 *   app.use(responseHelpers)
 *
 * Then in routes:
 *   res.sendSuccess({ leads: [...] })
 *   res.sendError('Not found', 'NOT_FOUND', 404)
 */

function responseHelpers(req, res, next) {
  /**
   * Send a standardized success response.
   * @param {any} data - Response payload
   * @param {object} [meta] - Optional metadata (page, count, etc.)
   */
  res.sendSuccess = (data, meta) => {
    const payload = { success: true, data };
    if (meta !== undefined) {
      payload.meta = meta;
    }
    return res.json(payload);
  };

  /**
   * Send a standardized error response.
   * @param {string} message - Human-readable error message
   * @param {string} [code='INTERNAL_ERROR'] - Machine-readable error code
   * @param {number} [statusCode=500] - HTTP status code
   */
  res.sendError = (message, code = 'INTERNAL_ERROR', statusCode = 500) => {
    return res.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
      },
    });
  };

  next();
}

module.exports = responseHelpers;
