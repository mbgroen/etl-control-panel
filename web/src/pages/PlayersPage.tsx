import { Bot, Globe, House, RefreshCw, Server, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LivePlayers } from '../components/LivePlayers';
import { Button, EmptyState, Panel, Spinner, Toggle } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { countryLabel, flagFor, formatDuration } from '../lib/country';
import { formatDateTime, formatRelative } from '../lib/format';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';
import type { Player, PlayerSession, PlayerSessionsPayload } from '../lib/types';

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmBots, setConfirmBots] = useState(false);
  /**
   * Bots are hidden by default.
   *
   * A server running minbots writes dozens of bot visits a day, and the
   * question this page exists to answer — has anyone actually been playing
   * here? — is drowned by them. They are still one click away, because a
   * missing row is worse than a row you chose not to look at.
   */
  const [hideBots, setHideBots] = useState(true);
  const [busy, setBusy] = useState(false);
  /**
   * Kick and ban live here rather than on the Overview.
   *
   * This is the page about players, it is where someone goes when a player is
   * the problem, and it already has the visit history that says whether this is
   * a first offence. The Overview keeps a read-only glance.
   */
  const [live, setLive] = useState<{ players: Player[]; detailed: boolean }>({
    players: [],
    detailed: false,
  });
  const [pendingPlayer, setPendingPlayer] = useState<{
    player: Player;
    action: 'kick' | 'ban';
  } | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [sessions, status] = await Promise.all([
        api.server.sessions(),
        // Separate call because only this one carries slots, and slots are what
        // make kick and ban possible.
        api.server.players().catch(() => ({ players: [], detailed: false })),
      ]);
      setData(sessions);
      setLive({ players: status.players, detailed: status.detailed });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load player activity');
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = async (options: { all?: boolean; bots?: boolean }) => {
    setBusy(true);
    try {
      const { removed } = await api.server.deleteSessions(
        options.all ? { all: true } : options.bots ? { bots: true } : { ids: [...selected] },
      );
      setSelected(new Set());
      toast.success(`Deleted ${removed} visit${removed === 1 ? '' : 's'}`);
      await load();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
      setConfirmClear(false);
      setConfirmBots(false);
    }
  };

  const runPlayerAction = async () => {
    if (!pendingPlayer) return;
    const { player, action } = pendingPlayer;
    if (player.slot === null) return;

    setBusy(true);
    try {
      await api.server.playerAction(player.slot, action);
      toast.success(`${player.nameClean} was ${action === 'kick' ? 'kicked' : 'banned'}`);
      await load();
    } catch (err) {
      toast.error(
        `Could not ${action} player`,
        err instanceof ApiError ? err.message : 'Unexpected error',
      );
    } finally {
      setBusy(false);
      setPendingPlayer(null);
    }
  };

  // The engine reports a bot's address as the literal string "bot", so this is
  // the server's own answer rather than a guess from the name — which players
  // can and do copy.
  const botCount = data?.recent.filter((session) => session.addressKind === 'bot').length ?? 0;
  const visible = data
    ? hideBots
      ? data.recent.filter((session) => session.addressKind !== 'bot')
      : data.recent
    : [];

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
        title={`Playing now (${live.players.length})`}
        description={
          live.detailed
            ? 'Live from rcon — slot numbers are what make kick and ban possible.'
            : 'From the public status query. Set rconpassword to enable kick and ban.'
        }
        actions={
          <Button size="sm" icon={<RefreshCw size={13} aria-hidden />} onClick={() => void load()}>
            Refresh
          </Button>
        }
        bodyClassName="p-0"
      >
        <LivePlayers
          players={live.players}
          detailed={live.detailed}
          onAction={(player, action) => setPendingPlayer({ player, action })}
        />
      </Panel>

      <Panel
        title="Earlier visits"
        description="Finished sessions, most recent first. Kept across restarts, up to the limit set under Settings."
        actions={
          data && data.recent.length > 0 ? (
            selected.size > 0 ? (
              <>
                <span className="text-xs text-muted">{selected.size} selected</span>
                <Button size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy}
                  icon={<Trash2 size={13} aria-hidden />}
                  onClick={() => void remove({})}
                >
                  Delete
                </Button>
              </>
            ) : (
              <>
                {botCount > 0 && (
                  <Toggle
                    checked={hideBots}
                    onChange={setHideBots}
                    label="Hide bots"
                    description={`${botCount} bot visit${botCount === 1 ? '' : 's'}`}
                  />
                )}
                {botCount > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Bot size={13} aria-hidden />}
                    onClick={() => setConfirmBots(true)}
                  >
                    Delete bots
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
                  Clear history
                </Button>
              </>
            )
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {visible.length > 0 ? (
          <SessionTable sessions={visible} selected={selected} onToggle={(id) =>
            setSelected((current) => {
              const next = new Set(current);
              if (!next.delete(id)) next.add(id);
              return next;
            })
          } />
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<Users size={24} aria-hidden />}
              title={
                hideBots && botCount > 0 ? 'Only bots have played here' : 'No visits recorded yet'
              }
              description={
                hideBots && botCount > 0
                  ? `${botCount} bot visit${botCount === 1 ? ' is' : 's are'} hidden. Switch "Hide bots" off to see them.`
                  : 'A session is recorded once a player has been seen and then leaves.'
              }
            />
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={pendingPlayer !== null}
        title={pendingPlayer?.action === 'ban' ? 'Ban this player?' : 'Kick this player?'}
        description={
          pendingPlayer && (
            <>
              <strong className="text-body">{pendingPlayer.player.nameClean}</strong>{' '}
              {pendingPlayer.action === 'ban'
                ? 'will be disconnected and blocked from reconnecting. Removing a ban requires an rcon command.'
                : 'will be disconnected but can rejoin straight away.'}
            </>
          )
        }
        confirmLabel={pendingPlayer?.action === 'ban' ? 'Ban player' : 'Kick player'}
        loading={busy}
        onConfirm={() => void runPlayerAction()}
        onCancel={() => setPendingPlayer(null)}
      />

      <ConfirmDialog
        open={confirmBots}
        tone="danger"
        title={`Delete ${botCount} bot visit${botCount === 1 ? '' : 's'}?`}
        description="Only visits the server reported as bots. Human visits are untouched, and bots that are playing right now are not affected."
        confirmLabel="Delete bots"
        loading={busy}
        onConfirm={() => void remove({ bots: true })}
        onCancel={() => setConfirmBots(false)}
      />

      <ConfirmDialog
        open={confirmClear}
        tone="danger"
        title="Clear the whole visit history?"
        description="Every finished visit is removed. Players connected right now are unaffected, and new visits are recorded as usual."
        confirmLabel="Clear history"
        loading={busy}
        onConfirm={() => void remove({ all: true })}
        onCancel={() => setConfirmClear(false)}
      />
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

/** The visit history. Live players are LivePlayers, which knows about slots. */
function SessionTable({
  sessions,
  selected,
  onToggle,
}: {
  sessions: PlayerSession[];
  selected?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            {onToggle && <th scope="col" className="w-10 px-4 py-2" />}
            <th scope="col" className="px-4 py-2 font-medium">Player</th>
            <th scope="col" className="px-4 py-2 font-medium">From</th>
            <th scope="col" className="px-4 py-2 font-medium">Address</th>
            <th scope="col" className="px-4 py-2 font-medium">Joined</th>
            <th scope="col" className="px-4 py-2 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sessions.map((session) => (
            <tr key={session.id}>
              {onToggle && (
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected?.has(session.id) ?? false}
                    onChange={() => onToggle(session.id)}
                    className="size-4 accent-[var(--accent-solid)]"
                    aria-label={`Select the visit by ${session.nameClean || 'this player'}`}
                  />
                </td>
              )}
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2">
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
                <span className="text-muted">{formatDuration(session.seconds)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
