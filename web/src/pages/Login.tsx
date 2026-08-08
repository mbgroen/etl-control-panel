import { LogIn, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { Button, Field, Input, PasswordInput } from '../components/ui';

/**
 * Sign-in screen.
 *
 * One job, one form, one primary action. The error message deliberately does
 * not distinguish a wrong username from a wrong password — that difference is
 * useful only to someone guessing.
 */
export function Login({ onSuccess }: { onSuccess: (username: string) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const { user } = await api.auth.login(username, password);
      onSuccess(user.username);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the control panel API. Is the container running?',
      );
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span
            className="mb-3 grid size-11 place-items-center rounded-xl bg-accent-solid text-base font-bold text-accent-on"
            aria-hidden
          >
            ET
          </span>
          <h1 className="text-lg font-semibold text-body">ET: Legacy Control Panel</h1>
          <p className="mt-1 text-[13px] text-muted">Sign in to manage your game server</p>
        </div>

        <form onSubmit={submit} className="card flex flex-col gap-4 p-5">
          <Field label="Username" htmlFor="username">
            <Input
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoFocus
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft p-2.5 text-xs text-danger"
              role="alert"
            >
              <ShieldAlert size={15} className="mt-px shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            loading={busy}
            icon={<LogIn size={15} aria-hidden />}
            className="h-10 w-full"
          >
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] text-faint">
          Locked out? Delete <code className="font-mono">credentials.json</code> from the control panel
          data directory to run setup again.
        </p>
      </div>
    </div>
  );
}
