import pino from 'pino';
import { env, isProduction } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isProduction
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
  /**
   * Belt-and-braces: nothing in this codebase deliberately logs a secret, but a
   * stray object spread should never be able to leak the rcon password.
   */
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'password',
      '*.password',
      'rconPassword',
      '*.rconPassword',
    ],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
