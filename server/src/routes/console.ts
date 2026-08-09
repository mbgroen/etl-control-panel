import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../env.js';
import { ApiError, asyncHandler } from '../http/errors.js';
import { logger } from '../logger.js';
import { rcon, stripColors } from '../services/q3protocol.js';
import { resolveRconPassword } from '../services/rconCredentials.js';

export const consoleRouter = Router();

const target = { host: env.ETL_HOST, port: env.ETL_PORT, timeoutMs: env.RCON_TIMEOUT_MS };

/**
 * rcon is UDP and single-threaded on the game server; a flood of commands will
 * stall the server tick for real players. This cap is generous for a human at a
 * keyboard and protective against a runaway script.
 */
const consoleLimiter = rateLimit({
  windowMs: 60 * 1_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Slow down — too many rcon commands.' } },
});

const commandSchema = z.object({
  command: z
    .string()
    .min(1, 'Command cannot be empty')
    .max(480, 'Command is too long for a single rcon packet')
    // Control characters would split the UDP packet or corrupt the command.
    .refine((v) => !/[\r\n\0]/.test(v), 'Command cannot contain line breaks'),
});

/**
 * Commands that would take the server down or lock the operator out. They are
 * blocked because the control panel has a safe, reversible path for each of them
 * (the lifecycle controls and the config editor), and an accidental `quit`
 * typed into a console leaves no way back in from the browser.
 */
const BLOCKED = [
  { pattern: /^\s*quit\b/i, hint: 'Use the Stop control instead — it shuts the container down cleanly.' },
  { pattern: /^\s*killserver\b/i, hint: 'Use the Stop control instead.' },
  {
    pattern: /^\s*set\s+rconpassword\b/i,
    hint: 'Change rconpassword in Configuration, so the control panel credential stays in sync.',
  },
];

consoleRouter.post(
  '/rcon',
  consoleLimiter,
  asyncHandler(async (req, res) => {
    const { command } = commandSchema.parse(req.body);

    const blocked = BLOCKED.find((rule) => rule.pattern.test(command));
    if (blocked) {
      throw new ApiError(403, 'command_blocked', blocked.hint);
    }

    const credential = await resolveRconPassword();
    if (credential.source === 'none') {
      throw new ApiError(
        503,
        'rcon_no_password',
        'No rcon password is set. Add one on the Configuration page and the console starts working immediately.',
      );
    }

    const startedAt = Date.now();
    const output = await rcon(target, credential.password, command);

    // The command itself is logged; its output is not, since `status` and
    // friends contain player IP addresses.
    logger.info({ command, ms: Date.now() - startedAt, user: req.user?.username }, 'rcon command executed');

    res.json({
      command,
      output,
      outputPlain: stripColors(output),
      durationMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  }),
);

/**
 * Curated commands surfaced as one-click actions in the console UI, so the
 * common operations do not require memorising engine cvars.
 */
consoleRouter.get('/commands', asyncHandler(async (_req, res) => {
  const credential = await resolveRconPassword();
  res.json({
    available: credential.source !== 'none',
    /**
     * Grouped by subject, not by whether a command reads or writes.
     *
     * A read/write split sounds tidier and duplicates every subject: bots would
     * need an entry under information and another under actions, and an
     * operator with a bot problem would have to look in both. What a command
     * does is already visible per item — the destructive ones carry a badge —
     * so the grouping is free to answer the question people actually arrive
     * with, which is "what is this about".
     *
     * Within a group: read-only first, then changes, destructive last.
     */
    groups: [
      {
        name: 'Server',
        commands: [
          { label: 'Player status', command: 'status', danger: false },
          { label: 'Server info', command: 'serverinfo', danger: false },
          { label: 'Cvar dump', command: 'cvarlist', danger: false },
          { label: 'Reload config', command: `exec ${env.SERVER_CONFIG_NAME}`, danger: false },
        ],
      },
      {
        name: 'Match & maps',
        commands: [
          { label: 'Loaded maps', command: 'dir maps bsp', danger: false },
          { label: 'Restart map', command: 'map_restart', danger: false },
          { label: 'Next map', command: 'vstr nextmap', danger: false },
          { label: 'Reset match', command: 'ref resetmatch', danger: true },
          { label: 'Shuffle teams', command: 'ref shuffleteamsxp', danger: true },
        ],
      },
      {
        // Omni-bot ships inside the game image, so these work on any install
        // once omnibot_enable is on. The counts take a number rather than
        // offering three guesses at what an operator wanted.
        name: 'Bots',
        commands: [
          { label: 'Bot status', command: 'bot', danger: false },
          { label: 'Are bots enabled?', command: 'omnibot_enable', danger: false },
          {
            label: 'Minimum bots',
            command: 'bot minbots',
            danger: false,
            input: { kind: 'number' as const, defaultValue: 4, min: 0, max: 32 },
          },
          {
            label: 'Maximum bots',
            command: 'bot maxbots',
            danger: false,
            input: { kind: 'number' as const, defaultValue: 10, min: 0, max: 32 },
          },
          { label: 'Balance bot teams', command: 'bot balanceteams 1', danger: false },
          { label: 'Remove all bots', command: 'bot kickall', danger: true },
        ],
      },
    ],
  });
}));
