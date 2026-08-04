import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { ApiError, asyncHandler } from '../http/errors.js';
import * as docker from '../services/docker.js';
import { history } from '../services/metrics.js';
import { poller } from '../services/poller.js';
import { parseRconStatus, rcon, RconError, stripColors } from '../services/q3protocol.js';

export const serverRouter = Router();

const target = { host: env.ETL_HOST, port: env.ETL_PORT, timeoutMs: env.RCON_TIMEOUT_MS };

/** Current aggregated state. Served from the poller's cache, never a live query. */
serverRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const snapshot = poller.current() ?? (await poller.refresh());
    if (!snapshot) throw new ApiError(503, 'not_ready', 'Status is not available yet');
    res.json(snapshot);
  }),
);

const lifecycleSchema = z.object({
  service: z.enum(['game', 'fastdl']).default('game'),
  action: z.enum(['start', 'stop', 'restart']),
});

serverRouter.post(
  '/lifecycle',
  asyncHandler(async (req, res) => {
    const { service, action } = lifecycleSchema.parse(req.body);
    await docker.lifecycle(service, action);

    // Give Docker a moment to settle so the refreshed snapshot reflects reality
    // rather than the transitional state.
    await new Promise((resolve) => setTimeout(resolve, 750));
    const snapshot = await poller.refresh();

    res.json({ ok: true, service, action, snapshot });
  }),
);

/**
 * Detailed player list via rcon `status`, which — unlike the public UDP query —
 * exposes slot numbers and addresses needed for kick and ban.
 */
serverRouter.get(
  '/players',
  asyncHandler(async (_req, res) => {
    const snapshot = poller.current();
    const publicPlayers = snapshot?.game.status.players ?? [];

    if (!env.RCON_PASSWORD) {
      res.json({ players: publicPlayers, detailed: false });
      return;
    }

    try {
      const output = await rcon(target, env.RCON_PASSWORD, 'status');
      const parsed = parseRconStatus(output);
      // Merge: rcon gives slot/address, the UDP query is the more reliable
      // source of score when a mod reformats the status table.
      const merged = parsed.players.map((player) => {
        const match = publicPlayers.find((p) => p.nameClean === player.nameClean);
        return { ...player, score: match?.score ?? player.score };
      });
      res.json({ players: merged, detailed: true, map: parsed.map });
    } catch (err) {
      if (err instanceof RconError) {
        res.json({ players: publicPlayers, detailed: false, rconError: err.message });
        return;
      }
      throw err;
    }
  }),
);

const playerActionSchema = z.object({
  slot: z.number().int().min(0).max(63),
  action: z.enum(['kick', 'ban', 'mute', 'unmute']),
  /** Kick/ban reason shown to the player. */
  reason: z.string().max(120).optional(),
});

serverRouter.post(
  '/players/action',
  asyncHandler(async (req, res) => {
    const { slot, action, reason } = playerActionSchema.parse(req.body);

    // Reasons are interpolated into an rcon command string, so anything that
    // could terminate the argument or chain another command is stripped.
    const safeReason = (reason ?? 'Removed by an administrator').replace(/["`;\r\n\\$]/g, '').trim();

    const command =
      action === 'kick'
        ? `clientkick ${slot}`
        : action === 'ban'
          ? `ban ${slot}`
          : action === 'mute'
            ? `mute ${slot}`
            : `unmute ${slot}`;

    const output = await rcon(target, env.RCON_PASSWORD, command);

    // A kick reason is delivered as a separate chat line; the engine's
    // clientkick takes no reason argument.
    if ((action === 'kick' || action === 'ban') && safeReason) {
      await rcon(target, env.RCON_PASSWORD, `say "${safeReason}"`).catch(() => undefined);
    }

    res.json({ ok: true, action, slot, output: stripColors(output) });
  }),
);

const historyQuerySchema = z.object({
  minutes: z.coerce.number().int().min(5).max(10_080).default(60),
  points: z.coerce.number().int().min(20).max(1_000).default(180),
});

serverRouter.get('/history', (req, res) => {
  const { minutes, points } = historyQuerySchema.parse(req.query);
  res.json({
    samples: history.query(minutes, points),
    summary: history.summary(minutes),
    windowMinutes: minutes,
  });
});
