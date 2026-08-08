/**
 * Generates the bcrypt hash for ADMIN_PASSWORD_HASH and a random SESSION_SECRET.
 *
 * Deliberately imports nothing from the app: it has to run *before* a valid
 * configuration exists, so pulling in `env.ts` (which exits on missing config)
 * would make it unusable for exactly the job it is meant to do.
 *
 *   docker compose run --rm --no-deps control panel node dist/cli/hashPassword.js
 */
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const COST = 12;

async function readPassword(): Promise<string> {
  const fromArgv = process.argv[2];
  if (fromArgv) return fromArgv;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('Choose a control panel password: ')).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const password = await readPassword();

  if (password.length < 12) {
    process.stderr.write('Password must be at least 12 characters.\n');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, COST);
  const secret = randomBytes(32).toString('hex');

  process.stdout.write(
    [
      '',
      'Add these to your .env file:',
      '',
      `ADMIN_PASSWORD_HASH=${hash}`,
      `SESSION_SECRET=${secret}`,
      '',
      'The hash contains $ characters. In a .env file consumed by Docker Compose,',
      'wrap it in single quotes if your shell performs variable expansion:',
      `ADMIN_PASSWORD_HASH='${hash}'`,
      '',
    ].join('\n'),
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
