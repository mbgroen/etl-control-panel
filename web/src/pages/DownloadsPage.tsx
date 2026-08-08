import {
  Check,
  Plus,
  CheckCircle2,
  CloudDownload,
  FileArchive,
  HardDrive,
  Lock,
  Package,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Panel,
  Spinner,
  Stat,
  StatusDot,
  Toggle,
} from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';
import type { FastdlPayload, MapPackage, MapsPayload, SystemInfo } from '../lib/types';

/**
 * Map packages and HTTP downloads.
 *
 * These live on one page because they are one job: getting custom content onto
 * players' machines. Splitting the pk3 library from the web server that serves
 * it would hide the cause-and-effect that makes FastDL comprehensible.
 */
export function DownloadsPage() {
  const toast = useToast();
  const { refresh } = useLive();

  const [maps, setMaps] = useState<MapsPayload | null>(null);
  const [fastdl, setFastdl] = useState<FastdlPayload | null>(null);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<MapPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [rotationBusy, setRotationBusy] = useState<string | null>(null);
  const [inRotation, setInRotation] = useState<Set<string>>(new Set());

  // The rotation lives in the server config rather than in the map list, so it
  // is fetched here purely to mark which maps are already scheduled. A tick
  // beside the name is far cheaper than sending someone to another page to
  // check, which is what this workflow used to require.
  useEffect(() => {
    void api.config
      .get()
      .then((config) => setInRotation(new Set(config.rotation.map((entry) => entry.map))))
      .catch(() => setInRotation(new Set()));
  }, []);

  const addToRotation = async (name: string) => {
    setRotationBusy(name);
    try {
      const result = await api.config.addToRotation([name]);
      setInRotation(new Set(result.rotation.map((entry) => entry.map)));
      toast.success(
        `${name} added to the rotation`,
        'It joins the end of the cycle. The running server picks it up on the next map change.',
      );
    } catch (err) {
      toast.error(
        'Could not add to the rotation',
        err instanceof ApiError ? err.message : 'Unexpected error',
      );
    } finally {
      setRotationBusy(null);
    }
  };

  const load = useCallback(async () => {
    try {
      const [mapsData, fastdlData, infoData] = await Promise.all([
        api.maps.list(),
        api.fastdl.get(),
        api.system.info(),
      ]);
      setMaps(mapsData);
      setFastdl(fastdlData);
      setInfo(infoData);
    } catch (err) {
      toast.error('Could not load map data', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await api.maps.remove(pendingDelete.filename);
      toast.success(`${pendingDelete.filename} deleted`);
      await load();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  if (loading) return <Spinner label="Loading map library" />;
  if (!maps || !fastdl) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Map packages"
          value={maps.usage.mapCount}
          sub={`${maps.usage.customMapCount} custom`}
          icon={<Package size={17} aria-hidden />}
        />
        <Stat
          label="Library size"
          value={formatBytes(maps.usage.totalBytes)}
          sub={`${formatBytes(maps.usage.customBytes)} custom`}
          icon={<HardDrive size={17} aria-hidden />}
        />
        <Stat
          label="HTTP downloads"
          value={fastdl.configured ? 'Enabled' : 'Disabled'}
          sub={fastdl.configured ? 'Clients fetch over HTTP' : 'Slow in-game transfer only'}
          tone={fastdl.configured ? 'success' : 'neutral'}
          icon={<CloudDownload size={17} aria-hidden />}
        />
        <Stat
          label="Web server"
          value={fastdl.container.running ? 'Running' : 'Stopped'}
          sub={fastdl.containerName}
          tone={fastdl.container.running ? 'success' : 'neutral'}
          icon={<FileArchive size={17} aria-hidden />}
        />
      </div>

      <FastdlPanel
        state={fastdl}
        onChanged={async () => {
          await load();
          await refresh();
        }}
      />

      <UploadPanel maxMb={info?.limits.maxUploadMb ?? 256} onUploaded={load} />

      <Panel
        title={`Installed map packages (${maps.maps.length})`}
        description={maps.directory}
        bodyClassName="p-0"
      >
        {maps.maps.length === 0 ? (
          <EmptyState
            icon={<Package size={26} aria-hidden />}
            title="No map packages found"
            description="Check that ETMAIN_PATH points at the same directory your game server mounts."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Maps inside</th>
                  <th className="px-4 py-2 text-right font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">Modified</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {maps.maps.map((map) => (
                  <tr key={map.filename} className="border-b border-line last:border-0 hover:bg-raised">
                    <td className="px-4 py-2">
                      <span className="font-mono text-body">{map.filename}</span>
                      {map.stock && (
                        <Badge tone="neutral" className="ml-2">
                          <Lock size={10} aria-hidden />
                          stock
                        </Badge>
                      )}
                    </td>

                    {/* The name a rotation entry needs is inside the archive and
                        is often nothing like the filename, which is why finding
                        it used to mean an rcon round trip on another page. */}
                    <td className="px-4 py-2">
                      {map.maps.length === 0 ? (
                        <span className="text-xs text-faint" title="No maps/*.bsp entries found in this package">
                          none
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1">
                          {map.maps.map((name) => (
                            <button
                              key={name}
                              type="button"
                              disabled={rotationBusy === name || inRotation.has(name)}
                              onClick={() => void addToRotation(name)}
                              title={
                                inRotation.has(name)
                                  ? `${name} is already in the rotation`
                                  : `Add ${name} to the map rotation`
                              }
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                                inRotation.has(name)
                                  ? 'cursor-default border-success/30 bg-success-soft text-success'
                                  : 'border-line text-muted hover:border-accent hover:bg-accent-soft hover:text-accent'
                              }`}
                            >
                              {inRotation.has(name) ? (
                                <Check size={10} aria-hidden />
                              ) : (
                                <Plus size={10} aria-hidden />
                              )}
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="tabular px-4 py-2 text-right text-muted">
                      {formatBytes(map.sizeBytes)}
                    </td>
                    <td className="px-4 py-2 text-muted">{formatDateTime(map.modifiedAt)}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={map.stock}
                        aria-label={
                          map.stock ? `${map.filename} is a stock pak and cannot be deleted` : `Delete ${map.filename}`
                        }
                        title={map.stock ? 'Stock game paks cannot be deleted' : undefined}
                        onClick={() => setPendingDelete(map)}
                        icon={<Trash2 size={13} aria-hidden />}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this map package?"
        description={
          pendingDelete && (
            <>
              <code className="font-mono text-body">{pendingDelete.filename}</code> will be removed from
              disk. Players currently on that map will be dropped at the next map load, and anyone missing
              it will no longer be able to download it.
            </>
          )
        }
        confirmLabel="Delete"
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
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

/* -------------------------------------------------------------------------- */

function UploadPanel({ maxMb, onUploaded }: { maxMb: number; onUploaded: () => Promise<void> }) {
  const toast = useToast();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = async (files: File[]) => {
    const pk3s = files.filter((file) => file.name.toLowerCase().endsWith('.pk3'));

    if (pk3s.length === 0) {
      toast.warning('Nothing to upload', 'Only .pk3 map packages can be installed.');
      return;
    }

    const tooBig = pk3s.find((file) => file.size > maxMb * 1024 * 1024);
    if (tooBig) {
      toast.error(`${tooBig.name} is too large`, `The limit is ${maxMb} MB per file.`);
      return;
    }

    setProgress(0);
    try {
      const result = await api.maps.upload(pk3s, setProgress);

      if (result.installed > 0) {
        toast.success(
          `Installed ${result.installed} map package${result.installed === 1 ? '' : 's'}`,
          'Add them to the rotation on the Configuration page.',
        );
      }
      for (const failure of result.results.filter((r) => !r.ok)) {
        toast.error(`${failure.filename} was rejected`, failure.error);
      }
      await onUploaded();
    } catch (err) {
      toast.error('Upload failed', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void send([...event.dataTransfer.files]);
  };

  return (
    <Panel title="Add map packages" description={`Up to ${maxMb} MB per .pk3 file`}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragging ? 'border-accent bg-accent-soft' : 'border-line'
        }`}
      >
        <Upload size={22} className="text-faint" aria-hidden />

        {progress === null ? (
          <>
            <p className="text-[13px] text-body">Drop .pk3 files here</p>
            <p className="text-xs text-muted">or</p>
            <Button variant="primary" size="sm" onClick={() => inputRef.current?.click()}>
              Choose files
            </Button>
            {/* The visible button drives this; keeping it in the DOM (rather
                than hidden from a11y) preserves keyboard access to the picker. */}
            <input
              ref={inputRef}
              type="file"
              accept=".pk3"
              multiple
              className="sr-only"
              aria-label="Choose map packages to upload"
              onChange={(event) => void send([...(event.target.files ?? [])])}
            />
          </>
        ) : (
          <div className="w-full max-w-sm">
            <div className="mb-1.5 flex justify-between text-xs text-muted">
              <span>Uploading…</span>
              <span className="tabular">{progress}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
            >
              <div
                className="h-full rounded-full bg-accent-solid transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
