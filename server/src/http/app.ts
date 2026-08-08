import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

/**
 * CSP hashes for the inline <script> blocks in the built index.html.
 *
 * The shell runs a small inline script that applies the saved theme before
 * first paint, so a reload never flashes the wrong one. Hashing it at startup
 * keeps 'unsafe-inline' out of script-src and cannot drift: edit the script and
 * the hash follows on the next boot.
 */
function inlineScriptHashes(): string[] {
  try {
    const html = readFileSync(path.join(STATIC_ROOT, 'index.html'), 'utf8');
    const inline = html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
    return [...inline].map(
      (match) => `'sha256-${createHash('sha256').update(match[1] ?? '', 'utf8').digest('base64')}'`,
    );
  } catch {
    // No built SPA beside the server — in development Vite serves it instead.
    return [];
  }
}

export function createApp(): express.Express {
  const app = express();

  // The control panel usually sits behind a reverse proxy or a Docker port publish;
  // without this, rate limiting keys every request to the proxy's IP.
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
          // 'self' covers the hashed bundles; the hashes cover the theme script
          // inlined into index.html. Without them that script is refused and
          // the page loads with the default theme.
          scriptSrc: ["'self'", ...inlineScriptHashes()],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          // Helmet turns this on by default, and on a plain-HTTP deployment it
          // is fatal: the browser rewrites every asset request to https://,
          // nothing is listening there, and the SPA never loads — a blank page
          // whose only symptom is a TLS error in the console. It stays off
          // unless the control panel is actually served over HTTPS. Note that
          // localhost is exempt from upgrading, so this only ever breaks real
          // deployments, never a developer's own machine.
          upgradeInsecureRequests: env.COOKIE_SECURE ? [] : null,
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
