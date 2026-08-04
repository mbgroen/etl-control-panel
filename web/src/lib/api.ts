import type {
  BackupEntry,
  CommandGroup,
  ConfigPayload,
  ConfigProblem,
  FastdlPayload,
  HealthCheck,
  HistoryPayload,
  MapsPayload,
  Player,
  RconResult,
  Snapshot,
  SystemInfo,
} from './types';

/**
 * Typed API client.
 *
 * Errors are normalised into `ApiError` so every screen can render a real
 * message from the server instead of a generic "request failed" — the server
 * already knows what went wrong and says so in the error envelope.
 */

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

/** Set by the app shell so a 401 anywhere can bounce back to the login screen. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    // The session lives in a SameSite=Strict cookie, so credentials must be sent.
    credentials: 'same-origin',
    headers:
      init.body instanceof FormData
        ? init.headers
        : { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });

  if (response.status === 401) {
    onUnauthorized?.();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text ? safeParse(text) : null;

  if (!response.ok) {
    const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } };
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? 'unknown',
      envelope?.error?.message ?? `Request failed with status ${response.status}`,
      envelope?.error?.details,
    );
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  auth: {
    status: () =>
      request<{ needsSetup: boolean; managedByEnvironment: boolean; minPasswordLength: number }>(
        '/auth/status',
      ),
    session: () => request<{ user: { username: string } }>('/auth/session'),
    setup: (username: string, password: string) =>
      request<{ user: { username: string } }>('/auth/setup', {
        method: 'POST',
        ...json({ username, password }),
      }),
    login: (username: string, password: string) =>
      request<{ user: { username: string } }>('/auth/login', {
        method: 'POST',
        ...json({ username, password }),
      }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: boolean }>('/auth/password', {
        method: 'POST',
        ...json({ currentPassword, newPassword }),
      }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
  },

  system: {
    health: () => request<{ status: string; checks: HealthCheck[] }>('/system/health'),
    info: () => request<SystemInfo>('/system/info'),
    logs: (service: 'game' | 'fastdl', tail = 300) =>
      request<{ service: string; lines: string[] }>(`/system/logs/${service}?tail=${tail}`),
  },

  server: {
    status: () => request<Snapshot>('/server/status'),
    lifecycle: (service: 'game' | 'fastdl', action: 'start' | 'stop' | 'restart') =>
      request<{ ok: boolean; snapshot: Snapshot }>('/server/lifecycle', {
        method: 'POST',
        ...json({ service, action }),
      }),
    players: () =>
      request<{ players: Player[]; detailed: boolean; map?: string; rconError?: string }>(
        '/server/players',
      ),
    playerAction: (slot: number, action: 'kick' | 'ban' | 'mute' | 'unmute', reason?: string) =>
      request<{ ok: boolean; output: string }>('/server/players/action', {
        method: 'POST',
        ...json({ slot, action, reason }),
      }),
    history: (minutes: number, points = 180) =>
      request<HistoryPayload>(`/server/history?minutes=${minutes}&points=${points}`),
  },

  console: {
    run: (command: string) =>
      request<RconResult>('/console/rcon', { method: 'POST', ...json({ command }) }),
    palette: () => request<{ available: boolean; groups: CommandGroup[] }>('/console/commands'),
  },

  config: {
    get: () => request<ConfigPayload>('/config'),
    initialize: () =>
      request<{ revision: string; path: string }>('/config/initialize', { method: 'POST' }),
    save: (body: {
      content: string;
      expectedRevision?: string;
      note?: string;
      force?: boolean;
      reload?: boolean;
    }) =>
      request<{ revision: string; backupId: string | null; problems: ConfigProblem[] }>('/config', {
        method: 'PUT',
        ...json(body),
      }),
    patch: (updates: Record<string, string>, expectedRevision?: string, reload = false) =>
      request<{ revision: string; applied: string[] }>('/config/cvars', {
        method: 'PATCH',
        ...json({ updates, expectedRevision, reload }),
      }),
    validate: (content: string) =>
      request<{ problems: ConfigProblem[] }>('/config/validate', {
        method: 'POST',
        ...json({ content }),
      }),
    setRotation: (maps: string[], expectedRevision?: string) =>
      request<{ revision: string; rotation: { map: string }[] }>('/config/rotation', {
        method: 'PUT',
        ...json({ maps, expectedRevision }),
      }),
    backups: () => request<{ backups: BackupEntry[] }>('/config/backups'),
    backup: (id: string) => request<{ id: string; content: string }>(`/config/backups/${id}`),
    restore: (id: string) =>
      request<{ revision: string }>(`/config/backups/${id}/restore`, { method: 'POST' }),
  },

  maps: {
    list: () => request<MapsPayload>('/maps'),
    upload: (files: File[], onProgress?: (percent: number) => void) =>
      uploadWithProgress(files, onProgress),
    remove: (filename: string) =>
      request<void>(`/maps/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
  },

  fastdl: {
    get: () => request<FastdlPayload>('/fastdl'),
    enable: (baseUrl: string, allowDisconnectedDownload = false) =>
      request<{ ok: boolean; baseUrl: string; note: string }>('/fastdl/enable', {
        method: 'POST',
        ...json({ baseUrl, allowDisconnectedDownload }),
      }),
    disable: (stopContainer = true) =>
      request<{ ok: boolean }>('/fastdl/disable', { method: 'POST', ...json({ stopContainer }) }),
    test: (baseUrl?: string) =>
      request<{ ok: boolean; message: string; url: string; testedFile: string }>('/fastdl/test', {
        method: 'POST',
        ...json(baseUrl ? { baseUrl } : {}),
      }),
  },
};

export interface UploadResult {
  results: { filename: string; ok: boolean; error?: string }[];
  installed: number;
  rejected: number;
}

/**
 * Uploads via XHR rather than fetch.
 *
 * pk3 files routinely run to tens of megabytes over a LAN or VPN; fetch still
 * has no upload-progress event, and a multi-minute upload with no feedback
 * reads as a hung UI.
 */
function uploadWithProgress(files: File[], onProgress?: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files) form.append('files', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/maps/upload');
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      const payload = safeParse(xhr.responseText) as UploadResult & {
        error?: { code?: string; message?: string };
      };

      if (xhr.status === 401) onUnauthorized?.();

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
      } else {
        reject(
          new ApiError(
            xhr.status,
            payload?.error?.code ?? 'upload_failed',
            payload?.error?.message ?? describeUploadFailure(xhr.status),
            payload?.results,
          ),
        );
      }
    });

    xhr.addEventListener('error', () =>
      reject(new ApiError(0, 'network_error', 'The upload connection failed')),
    );
    xhr.addEventListener('abort', () =>
      reject(new ApiError(0, 'aborted', 'The upload was cancelled')),
    );

    xhr.send(form);
  });
}

function describeUploadFailure(status: number): string {
  if (status === 413) return 'That file is larger than the configured upload limit';
  if (status === 422) return 'None of the selected files could be installed';
  return `Upload failed with status ${status}`;
}
