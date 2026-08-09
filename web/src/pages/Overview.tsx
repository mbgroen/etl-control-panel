import {
  Cpu,
  Gauge,
  MapPin,
  MemoryStick,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Timer,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ActivityChart } from '../components/ActivityChart';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Badge, Button, Panel, Spinner, Stat, StatusDot } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { ColorText } from '../lib/etColors';
import { formatBytes, formatDuration, formatRelative, prettifyMapName } from '../lib/format';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';
import type { HistoryPayload } from '../lib/types';

/**
 * Overview — the screen that answers "is everything fine?" without scrolling.
 *
 * Information hierarchy, top to bottom: state (is it up), capacity (who is on),
 * trend (what has it been doing), detail (who exactly). Controls sit next to
 * the state they change rather than in a separate toolbar.
 */

const WINDOWS = [
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1_440 },
] as const;

export function Overview() {
  const { snapshot, refresh } = useLive();
  const toast = useToast();

  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [windowMinutes, setWindowMinutes] = useState<number>(60);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pendingStop, setPendingStop] = useState(false);

  const container = snapshot?.game.container;
  const status = snapshot?.game.status;
  const resources = snapshot?.game.resources;
  const running = container?.running ?? false;

  const loadHistory = useCallback(async (minutes: number) => {
    try {
      setHistory(await api.server.history(minutes));
    } catch {
      // Non-critical: the rest of the page is still useful without the trend.
    }
  }, []);

  useEffect(() => {
    void loadHistory(windowMinutes);
  }, [windowMinutes, loadHistory]);

  // Keep the trend fresh without re-fetching on every status push.
  useEffect(() => {
    const timer = window.setInterval(() => void loadHistory(windowMinutes), 30_000);
    return () => window.clearInterval(timer);
  }, [windowMinutes, loadHistory]);

  const runLifecycle = async (action: 'start' | 'stop' | 'restart') => {
    setBusyAction(action);
    try {
      await api.server.lifecycle('game', action);
      await refresh();
      toast.success(
        action === 'start' ? 'Server starting' : action === 'stop' ? 'Server stopped' : 'Server restarting',
        action === 'stop' ? undefined : 'It may take a few seconds to appear in the browser list.',
      );
    } catch (err) {
      toast.error(
        `Could not ${action} the server`,
        err instanceof ApiError ? err.message : 'Unexpected error',
      );
    } finally {
      setBusyAction(null);
      setPendingStop(false);
    }
  };

  if (!snapshot) return <Spinner label="Reading server status" />;

  const playerCount = status?.players.length ?? 0;
  const maxClients = status?.maxClients ?? 0;
  const publicSlots = Math.max(0, maxClients - (status?.privateClients ?? 0));
  const occupancy = publicSlots > 0 ? playerCount / publicSlots : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* --- State & controls ------------------------------------------- */}
      <Panel bodyClassName="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {status?.hostname ? (
                <ColorText value={status.hostname} className="text-base font-semibold" />
              ) : (
                <span className="text-base font-semibold text-muted">
                  {container?.exists ? 'Server not responding' : 'Container not found'}
                </span>
              )}
              <Badge tone={running ? 'success' : 'danger'}>
                <StatusDot tone={running ? 'success' : 'danger'} pulse={running} />
                {container?.status ?? 'unknown'}
              </Badge>
              {status?.needPass && <Badge tone="warn">Password protected</Badge>}
            </div>

            <p className="mt-1.5 text-xs text-muted">
              {status?.online ? (
                <>
                  {status.gametype} · {status.version || 'ET: Legacy'}
                  {status.latencyMs !== null && <> · responded in {status.latencyMs}ms</>}
                </>
              ) : (
                (status?.error ?? 'The game server is not answering status queries.')
              )}
              {' · '}
              updated {formatRelative(snapshot.updatedAt)}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              icon={<RefreshCw size={14} aria-hidden />}
              onClick={() => void refresh()}
              aria-label="Refresh status"
            />
            {running ? (
              <>
                <Button
                  icon={<RotateCcw size={14} aria-hidden />}
                  loading={busyAction === 'restart'}
                  onClick={() => void runLifecycle('restart')}
                >
                  Restart
                </Button>
                <Button
                  variant="danger"
                  icon={<Square size={14} aria-hidden />}
                  onClick={() => setPendingStop(true)}
                >
                  Stop
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                icon={<Play size={14} aria-hidden />}
                loading={busyAction === 'start'}
                disabled={!container?.exists}
                onClick={() => void runLifecycle('start')}
              >
                Start server
              </Button>
            )}
          </div>
        </div>

        {!snapshot.docker.ok && (
          <p className="mt-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
            Docker is unreachable, so container controls are disabled. {snapshot.docker.error}
          </p>
        )}
      </Panel>

      {/* --- Key figures ------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Players"
          value={`${playerCount} / ${publicSlots || '—'}`}
          sub={maxClients ? `${status?.privateClients ?? 0} private slots` : 'Server offline'}
          tone={occupancy >= 0.9 ? 'warn' : playerCount > 0 ? 'success' : 'neutral'}
          icon={<Users size={17} aria-hidden />}
        />
        <Stat
          label="Current map"
          value={prettifyMapName(status?.map ?? '')}
          sub={status?.gametype || '—'}
          icon={<MapPin size={17} aria-hidden />}
        />
        <Stat
          label="Uptime"
          value={formatDuration(container?.uptimeSec ?? null)}
          sub={container?.restartCount ? `${container.restartCount} restarts` : 'No restarts'}
          icon={<Timer size={17} aria-hidden />}
        />
        <Stat
          label="CPU"
          value={resources ? `${resources.cpuPercent.toFixed(1)}%` : '—'}
          sub={running ? 'Container usage' : 'Not running'}
          tone={resources && resources.cpuPercent > 80 ? 'warn' : 'neutral'}
          icon={<Cpu size={17} aria-hidden />}
        />
        <Stat
          label="Memory"
          value={resources ? formatBytes(resources.memoryBytes) : '—'}
          sub={
            resources && resources.memoryLimitBytes > 0
              ? `${resources.memoryPercent.toFixed(0)}% of ${formatBytes(resources.memoryLimitBytes)}`
              : 'No limit set'
          }
          icon={<MemoryStick size={17} aria-hidden />}
        />
      </div>

      {/* --- Trends ------------------------------------------------------ */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Players online"
          description={
            history
              ? `Peak ${history.summary.peakPlayers} · average ${history.summary.avgPlayers} · ${history.summary.uptimePercent}% reachable`
              : undefined
          }
          actions={
            <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Time range">
              {WINDOWS.map(({ label, minutes }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setWindowMinutes(minutes)}
                  aria-pressed={windowMinutes === minutes}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                    windowMinutes === minutes
                      ? 'bg-accent-soft text-accent'
                      : 'text-muted hover:text-body'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
          bodyClassName="p-3"
        >
          <ActivityChart
            samples={history?.samples ?? []}
            metric="players"
            color="var(--accent)"
            domainMax={Math.max(maxClients || 8, ...(history?.samples.map((s) => s.players) ?? [0]))}
          />
        </Panel>

        <Panel title="CPU usage" description="Game server container" bodyClassName="p-3">
          <ActivityChart
            samples={history?.samples ?? []}
            metric="cpuPercent"
            color="var(--info)"
            unit="%"
          />
        </Panel>
      </div>

      {/* --- FastDL summary ---------------------------------------------- */}
      <Panel title="Map downloads (FastDL)" bodyClassName="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Gauge size={17} className={snapshot.fastdl.configured ? 'text-success' : 'text-faint'} aria-hidden />
            <div>
              <p className="text-[13px] font-medium text-body">
                {snapshot.fastdl.configured ? 'HTTP downloads enabled' : 'HTTP downloads disabled'}
              </p>
              <p className="text-xs text-muted">
                {snapshot.fastdl.configured
                  ? (snapshot.fastdl.baseUrl || 'No base URL set')
                  : 'Clients fall back to the slow in-game transfer for custom maps.'}
              </p>
            </div>
          </div>
          <Badge tone={snapshot.fastdl.container.running ? 'success' : 'neutral'}>
            <StatusDot tone={snapshot.fastdl.container.running ? 'success' : 'neutral'} />
            Web server {snapshot.fastdl.container.running ? 'running' : 'stopped'}
          </Badge>
        </div>
      </Panel>

      <ConfirmDialog
        open={pendingStop}
        title="Stop the game server?"
        description={
          playerCount > 0
            ? `${playerCount} player${playerCount === 1 ? ' is' : 's are'} connected and will be disconnected immediately.`
            : 'The server will go offline and disappear from the public server list.'
        }
        confirmLabel="Stop server"
        loading={busyAction === 'stop'}
        onConfirm={() => void runLifecycle('stop')}
        onCancel={() => setPendingStop(false)}
      />

    </div>
  );
}
