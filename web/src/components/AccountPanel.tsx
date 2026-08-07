import { KeyRound, Lock } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useToast } from '../lib/toast';
import { Button, Field, Panel, PasswordInput } from './ui';

/**
 * Password change for the operator account.
 *
 * Hidden entirely when credentials come from the environment: offering a form
 * that cannot succeed is worse than offering nothing, so the panel explains
 * where to change it instead.
 */
export function AccountPanel({
  username,
  managedByEnvironment,
  minPasswordLength = 8,
}: {
  username: string;
  managedByEnvironment: boolean;
  minPasswordLength?: number;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const problems = useMemo(() => {
    const list: string[] = [];
    if (next && next.length < minPasswordLength) {
      list.push(`New password must be at least ${minPasswordLength} characters`);
    }
    if (confirm && next !== confirm) list.push('The new passwords do not match');
    return list;
  }, [next, confirm, minPasswordLength]);

  const ready =
    current.length > 0 && next.length >= minPasswordLength && next === confirm && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;

    setBusy(true);
    try {
      await api.auth.changePassword(current, next);
      toast.success('Password changed', 'Your session stays active on this device.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      toast.error(
        'Could not change the password',
        err instanceof ApiError ? err.message : 'Unexpected error',
      );
    } finally {
      setBusy(false);
    }
  };

  if (managedByEnvironment) {
    return (
      <Panel title="Account" description={`Signed in as ${username}`}>
        <p className="flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-muted">
          <Lock size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Credentials are set through <code className="font-mono">ADMIN_PASSWORD_HASH</code> in the
            container environment, so they cannot be changed here. Update that value and recreate the
            container.
          </span>
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Account" description={`Signed in as ${username}`}>
      <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
        <Field label="Current password" htmlFor="pw-current">
          <PasswordInput
            id="pw-current"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>

        <Field label="New password" htmlFor="pw-new" hint={`At least ${minPasswordLength} characters`}>
          <PasswordInput
            id="pw-new"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </Field>

        <Field
          label="Confirm new password"
          htmlFor="pw-confirm"
          error={problems[0]}
        >
          <PasswordInput
            id="pw-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>

        <div>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!ready}
            icon={<KeyRound size={14} aria-hidden />}
          >
            Change password
          </Button>
        </div>
      </form>
    </Panel>
  );
}
