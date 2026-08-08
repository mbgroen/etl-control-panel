import { CheckCircle2, CloudDownload, FileArchive, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Field,
  Input,
  Panel,
  Spinner,
  Stat,
  StatusDot,
  Toggle,
} from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';
import type { ConfigPayload, FastdlPayload } from '../lib/types';

/**
 * FastDL — how clients fetch maps they are missing.
 *
 * Its own destination rather than the lower half of the map library. The two
 * were on one screen because FastDL serves the same directory, but that is a
 * fact about the implementation, not about the work: installing maps happens
 * often, and setting up downloads happens roughly once.
 *
 * Every download cvar lives here, including the ones the enable button does not
 * touch. They used to be duplicated in a Downloads section on the Configuration
 * page, where editing the base URL silently disagreed with the state this page
 * reports — two screens claiming to own one setting, and the one people found
 * first was the one that did not run the container.
 */
export function FastdlPage() {
  const toast = useToast();
  const { refresh } = useLive();
  const [state, setState] = useState<FastdlPayload | null>(null);
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // The config is a separate concern and a separate failure: a server with no
    // etl_server.cfg yet still has a FastDL container to look at.
    api.config
      .get()
      .then(setConfig)
      .catch(() => setConfig(null));

    try {
      setState(await api.fastdl.get());
    } catch (err) {
      // Reaching FastDL needs the Docker socket, so this fails on a dashboard
      // running without it — a state the panel below explains rather than
      // leaving the page blank.
      setState(null);
      toast.error(
        'Could not load FastDL',
        err instanceof ApiError ? err.message : 'Unexpected error',
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spinner label="Loading FastDL" />;

  // Inspecting the FastDL container needs the Docker socket; editing the
  // download cvars does not. Losing the first must not take the second with it,
  // or this page becomes a dead end for settings that live nowhere else.
  if (!state) {
    return (
      <div className="flex flex-col gap-4">
        <Panel title="HTTP downloads (FastDL)">
          <p className="text-xs text-muted">
            Unavailable — the dashboard cannot reach the Docker daemon, which it needs to inspect
            and control the FastDL container. See Diagnostics for the fix. The settings below are
            read from the server config and still work.
          </p>
        </Panel>

        <TransferPanel config={config} onSaved={load} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="HTTP downloads"
          value={state.configured ? 'Enabled' : 'Disabled'}
          sub={state.configured ? 'Clients fetch over HTTP' : 'Slow in-game transfer only'}
          tone={state.configured ? 'success' : 'neutral'}
          icon={<CloudDownload size={17} aria-hidden />}
        />
        <Stat
          label="Web server"
          value={state.container.running ? 'Running' : 'Stopped'}
          sub={state.containerName}
          tone={state.container.running ? 'success' : 'neutral'}
          icon={<FileArchive size={17} aria-hidden />}
        />
        <Stat
          label="Served files"
          value={state.fileCount}
          sub={formatBytes(state.totalBytes)}
          icon={<CloudDownload size={17} aria-hidden />}
        />
      </div>

      <FastdlPanel
        state={state}
        onChanged={async () => {
          await load();
          await refresh();
        }}
      />

      <TransferPanel config={config} onSaved={load} />
    </div>
  );
}


/**
 * The download cvars the enable button does not set.
 *
 * Enabling FastDL writes sv_allowDownload, sv_wwwDownload, sv_wwwBaseURL and
 * sv_wwwDlDisconnected — those belong to the panel above and are not repeated
 * here. What is left is the fallback mirror and the limits on the slow in-game
 * transfer, which is what clients still use when FastDL is off or unreachable.
 */
function TransferPanel({
  config,
  onSaved,
}: {
  config: ConfigPayload | null;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const initial = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cvar of config?.cvars ?? []) map[cvar.key.toLowerCase()] = cvar.value;
    return {
      sv_allowDownload: map.sv_allowdownload ?? '1',
      sv_wwwFallbackURL: map.sv_wwwfallbackurl ?? '',
      sv_dlRate: map.sv_dlrate ?? '100',
      sv_dl_timeout: map.sv_dl_timeout ?? '240',
    };
  }, [config]);

  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(initial), [initial]);

  if (!config) {
    return (
      <Panel title="Transfer settings">
        <p className="text-xs text-muted">
          No server config yet. Create one on the Configuration page and these settings appear here.
        </p>
      </Panel>
    );
  }

  const changed = Object.entries(draft).filter(
    ([key, value]) => initial[key as keyof typeof initial] !== value,
  );

  const save = async () => {
    setSaving(true);
    try {
      await api.config.patch(Object.fromEntries(changed), config.revision, true);
      toast.success(`Saved ${changed.length} setting${changed.length === 1 ? '' : 's'}`);
      await onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof typeof draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Panel
      title="Transfer settings"
      description="The in-game fallback, used whenever HTTP downloads are off or a client cannot reach them."
      actions={
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          disabled={changed.length === 0}
          onClick={() => void save()}
        >
          {changed.length === 0 ? 'Saved' : `Save ${changed.length} change${changed.length === 1 ? '' : 's'}`}
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Toggle
            checked={draft.sv_allowDownload === '1'}
            onChange={(next) => set('sv_allowDownload')(next ? '1' : '0')}
            label="Allow downloads at all"
            description="Off means a player missing a map simply cannot join — not even over HTTP."
          />
        </div>

        <Field
          label="Fallback URL"
          htmlFor="fastdl-fallback"
          hint="A second HTTP mirror, tried when the base URL above fails for a client. Usually empty."
        >
          <Input
            id="fastdl-fallback"
            value={draft.sv_wwwFallbackURL}
            spellCheck={false}
            className="font-mono"
            placeholder="http://mirror.example.com"
            onChange={(event) => set('sv_wwwFallbackURL')(event.target.value)}
          />
        </Field>

        <Field
          label="In-game download rate"
          htmlFor="fastdl-rate"
          hint="KB/s for the built-in transfer. Does not affect HTTP downloads, which run at line speed."
        >
          <Input
            id="fastdl-rate"
            type="number"
            inputMode="numeric"
            min={0}
            max={10_000}
            value={draft.sv_dlRate}
            onChange={(event) => set('sv_dlRate')(event.target.value)}
          />
        </Field>

        <Field
          label="Download timeout"
          htmlFor="fastdl-timeout"
          hint="Seconds a downloading client may go quiet before it is dropped. Default 240."
        >
          <Input
            id="fastdl-timeout"
            type="number"
            inputMode="numeric"
            min={10}
            max={600}
            value={draft.sv_dl_timeout}
            onChange={(event) => set('sv_dl_timeout')(event.target.value)}
          />
        </Field>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function FastdlPanel({
  state,
  onChanged,
}: {
  state: FastdlPayload;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState(state.baseUrl || state.suggestedBaseUrl);
  const [disconnected, setDisconnected] = useState(false);
  const [busy, setBusy] = useState<'enable' | 'disable' | 'test' | null>(null);
  const [health, setHealth] = useState(state.health);

  useEffect(() => setBaseUrl(state.baseUrl || state.suggestedBaseUrl), [state.baseUrl, state.suggestedBaseUrl]);

  const enable = async () => {
    setBusy('enable');
    try {
      const result = await api.fastdl.enable(baseUrl, disconnected);
      toast.success('HTTP downloads enabled', result.note);
      await onChanged();
    } catch (err) {
      toast.error('Could not enable FastDL', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(null);
    }
  };

  const disable = async () => {
    setBusy('disable');
    try {
      await api.fastdl.disable(true);
      toast.success('HTTP downloads disabled', 'Clients will fall back to the in-game transfer.');
      setHealth(null);
      await onChanged();
    } catch (err) {
      toast.error('Could not disable FastDL', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const result = await api.fastdl.test(baseUrl);
      setHealth({ ok: result.ok, message: result.message, checkedAt: new Date().toISOString() });
      if (result.ok) {
        toast.success('FastDL is reachable', `Downloaded headers for ${result.testedFile}`);
      } else {
        toast.warning('FastDL test failed', result.message);
      }
    } catch (err) {
      toast.error('Test failed', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="HTTP downloads (FastDL)"
      description="Serves map packages to clients over HTTP instead of the slow in-game UDP transfer."
      actions={
        <Badge tone={state.configured ? 'success' : 'neutral'}>
          <StatusDot tone={state.configured ? 'success' : 'neutral'} pulse={state.configured} />
          {state.configured ? 'Enabled' : 'Disabled'}
        </Badge>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="flex flex-col gap-4">
          <Field
            label="Public base URL"
            htmlFor="fastdl-url"
            hint={
              <>
                The address <strong className="text-body">players</strong> can reach — not an internal
                Docker name. Clients request{' '}
                <code className="font-mono">{(baseUrl || 'http://host:8081').replace(/\/+$/, '')}/etmain/&lt;map&gt;.pk3</code>
                .
              </>
            }
          >
            <Input
              id="fastdl-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://192.168.1.10:8081"
              spellCheck={false}
              className="font-mono"
            />
          </Field>

          <Toggle
            checked={disconnected}
            onChange={setDisconnected}
            label="Allow downloads after disconnect"
            description="Lets clients keep downloading once they drop out. Leave off unless players report interrupted transfers."
          />

          {health && (
            <div
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                health.ok
                  ? 'border-success/40 bg-success-soft text-success'
                  : 'border-danger/40 bg-danger-soft text-danger'
              }`}
            >
              {health.ok ? (
                <CheckCircle2 size={14} className="mt-px shrink-0" aria-hidden />
              ) : (
                <XCircle size={14} className="mt-px shrink-0" aria-hidden />
              )}
              <span>{health.message}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {state.configured ? (
              <>
                <Button
                  variant="primary"
                  loading={busy === 'enable'}
                  disabled={!baseUrl.trim()}
                  onClick={() => void enable()}
                >
                  Update settings
                </Button>
                <Button variant="danger" loading={busy === 'disable'} onClick={() => void disable()}>
                  Disable
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                icon={<CloudDownload size={14} aria-hidden />}
                loading={busy === 'enable'}
                disabled={!baseUrl.trim()}
                onClick={() => void enable()}
              >
                Enable HTTP downloads
              </Button>
            )}
            <Button loading={busy === 'test'} disabled={!baseUrl.trim()} onClick={() => void test()}>
              Test connection
            </Button>
          </div>
        </div>

        <aside className="rounded-lg border border-line bg-sunken p-3 text-xs text-muted">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">How it works</p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-4">
            <li>The nginx sidecar serves your etmain directory read-only over HTTP.</li>
            <li>
              Enabling sets <code className="font-mono">sv_wwwDownload</code> and{' '}
              <code className="font-mono">sv_wwwBaseURL</code> in the server config.
            </li>
            <li>Clients missing a map fetch it over HTTP at full speed instead of ~100 KB/s.</li>
            <li>
              Publish the FastDL port through your router if players connect from the internet.
            </li>
          </ol>
        </aside>
      </div>
    </Panel>
  );
}
