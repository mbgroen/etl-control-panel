import { env } from '../env.js';
import { cvarMap, readConfig } from './serverConfig.js';

/**
 * Where the control panel gets its rcon password.
 *
 * The password used to live only in RCON_PASSWORD, which made it a second copy
 * of a secret whose real home is the server config — and the control panel can edit
 * that config but not its own environment. Changing the password in the UI
 * therefore broke the console, and the console is exactly what you would need
 * to fix it. Operators hit this repeatedly and recovered by restoring a backup,
 * which "worked" only because it put the old password back.
 *
 * So the config file is the source of truth: it is what the game server itself
 * reads, which makes it the best predictor of what the server will accept.
 * RCON_PASSWORD remains as an override for deployments where the control panel
 * cannot see the config, or where the operator would rather keep the secret out
 * of a file the UI can display.
 */

export type RconSource = 'config' | 'environment' | 'none';

export interface RconCredential {
  password: string;
  source: RconSource;
  /**
   * True when RCON_PASSWORD is set to something other than the config's value.
   * The config wins, so this is reported rather than silently resolved — two
   * different secrets in play is worth telling the operator about.
   */
  environmentIgnored: boolean;
}

/**
 * Chooses between the two possible sources.
 *
 * Kept pure and exported so the precedence rules can be tested directly,
 * without a config file or an environment on disk.
 */
export function selectRconPassword(
  configPassword: string | undefined,
  environmentPassword: string,
): RconCredential {
  const fromConfig = (configPassword ?? '').trim();
  const fromEnvironment = environmentPassword.trim();

  if (fromConfig) {
    return {
      password: fromConfig,
      source: 'config',
      environmentIgnored: fromEnvironment !== '' && fromEnvironment !== fromConfig,
    };
  }

  if (fromEnvironment) {
    return { password: fromEnvironment, source: 'environment', environmentIgnored: false };
  }

  return { password: '', source: 'none', environmentIgnored: false };
}

/** Reads the current config and resolves the password the control panel should use. */
export async function resolveRconPassword(): Promise<RconCredential> {
  // A missing or unreadable config is normal on a fresh install, and must not
  // stop the environment override from working.
  const snapshot = await readConfig().catch(() => null);
  const configPassword = snapshot ? cvarMap(snapshot.content).rconpassword : undefined;
  return selectRconPassword(configPassword, env.RCON_PASSWORD);
}

/**
 * Characters that cannot be sent safely inside a quoted rcon argument.
 *
 * A double quote ends the argument early and a semicolon or newline starts a
 * new console command, so a password containing either would be applied as
 * something other than what was written. Such a password is still perfectly
 * usable — it just cannot be handed over live, so the caller falls back to
 * telling the operator to restart the server.
 */
const UNSAFE_IN_RCON_ARGUMENT = /["\n;]/;

export function canSendAsRconArgument(value: string): boolean {
  return !UNSAFE_IN_RCON_ARGUMENT.test(value);
}
