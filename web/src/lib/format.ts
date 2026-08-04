/** Presentation helpers. Formatting lives here so the same value never renders
 *  two different ways on two different screens. */

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : decimals)} ${units[exponent]}`;
}

/** Compact duration: "3d 4h", "12m 08s". Chosen over "3 days ago" because an
 *  operator reading an uptime wants magnitude at a glance, not prose. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';

  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = Math.floor(seconds % 60);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const delta = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3_600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3_600)}h ago`;
  return `${Math.floor(delta / 86_400)}d ago`;
}

export function formatClock(iso: string | number): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Turns "goldrush" into "Goldrush", "mp_beach" into "MP Beach". */
export function prettifyMapName(name: string): string {
  if (!name) return 'Unknown';
  return name
    .replace(/^mp_/i, 'MP ')
    .split(/[_\s]+/)
    .map((part) => (part.length <= 2 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/** Ping thresholds tuned for ET, where >150ms is already a noticeable handicap. */
export function pingTone(ping: number): 'success' | 'warn' | 'danger' {
  if (ping <= 0) return 'success';
  if (ping < 80) return 'success';
  if (ping < 150) return 'warn';
  return 'danger';
}
