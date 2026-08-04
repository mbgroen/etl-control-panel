import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger.js';
import { ContainerNotFoundError } from '../services/docker.js';
import { MapError } from '../services/maps.js';
import { RconError } from '../services/q3protocol.js';
import { ConfigConflictError, ConfigValidationError } from '../services/serverConfig.js';

/** Application error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Translates domain errors into HTTP responses.
 *
 * Every error leaves through here in the same envelope so the client has one
 * shape to handle. Unexpected errors log their stack server-side but return a
 * generic message — internals are not the browser's business.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'invalid_request',
        message: 'Request body failed validation',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof ConfigValidationError) {
    res.status(422).json({
      error: {
        code: 'config_invalid',
        message: 'The configuration has errors that would break the server',
        details: err.problems,
      },
    });
    return;
  }

  if (err instanceof ConfigConflictError) {
    res.status(409).json({
      error: {
        code: 'config_conflict',
        message: 'The config changed on disk since you loaded it. Reload to see the current version.',
        details: { currentRevision: err.currentRevision },
      },
    });
    return;
  }

  if (err instanceof ContainerNotFoundError) {
    res.status(404).json({ error: { code: 'container_missing', message: err.message } });
    return;
  }

  if (err instanceof MapError) {
    const status =
      err.kind === 'protected' ? 403 : err.kind === 'conflict' ? 409 : err.kind === 'missing' ? 404 : 400;
    res.status(status).json({ error: { code: `map_${err.kind.replace('-', '_')}`, message: err.message } });
    return;
  }

  if (err instanceof RconError) {
    const status = err.kind === 'no-password' ? 503 : err.kind === 'bad-password' ? 502 : 504;
    res.status(status).json({ error: { code: `rcon_${err.kind.replace('-', '_')}`, message: err.message } });
    return;
  }

  logger.error({ err }, 'unhandled error');
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong. Check the dashboard logs.' },
  });
}
