import { KeyRound, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AccountPanel } from '../components/AccountPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Panel,
  PasswordInput,
  Input,
  Spinner,
} from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useToast } from '../lib/toast';
import type { AdminAccount } from '../lib/types';

/**
 * Administrator accounts.
 *
 * There are no roles. A dashboard that can restart the game server and holds
 * the Docker socket has one meaningful level of access, and inventing "viewer"
 * or "operator" tiers would imply a boundary this application cannot actually
 * enforce. What multiple accounts buy is that two people do not have to share
 * one password — so a departure means removing an account rather than changing
 * a secret and redistributing it.
 */
export function AccountsPage() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [managed, setManaged] = useState(false);
  const [minLength, setMinLength] = useState(8);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [adding, setAdding] = useState(false);

  const [pendingRemove, setPendingRemove] = useState<AdminAccount | null>(null);
  const [resetting, setResetting] = useState<AdminAccount | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, session] = await Promise.allSettled([api.auth.accounts(), api.auth.session()]);

    if (list.status === 'fulfilled') {
      setAccounts(list.value.accounts);
      setManaged(list.value.managedByEnvironment);
      setMinLength(list.value.minPasswordLength);
    } else {
      toast.error(
        'Could not load accounts',
        list.reason instanceof ApiError ? list.reason.message : 'Unexpected error',
      );
    }
    setMe(session.status === 'fulfilled' ? session.value.user.username : null);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setAdding(true);
    try {
      await api.auth.addAccount(username.trim(), password);
      toast.success(`${username.trim()} can now sign in`, 'Give them the password you just set.');
      setUsername('');
      setPassword('');
      await load();
    } catch (err) {
      toast.error('Could not add', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setAdding(false);
    }
  };

  const remove = async () => {
    if (!pendingRemove) return;
    setBusy(true);
    try {
      await api.auth.removeAccount(pendingRemove.id);
      toast.success(`${pendingRemove.username} removed`, 'Their sessions end when they expire.');
      await load();
    } catch (err) {
      toast.error('Could not remove', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
      setPendingRemove(null);
    }
  };

  const applyReset = async () => {
    if (!resetting) return;
    setBusy(true);
    try {
      await api.auth.resetAccountPassword(resetting.id, resetPassword);
      toast.success(`Password set for ${resetting.username}`);
      setResetPassword('');
      setResetting(null);
    } catch (err) {
      toast.error('Could not set', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading accounts" />;

  const canAdd = username.trim().length > 0 && password.length >= minLength && !managed;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={`Administrators (${accounts.length})`}
        description="Everyone here has full control of the server. There are no restricted roles."
        bodyClassName="p-0"
      >
        {managed && (
          <p className="border-b border-line px-4 py-2.5 text-xs text-warn">
            Accounts come from <code className="font-mono">ADMIN_PASSWORD_HASH</code> in the
            environment, so they cannot be managed here. Remove that variable to manage them from
            the dashboard instead.
          </p>
        )}

        {accounts.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<ShieldCheck size={26} aria-hidden />}
              title="No accounts"
              description="This should not happen while you are signed in — reload the page."
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {accounts.map((account) => {
              const isMe = account.username === me;
              return (
                <li key={account.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-body">
                      {account.username}
                      {isMe && <Badge tone="accent">you</Badge>}
                    </p>
                    <p className="text-xs text-muted">Added {formatDateTime(account.createdAt)}</p>
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<KeyRound size={13} aria-hidden />}
                    disabled={managed || isMe}
                    title={
                      isMe
                        ? 'Change your own password below, where the current one is required'
                        : `Set a new password for ${account.username}`
                    }
                    onClick={() => {
                      setResetting(account);
                      setResetPassword('');
                    }}
                  >
                    Set password
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={13} aria-hidden />}
                    disabled={managed || isMe || accounts.length <= 1}
                    aria-label={`Remove ${account.username}`}
                    title={
                      isMe
                        ? 'You cannot remove the account you are signed in with'
                        : accounts.length <= 1
                          ? 'This is the only account — add another first'
                          : `Remove ${account.username}`
                    }
                    onClick={() => setPendingRemove(account)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {!managed && (
        <Panel
          title="Add an administrator"
          description="A second account means nobody has to share a password."
        >
          <div className="flex max-w-md flex-col gap-4">
            <Field label="Username" htmlFor="new-username">
              <Input
                id="new-username"
                value={username}
                autoComplete="off"
                onChange={(event) => setUsername(event.target.value)}
                placeholder="e.g. jasper"
              />
            </Field>

            <Field
              label="Password"
              htmlFor="new-password"
              hint={`At least ${minLength} characters. They can change it themselves once signed in.`}
            >
              <PasswordInput
                id="new-password"
                value={password}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            <div>
              <Button
                variant="primary"
                icon={<UserPlus size={14} aria-hidden />}
                loading={adding}
                disabled={!canAdd}
                onClick={() => void add()}
              >
                Add administrator
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {/* Your own password stays here, beside the accounts it belongs with —
          and it asks for the current one, which the reset above does not. */}
      {me && <AccountPanel username={me} managedByEnvironment={managed} minPasswordLength={minLength} />}

      <ConfirmDialog
        open={pendingRemove !== null}
        tone="danger"
        title={`Remove ${pendingRemove?.username ?? ''}?`}
        description="They lose access at their next request. Nothing they configured is undone, and the account can be created again."
        confirmLabel="Remove"
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingRemove(null)}
      />

      <ConfirmDialog
        open={resetting !== null}
        tone="primary"
        title={`Set a new password for ${resetting?.username ?? ''}?`}
        description={
          <div className="flex flex-col gap-3">
            <span>
              They are not asked for the old one, so tell them the new password out of band. Their
              existing sessions stay valid until they expire.
            </span>
            <PasswordInput
              value={resetPassword}
              autoComplete="new-password"
              aria-label="New password"
              placeholder={`At least ${minLength} characters`}
              onChange={(event) => setResetPassword(event.target.value)}
            />
          </div>
        }
        confirmLabel="Set password"
        loading={busy}
        confirmDisabled={resetPassword.length < minLength}
        onConfirm={() => void applyReset()}
        onCancel={() => setResetting(null)}
      />
    </div>
  );
}
