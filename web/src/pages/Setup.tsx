import { Check, ShieldAlert, UserPlus, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Button, Field, Input, PasswordInput } from '../components/ui';
import { api, ApiError } from '../lib/api';

/**
 * First-run setup.
 *
 * Shown once, when no operator account exists yet. This is what removes the
 * "generate a bcrypt hash on the command line" step from installation, so the
 * whole deployment can be done from a web interface.
 *
 * The requirements are stated up front and validated live rather than rejected
 * on submit — being told your password is wrong only after you commit to it is
 * the most avoidable frustration in any sign-up form.
 */
export function Setup({ minPasswordLength, onComplete }: {
  minPasswordLength: number;
  onComplete: (username: string) => void;
}) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rules = useMemo(
    () => [
      { label: `At least ${minPasswordLength} characters`, met: password.length >= minPasswordLength },
      { label: 'Both entries match', met: password.length > 0 && password === confirm },
    ],
    [password, confirm, minPasswordLength],
  );

  const ready = rules.every((rule) => rule.met) && username.trim().length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;

    setError(null);
    setBusy(true);
    try {
      const { user } = await api.auth.setup(username.trim(), password);
      onComplete(user.username);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not reach the dashboard API.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span
            className="mb-3 grid size-11 place-items-center rounded-xl bg-accent-solid text-base font-bold text-accent-on"
            aria-hidden
          >
            ET
          </span>
          <h1 className="text-lg font-semibold text-body">Welcome — let's secure this dashboard</h1>
          <p className="mt-1 max-w-sm text-[13px] text-muted">
            Create the administrator account. This is the only account, and it controls your game
            server.
          </p>
        </div>

        <form onSubmit={submit} className="card flex flex-col gap-4 p-5">
          <div
            className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft p-2.5 text-xs text-warn"
            role="status"
          >
            <ShieldAlert size={15} className="mt-px shrink-0" aria-hidden />
            <span>
              Until you finish this step, anyone who can reach this page can claim the dashboard.
              Complete it now.
            </span>
          </div>

          <Field label="Username" htmlFor="setup-username">
            <Input
              id="setup-username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoFocus
            />
          </Field>

          <Field label="Password" htmlFor="setup-password">
            <PasswordInput
              id="setup-password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          <Field label="Confirm password" htmlFor="setup-confirm">
            <PasswordInput
              id="setup-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </Field>

          <ul className="flex flex-col gap-1" aria-label="Password requirements">
            {rules.map((rule) => (
              <li
                key={rule.label}
                className={`flex items-center gap-1.5 text-xs ${rule.met ? 'text-success' : 'text-muted'}`}
              >
                {/* Icon plus colour, never colour alone. */}
                {rule.met ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
                {rule.label}
                <span className="sr-only">{rule.met ? '(met)' : '(not met)'}</span>
              </li>
            ))}
          </ul>

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
            disabled={!ready}
            icon={<UserPlus size={15} aria-hidden />}
            className="h-10 w-full"
          >
            Create account and continue
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] text-faint">
          Stored as a bcrypt hash in your dashboard data directory. Forgot it later? Delete
          <code className="mx-1 font-mono">credentials.json</code> from that directory to start over.
        </p>
      </div>
    </div>
  );
}
