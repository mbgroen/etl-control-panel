import { Ban, Users as UsersIcon, UserX } from 'lucide-react';
import { Badge, Button, EmptyState } from './ui';
import { ColorText } from '../lib/etColors';
import type { Player } from '../lib/types';

/**
 * Who is on the server right now.
 *
 * One component for both places that show this, because they had already
 * drifted: the Overview called it "Connected players" and the Players page
 * called it "Playing now", and only one of them could kick anybody. Two
 * renderings of the same fact is how a control panel starts disagreeing with
 * itself.
 *
 * `full` is the version an operator works from — slot, score, ping and the
 * admin actions. `compact` is the glance on the landing page: names and how
 * they are doing, with the actions deliberately left out so the destructive
 * buttons live in exactly one place.
 */
export function LivePlayers({
  players,
  detailed,
  variant = 'full',
  running = true,
  onAction,
}: {
  players: Player[];
  /** rcon answered, so slots — and therefore kick and ban — are available. */
  detailed: boolean;
  variant?: 'full' | 'compact';
  running?: boolean;
  onAction?: (player: Player, action: 'kick' | 'ban') => void;
}) {
  const showActions = variant === 'full' && detailed && onAction !== undefined;

  if (players.length === 0) {
    return (
      <EmptyState
        icon={<UsersIcon size={26} aria-hidden />}
        title={running ? 'Nobody is playing right now' : 'The server is not running'}
        description={
          running
            ? 'Players appear here as soon as they connect.'
            : 'Start the server to accept connections.'
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
            {variant === 'full' && detailed && <th className="px-4 py-2 font-medium">Slot</th>}
            <th className="px-4 py-2 font-medium">Player</th>
            <th className="px-4 py-2 text-right font-medium">Score</th>
            <th className="px-4 py-2 text-right font-medium">Ping</th>
            {showActions && <th className="px-4 py-2 text-right font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {players.map((player, index) => (
            <tr
              key={`${player.slot ?? 'x'}-${player.nameClean}-${index}`}
              className="border-b border-line last:border-0 hover:bg-raised"
            >
              {variant === 'full' && detailed && (
                <td className="tabular px-4 py-2 text-faint">{player.slot}</td>
              )}
              <td className="px-4 py-2">
                <ColorText value={player.name} className="font-medium" />
                {player.address === 'bot' ? (
                  <Badge tone="neutral" className="ml-2">
                    bot
                  </Badge>
                ) : (
                  variant === 'full' &&
                  player.address && <span className="ml-2 text-[11px] text-faint">{player.address}</span>
                )}
              </td>
              <td className="tabular px-4 py-2 text-right">{player.score}</td>
              <td className="tabular px-4 py-2 text-right">
                <span className={pingClass(player.ping)}>
                  {player.ping === 0 ? '—' : `${player.ping}ms`}
                </span>
              </td>
              {showActions && (
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      icon={<UserX size={13} aria-hidden />}
                      onClick={() => onAction(player, 'kick')}
                    >
                      Kick
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Ban size={13} aria-hidden />}
                      onClick={() => onAction(player, 'ban')}
                    >
                      Ban
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A bot's ping is 0, which is not a good connection — it is no connection. */
function pingClass(ping: number): string {
  if (ping === 0) return 'text-faint';
  if (ping >= 150) return 'text-danger';
  if (ping >= 80) return 'text-warn';
  return 'text-success';
}
