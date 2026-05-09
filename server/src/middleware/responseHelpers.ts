import { Request, Response, NextFunction } from 'express';

// Extend Express Response to include our helpers
declare global {
  namespace Express {
    interface Response {
      sendSuccess: (data: any, meta?: Record<string, any>) => Response;
      sendError: (message: string, code?: string, statusCode?: number) => Response;
    }
  }
}

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
export default function responseHelpers(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.sendSuccess = (data: any, meta?: Record<string, any>) => {
    const payload: any = { success: true, data };
    if (meta !== undefined) {
      payload.meta = meta;
    }
    return res.json(payload);
  };

  res.sendError = (message: string, code = 'INTERNAL_ERROR', statusCode = 500) => {
    return res.status(statusCode).json({
      success: false,
      error: { code, message },
    });
  };

  next();
}
