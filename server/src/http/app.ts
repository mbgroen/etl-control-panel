import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinoHttp } from 'pino-http';
import { env, isProduction } from '../env.js';
import { logger } from '../logger.js';
import { authRouter } from '../routes/auth.js';
import { configRouter } from '../routes/config.js';
import { consoleRouter } from '../routes/console.js';
import { fastdlRouter } from '../routes/fastdl.js';
import { mapsRouter } from '../routes/maps.js';
import { serverRouter } from '../routes/server.js';
import { systemRouter } from '../routes/system.js';
import { requireAuth } from './auth.js';
import { errorHandler } from './errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The built SPA is copied next to the compiled server in the Docker image. */
const STATIC_ROOT = path.resolve(here, '../../public');

export function createApp(): express.Express {
  const app = express();

  // The dashboard usually sits behind the OMV reverse proxy or a Docker port
  // publish; without this, rate limiting keys every request to the proxy's IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // The SPA is bundled with hashed assets; styles come from the same
          // origin, and 'unsafe-inline' is needed only for the boot style tag.
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // Assets are same-origin only; the strict default breaks nothing here.
      crossOriginEmbedderPolicy: false,
      // Would force HTTPS upgrades, which breaks plain-HTTP LAN deployments.
      hsts: env.COOKIE_SECURE,
    }),
  );

  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  app.use(
    pinoHttp({
      logger,
      // Health checks and the poller would otherwise dominate the log volume.
      autoLogging: {
        ignore: (req) => req.url === '/api/system/health' || req.url === '/api/server/status',
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'debug';
      },
    }),
  );

  // Liveness probe, deliberately outside the authenticated API.
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);

  // Everything past this point requires a session.
  const api = express.Router();
  api.use(requireAuth);
  api.use('/system', systemRouter);
  api.use('/server', serverRouter);
  api.use('/console', consoleRouter);
  api.use('/config', configRouter);
  api.use('/maps', mapsRouter);
  api.use('/fastdl', fastdlRouter);
  app.use('/api', api);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint' } });
  });

  if (isProduction) {
    app.use(
      express.static(STATIC_ROOT, {
        // Vite emits content-hashed filenames, so long caching is safe for
        // assets — but index.html must always be revalidated.
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );

    // Client-side routing: any non-API path renders the SPA shell.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(STATIC_ROOT, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
