import http from 'node:http';
import { createApp } from './http/app.js';
import { attachWebSocket } from './http/ws.js';
import { env } from './env.js';
import { logger } from './logger.js';
import * as credentials from './services/credentials.js';
import * as docker from './services/docker.js';
import { history } from './services/metrics.js';
import * as modFiles from './services/modFiles.js';
import { poller } from './services/poller.js';

async function main(): Promise<void> {
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

  // The mod package clients download when they join lives inside the game
  // server image, where FastDL cannot see it. Copying it out is the difference
  // between a 34 MB HTTP download and the in-game trickle that players give up
  // on — and the filename changes with every image update, so it is checked at
  // every start rather than once at install time.
  modFiles.publishInBackground('startup');

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
