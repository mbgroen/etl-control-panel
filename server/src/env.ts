import { z } from 'zod';

/**
 * All runtime configuration arrives via environment variables so the same image
 * can be deployed unchanged. Validation happens once, at boot, and a bad value
 * kills the process immediately rather than surfacing as a confusing 500 later.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Credentials are optional here on purpose. Leave them unset and the
   * control panel runs a first-run setup wizard in the browser, which is what makes
   * a WebUI-only install possible. Set them and they take precedence, for
   * deployments managed as code. See services/credentials.ts.
   */
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD_HASH: z
    .string()
    .default('')
    .refine((v) => v === '' || v.length >= 20, 'ADMIN_PASSWORD_HASH must be a bcrypt hash'),
  /** Signing key for session JWTs. Generated and persisted when left empty. */
  SESSION_SECRET: z
    .string()
    .default('')
    .refine((v) => v === '' || v.length >= 32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  /** Set false only when serving the control panel over plain HTTP on a trusted LAN. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Whether to resolve player addresses to a country.
   *
   * The only outbound request this control panel makes. Public player addresses are
   * sent to ipwho.is; private addresses never leave the host, and no player
   * name is ever included. Set false to keep the process entirely local — the
   * Players page still works, without countries.
   */
  GEO_LOOKUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Container names as they appear to the Docker daemon. */
  ETL_CONTAINER: z.string().min(1).default('etlegacy-server'),
  FASTDL_CONTAINER: z.string().min(1).default('etlegacy-fastdl'),
  DOCKER_SOCKET: z.string().min(1).default('/var/run/docker.sock'),

  /** Where the game server is reachable for UDP queries and rcon. */
  ETL_HOST: z.string().min(1).default('etlegacy'),
  ETL_PORT: z.coerce.number().int().min(1).max(65535).default(27960),
  RCON_PASSWORD: z.string().default(''),
  RCON_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(3_000),

  /**
   * Path *inside the control panel container* to the game server's etmain directory.
   * Must be the same host directory the game server mounts, or edits will not
   * be visible to the running server.
   */
  ETMAIN_PATH: z.string().min(1).default('/data/etlegacy/etmain'),
  LEGACY_PATH: z.string().min(1).default('/data/etlegacy/legacy'),
  /** Control-panel-owned state: config backups and the metrics ring buffer. */
  STATE_PATH: z.string().min(1).default('/data/control-panel'),
  /** Filename of the server config, relative to ETMAIN_PATH. */
  SERVER_CONFIG_NAME: z.string().min(1).default('etl_server.cfg'),

  /** Public base URL clients use for HTTP downloads, e.g. http://192.168.1.10:8081 */
  FASTDL_BASE_URL: z.string().default(''),
  /** Largest pk3 accepted by the upload endpoint, in megabytes. */
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2048).default(256),

  /** Seconds between background polls of the game server and container stats. */
  POLL_INTERVAL_SEC: z.coerce.number().int().min(2).max(300).default(10),
  /** How many poll samples to retain for the activity charts. */
  HISTORY_POINTS: z.coerce.number().int().min(60).max(20_000).default(2_880),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Written straight to stderr: the logger itself depends on this config.
    process.stderr.write(`Invalid environment configuration:\n${detail}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();

export const isProduction = env.NODE_ENV === 'production';
