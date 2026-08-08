import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createApp } from './http/app.js';
import { attachWebSocket } from './http/ws.js';
import { env } from './env.js';
import { logger } from './logger.js';
import * as credentials from './services/credentials.js';
import * as docker from './services/docker.js';
import { history } from './services/metrics.js';
import { poller } from './services/poller.js';

/**
 * Warns when the state directory looks like it was left behind by the rename.
 *
 * The default moved from /data/dashboard to /data/control-panel. An operator who
 * updates the image without moving the folder gets a working control panel with
 * no account, no settings and no history — which reads as data loss, not as a
 * path change. Saying so at boot costs one stat call.
 */
async function warnAboutLegacyState(): Promise<void> {
  const current = env.STATE_PATH;
  const legacy = path.join(path.dirname(current), 'dashboard');
  if (path.resolve(legacy) === path.resolve(current)) return;

  const exists = async (file: string) =>
    fs
      .access(file)
      .then(() => true)
      .catch(() => false);

  if (await exists(path.join(current, 'credentials.json'))) return;
  if (!(await exists(path.join(legacy, 'credentials.json')))) return;

  logger.warn(
    { legacy, current },
    `Found an older state directory at ${legacy} while ${current} is empty. ` +
      `This is where the account, settings and history from before the rename live — ` +
      `stop the container and move it: mv ${legacy} ${current}`,
  );
}

async function main(): Promise<void> {
  await warnAboutLegacyState();

  // Must run before the HTTP server accepts a request: every auth decision
  // depends on it.
  await credentials.initialize();
  await history.load();

  const app = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);

  const dockerStatus = await docker.ping();
  if (!dockerStatus.ok) {
    // Not fatal: the control panel is still useful for editing config, and this is
    // the exact situation the health page is designed to explain.
    logger.warn(
      { error: dockerStatus.error, socket: env.DOCKER_SOCKET },
      'Docker daemon is unreachable — container controls will not work',
    );
  }

  poller.start();

  // Persist history periodically rather than on every sample: an 8-hour buffer
  // rewritten every 10 seconds is needless wear on the NAS disk.
  const flushTimer = setInterval(() => void history.flush(), 60_000);
  flushTimer.unref();

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'ET: Legacy control panel listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    poller.stop();
    clearInterval(flushTimer);

    server.close(() => {
      void history.flush().finally(() => process.exit(0));
    });

    // Do not let a hung connection block the container from stopping.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
