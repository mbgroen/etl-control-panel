import { Bot, Globe, House, RefreshCw, Server, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Panel, Spinner, StatusDot } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { countryLabel, flagFor, formatDuration } from '../lib/country';
import { formatDateTime, formatRelative } from '../lib/format';
import { useLive } from '../lib/live';
import type { PlayerSession, PlayerSessionsPayload } from '../lib/types';

/**
 * Who plays here.
 *
 * The game server answers only for the players connected this instant, so
 * without this page an operator running a public server has no way to know
 * whether anyone used it overnight. Two tables answer two different questions —
 * "who is on now" and "who has been on" — and are kept apart rather than merged
 * into one list with a status column, because the first is watched live and the
 * second is read after the fact.
 */
export function PlayersPage() {
  const { snapshot } = useLive();
  const [data, setData] = useState<PlayerSessionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.server.sessions());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load player activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refreshed off the live snapshot: the poller is what advances these
  // sessions, so there is no reason to keep a second timer of our own.
  useEffect(() => {
    void load();
  }, [load, snapshot?.updatedAt]);

  if (loading && !data) return <Spinner label="Loading player activity" />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {data && <SummaryRow summary={data.summary} online={data.current.length} />}

      <Panel
        title={`Playing now (${data?.current.length ?? 0})`}
        description="Updates with each status poll."
        actions={
          <Button size="sm" icon={<RefreshCw size={13} aria-hidden />} onClick={() => void load()}>
            Refresh
          </Button>
        }
        bodyClassName="p-0"
      >
        {data && data.current.length > 0 ? (
          <SessionTable sessions={data.current} live />
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<Users size={24} aria-hidden />}
              title="Nobody is playing"
              description="Anyone who connects appears here, with how long they have been on and where they are connecting from."
            />
          </div>
        )}
      </Panel>

      <Panel
        title="Earlier visits"
        description="Finished sessions, most recent first. Kept across restarts."
        bodyClassName="p-0"
      >
        {data && data.recent.length > 0 ? (
          <SessionTable sessions={data.recent} />
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<Users size={24} aria-hidden />}
              title="No visits recorded yet"
              description="A session is recorded once a player has been seen and then leaves."
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

function SummaryRow({
  summary,
  online,
}: {
  summary: PlayerSessionsPayload['summary'];
  online: number;
}) {
  const top = summary.countries.slice(0, 6);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Playing now" value={String(online)} />
      <Stat label="Visits recorded" value={String(summary.totalSessions)} />
      <Stat label="Distinct names" value={String(summary.uniquePlayers)} />

      {top.length > 0 && (
        <div className="card p-4 sm:col-span-3">
          <p className="text-xs font-medium text-muted">Where players connect from</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {top.map((country) => (
              <li key={country.code} className="flex items-center gap-1.5 text-[13px] text-body">
                <span aria-hidden className="text-base leading-none">
                  {flagFor(country.code) ?? '🏳️'}
                </span>
                <span>{country.name ?? country.code}</span>
                <span className="text-muted">{country.sessions}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-body">{value}</p>
    </div>
  );
}

function OriginCell({ session }: { session: PlayerSession }) {
  const label = countryLabel(session.countryCode, session.countryName, session.addressKind);

  const icon =
    label.icon === 'home' ? (
      <House size={14} className="text-muted" aria-hidden />
    ) : label.icon === 'server' ? (
      <Server size={14} className="text-muted" aria-hidden />
    ) : label.icon === 'bot' ? (
      <Bot size={14} className="text-muted" aria-hidden />
    ) : label.icon === 'unknown' ? (
      <Globe size={14} className="text-faint" aria-hidden />
    ) : null;

  return (
    <span className="flex items-center gap-1.5" title={label.title}>
      {label.flag ? (
        <span aria-hidden className="text-base leading-none">
          {label.flag}
        </span>
      ) : (
        icon
      )}
      <span className={label.flag ? 'text-body' : 'text-muted'}>{label.text}</span>
    </span>
  );
}

function SessionTable({ sessions, live = false }: { sessions: PlayerSession[]; live?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Player</th>
            <th scope="col" className="px-4 py-2 font-medium">From</th>
            <th scope="col" className="px-4 py-2 font-medium">Address</th>
            <th scope="col" className="px-4 py-2 font-medium">{live ? 'Connected' : 'Joined'}</th>
            <th scope="col" className="px-4 py-2 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sessions.map((session) => (
            <tr key={session.id}>
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2">
                  {live && <StatusDot tone="success" pulse />}
                  <span className="font-medium text-body">{session.nameClean || '(no name)'}</span>
                </span>
              </td>
              <td className="px-4 py-2.5">
                <OriginCell session={session} />
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-muted">
                {session.address ?? <span title="RCON is needed to see addresses">—</span>}
              </td>
              <td className="px-4 py-2.5 text-muted" title={formatDateTime(session.joinedAt)}>
                {formatRelative(session.joinedAt)}
              </td>
              <td className="px-4 py-2.5">
                {live ? (
                  <Badge tone="success">{formatDuration(session.seconds)}</Badge>
                ) : (
                  <span className="text-muted">{formatDuration(session.seconds)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
