import { Check, HardDrive, Lock, Package, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RotationEditor } from '../components/RotationEditor';
import { Badge, Button, EmptyState, Panel, Spinner, Stat } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import { useToast } from '../lib/toast';
import type { MapPackage, MapsPayload, SystemInfo } from '../lib/types';

/**
 * The map library, and what plays from it.
 *
 * Split from FastDL, which used to share this screen. The two are related only
 * in that one serves the files the other manages: installing a map and choosing
 * how clients download it are different jobs, done at different times, and
 * putting them together meant every visit to either scrolled past the other.
 *
 * Everything needed to get a map onto the server and into play is here, in the
 * order it happens: upload, then schedule, then the library itself.
 */
export function MapsPage() {
  const toast = useToast();

  const [maps, setMaps] = useState<MapsPayload | null>(null);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<MapPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [inRotation, setInRotation] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<{ rotation: string[]; revision: string } | null>(null);

  const loadRotation = useCallback(async () => {
    try {
      const current = await api.config.get();
      setConfig({
        rotation: current.rotation.map((entry) => entry.map),
        revision: current.revision,
      });
      setInRotation(new Set(current.rotation.map((entry) => entry.map)));
    } catch {
      // No config yet is normal on a fresh install; the editor simply has
      // nothing to show until one exists.
      setConfig(null);
      setInRotation(new Set());
    }
  }, []);

  const load = useCallback(async () => {
    // Loaded independently so one failure cannot blank the page.
    const [mapsData, infoData] = await Promise.allSettled([api.maps.list(), api.system.info()]);

    if (mapsData.status === 'fulfilled') {
      setMaps(mapsData.value);
    } else {
      toast.error(
        'Could not load the map library',
        mapsData.reason instanceof ApiError ? mapsData.reason.message : 'Unexpected error',
      );
    }
    setInfo(infoData.status === 'fulfilled' ? infoData.value : null);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void load();
    void loadRotation();
  }, [load, loadRotation]);

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await api.maps.remove(pendingDelete.filename);
      toast.success(`${pendingDelete.filename} deleted`);
      await load();
      await loadRotation();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  if (loading) return <Spinner label="Loading map library" />;
  if (!maps) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
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
      </div>

      <UploadPanel
        maxMb={info?.limits.maxUploadMb ?? 256}
        onUploaded={async () => {
          await load();
          // A freshly uploaded map should appear in the rotation editor below
          // straight away — switched off, but there, on the same screen.
          await loadRotation();
        }}
      />

      {config && (
        <RotationEditor
          availableMaps={maps.maps.flatMap((pack) => pack.maps)}
          rotation={config.rotation}
          revision={config.revision}
          onSaved={loadRotation}
        />
      )}

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

                    <td className="px-4 py-2">
                      {map.maps.length === 0 ? (
                        <span
                          className="text-xs text-faint"
                          title="No maps/*.bsp entries found in this package"
                        >
                          none
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1">
                          {map.maps.map((name) => (
                            <span
                              key={name}
                              title={
                                inRotation.has(name)
                                  ? `${name} is in the rotation`
                                  : `${name} is installed but not in the rotation`
                              }
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] ${
                                inRotation.has(name)
                                  ? 'border-success/30 bg-success-soft text-success'
                                  : 'border-line text-muted'
                              }`}
                            >
                              {inRotation.has(name) && <Check size={10} aria-hidden />}
                              {name}
                            </span>
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
                          map.stock
                            ? `${map.filename} is a stock pak and cannot be deleted`
                            : `Delete ${map.filename}`
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
              <code className="font-mono text-body">{pendingDelete.filename}</code> will be removed
              from disk. Players currently on that map will be dropped at the next map load, and
              anyone missing it will no longer be able to download it.
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
