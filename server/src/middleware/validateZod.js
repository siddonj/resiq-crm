/**
 * Express middleware factory for Zod validation.
 *
 * Usage:
 *   router.post('/leads/import/csv', validateBody(ImportCsvSchema), handler)
 *   router.get('/leads', validateQuery(LeadFiltersSchema), handler)
 */

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `${firstError.path.join('.')}: ${firstError.message}`,
          details: result.error.issues,
        },
      })
    }
    req.validatedBody = result.data
    next()
  }
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `${firstError.path.join('.')}: ${firstError.message}`,
          details: result.error.issues,
        },
      })
    }
    req.validatedQuery = result.data
    next()
  }
}

function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `${firstError.path.join('.')}: ${firstError.message}`,
          details: result.error.issues,
        },
      })
    }
    req.validatedParams = result.data
    next()
  }
}

module.exports = { validateBody, validateQuery, validateParams }
