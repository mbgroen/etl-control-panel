/** Shapes mirrored from the API. Kept in one place so a contract change surfaces
 *  as a type error in every consumer rather than a runtime surprise in one. */

export interface ContainerState {
  name: string;
  exists: boolean;
  status: string;
  running: boolean;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  startedAt: string | null;
  uptimeSec: number | null;
  restartCount: number;
  image: string;
  exitCode: number | null;
}

export interface ResourceSample {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  netRxBytes: number;
  netTxBytes: number;
}

export interface Player {
  slot: number | null;
  name: string;
  nameClean: string;
  score: number;
  ping: number;
  address: string | null;
  rate: number | null;
}

export interface ServerStatus {
  online: boolean;
  latencyMs: number | null;
  hostname: string;
  hostnameClean: string;
  map: string;
  gametype: string;
  players: Player[];
  maxClients: number;
  privateClients: number;
  needPass: boolean;
  version: string;
  mod: string;
  raw: Record<string, string>;
  error?: string;
}

export interface Snapshot {
  updatedAt: string;
  game: {
    container: ContainerState;
    resources: ResourceSample | null;
    status: ServerStatus;
  };
  fastdl: {
    container: ContainerState;
    configured: boolean;
    baseUrl: string;
  };
  docker: { ok: boolean; error?: string };
}

export interface Cvar {
  key: string;
  value: string;
  command: string;
  line: number;
  secret: boolean;
}

export interface ConfigProblem {
  line: number | null;
  severity: 'error' | 'warning';
  message: string;
}

export interface ConfigPayload {
  path: string;
  content: string;
  revision: string;
  modifiedAt: string;
  sizeBytes: number;
  cvars: Cvar[];
  rotation: { map: string }[];
  problems: ConfigProblem[];
}

export interface BackupEntry {
  id: string;
  createdAt: string;
  sizeBytes: number;
  note: string;
}

export interface MapPackage {
  filename: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  stock: boolean;
  /** Playable maps inside the package, read from its maps/*.bsp entries. */
  maps: string[];
}

export interface MapsPayload {
  maps: MapPackage[];
  usage: { mapCount: number; customMapCount: number; totalBytes: number; customBytes: number };
  directory: string;
}

export interface FastdlPayload {
  container: ContainerState;
  configured: boolean;
  baseUrl: string;
  fileCount: number;
  totalBytes: number;
  health: { ok: boolean; message: string; checkedAt: string } | null;
  suggestedBaseUrl: string;
  containerName: string;
}

export interface HealthCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  remedy: string | null;
  optional?: boolean;
}

/** An administrator account. Every account has the same rights. */
export interface AdminAccount {
  id: string;
  username: string;
  createdAt: string;
}

/** Control panel preferences, stored in its own state directory. */
export interface ControlPanelSettings {
  maxUploadMb: number;
  maxBackups: number;
  maxPlayerSessions: number;
  limits: {
    minUploadMb: number;
    maxUploadMb: number;
    minBackups: number;
    maxBackups: number;
    minPlayerSessions: number;
    maxPlayerSessions: number;
  };
}

/** One visit by one player, open or finished. */
export interface PlayerSession {
  id: string;
  name: string;
  nameClean: string;
  address: string | null;
  countryCode: string | null;
  countryName: string | null;
  addressKind: 'public' | 'private' | 'loopback' | 'bot' | 'unknown' | null;
  joinedAt: string;
  lastSeenAt: string;
  leftAt: string | null;
  seconds: number;
}

export interface PlayerSessionsPayload {
  current: PlayerSession[];
  recent: PlayerSession[];
  summary: {
    totalSessions: number;
    uniquePlayers: number;
    countries: { code: string; name: string | null; sessions: number }[];
  };
}

export interface SystemInfo {
  version: string;
  gameServer: { host: string; port: number; container: string };
  fastdl: { container: string; suggestedBaseUrl: string };
  paths: { etmain: string; legacy: string; config: string };
  limits: { maxUploadMb: number; maxUploadMbCeiling: number };
  pollIntervalSec: number;
  rconConfigured: boolean;
  /** Which source supplied the password, so the UI can point at the right one. */
  rconSource: 'config' | 'environment' | 'none';
}

/**
 * Result of moving the running server onto a new rcon password.
 *
 * Present only when a save actually changed the password; null otherwise.
 */
export interface RconHandover {
  ok: boolean;
  message: string;
}

export interface HistorySample {
  t: number;
  players: number;
  maxPlayers: number;
  cpuPercent: number;
  memoryBytes: number;
  online: boolean;
  map: string;
}

export interface HistoryPayload {
  samples: HistorySample[];
  summary: { peakPlayers: number; avgPlayers: number; uptimePercent: number };
  windowMinutes: number;
}

export interface RconResult {
  command: string;
  output: string;
  outputPlain: string;
  durationMs: number;
  at: string;
}

export interface CommandEntry {
  label: string;
  command: string;
  danger: boolean;
  /**
   * Present when the command needs a value: the number is appended, so
   * "bot minbots" plus 6 is sent as "bot minbots 6".
   */
  input?: { kind: 'number'; defaultValue: number; min: number; max: number };
}

export interface CommandGroup {
  name: string;
  commands: CommandEntry[];
}
