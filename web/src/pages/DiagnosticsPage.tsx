import { CheckCircle2, RefreshCw, Wrench, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AccountPanel } from '../components/AccountPanel';
import { Badge, Button, Panel, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDuration } from '../lib/format';
import { useLive } from '../lib/live';
import type { HealthCheck, SystemInfo } from '../lib/types';

/**
 * Diagnostics.
 *
 * Exists because every misconfiguration of this stack — unmounted socket, wrong
 * data path, missing rcon password — looks identical from the rest of the UI:
 * things simply do not work. Each check states what is wrong *and* what to do,
 * so troubleshooting does not require reading the source.
 */
export function DiagnosticsPage() {
  const { snapshot } = useLive();
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [account, setAccount] = useState<{ username: string; managedByEnvironment: boolean } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    // Each panel loads independently. Sharing one try/catch meant a single
    // failing request blanked every panel on the page — including the runtime
    // configuration, which needs nothing from the health checks.
    const [health, systemInfo, session] = await Promise.allSettled([
      api.system.health(),
      api.system.info(),
      api.auth.session(),
    ]);

    if (health.status === 'fulfilled') {
      setChecks(health.value.checks);
    } else {
      setChecks(null);
      setLoadError(
        health.reason instanceof ApiError
          ? health.reason.message
          : 'The dashboard could not reach its own API.',
      );
    }

    setInfo(systemInfo.status === 'fulfilled' ? systemInfo.value : null);
    setAccount(
      session.status === 'fulfilled'
        ? {
            username: session.value.user.username,
            managedByEnvironment: session.value.managedByEnvironment ?? false,
          }
        : null,
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !checks) return <Spinner label="Running checks" />;

  const failing = checks?.filter((check) => !check.ok && !check.optional).length ?? 0;

  // "No failures" and "no results" are different things. Counting a failed load
  // as zero failures reported a green all-clear on a page that had loaded
  // nothing, which is the most misleading state this screen could be in.
  const description = !checks
    ? (loadError ?? 'The checks could not be loaded.')
    : failing === 0
      ? 'Everything the dashboard needs is available.'
      : `${failing} check${failing === 1 ? '' : 's'} need attention.`;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="System checks"
        description={description}
        actions={
          <Button size="sm" icon={<RefreshCw size={13} aria-hidden />} onClick={() => void load()}>
            Re-run
          </Button>
        }
        bodyClassName="p-0"
      >
        {!checks && (
          <p className="px-4 py-3 text-xs text-danger">
            No results to show. Re-run the checks, and if this persists look at the dashboard
            container logs.
          </p>
        )}
        <ul className="divide-y divide-line">
          {(checks ?? []).map((check) => (
            <li key={check.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 shrink-0" aria-hidden>
                {check.ok ? (
                  <CheckCircle2 size={17} className="text-success" />
                ) : check.optional ? (
                  <XCircle size={17} className="text-faint" />
                ) : (
                  <XCircle size={17} className="text-danger" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium text-body">{check.label}</p>
                  <Badge tone={check.ok ? 'success' : check.optional ? 'neutral' : 'danger'}>
                    {check.ok ? 'OK' : check.optional ? 'Not configured' : 'Problem'}
                  </Badge>
                </div>
                <p className="mt-0.5 break-words text-xs text-muted">{check.detail}</p>

                {check.remedy && (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-line bg-sunken px-2.5 py-1.5 text-xs text-muted">
                    <Wrench size={12} className="mt-0.5 shrink-0" aria-hidden />
                    <span>{check.remedy}</span>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {account && (
        <AccountPanel
          username={account.username}
          managedByEnvironment={account.managedByEnvironment}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Runtime configuration" bodyClassName="p-0">
          <dl className="divide-y divide-line text-[13px]">
            <Row label="Dashboard version" value={info?.version ?? '—'} />
            <Row label="Game container" value={info?.gameServer.container ?? '—'} mono />
            <Row
              label="Query address"
              value={info ? `${info.gameServer.host}:${info.gameServer.port}` : '—'}
              mono
            />
            <Row label="FastDL container" value={info?.fastdl.container ?? '—'} mono />
            <Row label="etmain path" value={info?.paths.etmain ?? '—'} mono />
            <Row label="Config file" value={info?.paths.config ?? '—'} mono />
            <Row label="Poll interval" value={info ? `${info.pollIntervalSec}s` : '—'} />
            <Row label="Upload limit" value={info ? `${info.limits.maxUploadMb} MB` : '—'} />
            <Row
              label="RCON"
              value={info?.rconConfigured ? 'Configured' : 'Not configured'}
            />
          </dl>
        </Panel>

        <Panel title="Containers" bodyClassName="p-0">
          <dl className="divide-y divide-line text-[13px]">
            <Row label="Game — status" value={snapshot?.game.container.status ?? '—'} />
            <Row label="Game — image" value={snapshot?.game.container.image ?? '—'} mono />
            <Row label="Game — uptime" value={formatDuration(snapshot?.game.container.uptimeSec ?? null)} />
            <Row
              label="Game — restarts"
              value={String(snapshot?.game.container.restartCount ?? 0)}
            />
            <Row label="FastDL — status" value={snapshot?.fastdl.container.status ?? '—'} />
            <Row label="FastDL — image" value={snapshot?.fastdl.container.image || '—'} mono />
            <Row
              label="Docker daemon"
              value={snapshot?.docker.ok ? 'Connected' : (snapshot?.docker.error ?? 'Unknown')}
            />
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`min-w-0 break-all text-right text-body ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
