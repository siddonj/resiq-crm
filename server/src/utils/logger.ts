import pino from 'pino';
import { Request } from 'express';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
  base: {
    service: 'resiq-crm-api',
    version: process.env.npm_package_version || '1.0',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
});

/**
 * Create a child logger with request context.
 * Use in Express middleware:
 *   req.log = createRequestLogger(req);
 */
export function createRequestLogger(req: Request): pino.Logger {
  const requestId = req.get('x-request-id') || (req as any).id || Math.random().toString(36).slice(2);
  return logger.child({
    reqId: requestId,
    method: req.method,
    path: req.path,
    userId: (req as any).user?.id,
  });
}
