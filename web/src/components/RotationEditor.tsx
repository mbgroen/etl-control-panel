import { ArrowDown, ArrowUp, ListOrdered, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { prettifyMapName } from '../lib/format';
import { useToast } from '../lib/toast';
import { Badge, Button, EmptyState, Panel, Toggle } from './ui';

/**
 * The map rotation, edited against everything that is installed.
 *
 * Previously the rotation was a list you typed names into, and finding a name
 * meant looking somewhere else — so uploading a map and scheduling it were two
 * screens with an RCON round trip between them. Here every installed map is a
 * row: switch it on to include it, off to drop it. Nothing has to be typed and
 * nothing has to be remembered.
 *
 * A newly installed map arrives switched **off**. Uploading a file should never
 * silently change what the server plays next — that is a separate decision, and
 * one this screen makes cheap rather than automatic.
 */
export function RotationEditor({
  availableMaps,
  rotation,
  revision,
  onSaved,
}: {
  /** Every map name found inside the installed pk3 files. */
  availableMaps: string[];
  /** Map names currently in the rotation, in play order. */
  rotation: string[];
  revision: string;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [order, setOrder] = useState<string[]>(rotation);
  const [saving, setSaving] = useState(false);

  useEffect(() => setOrder(rotation), [rotation]);

  const dirty = useMemo(
    () => JSON.stringify(order) !== JSON.stringify(rotation),
    [order, rotation],
  );

  /**
   * Maps that exist but are not scheduled.
   *
   * Includes anything already in the rotation whose pk3 has since been removed:
   * dropping it silently would rewrite the rotation behind the operator's back,
   * and the engine's own failure is more honest than our guess.
   */
  const available = useMemo(
    () => availableMaps.filter((map) => !order.includes(map)).sort(),
    [availableMaps, order],
  );

  const missing = useMemo(
    () => order.filter((map) => !availableMaps.includes(map)),
    [order, availableMaps],
  );

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as string);
    setOrder(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.config.setRotation(order, revision);
      toast.success(
        order.length === 0 ? 'Rotation cleared' : `Rotation saved — ${order.length} maps`,
        'It takes effect at the next map change.',
      );
      await onSaved();
    } catch (err) {
      toast.error(
        'Could not save the rotation',
        err instanceof ApiError ? err.message : 'Unexpected error',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Map rotation"
      description="Switch a map on to include it. Maps play top to bottom, then loop."
      actions={
        <>
          {dirty && (
            <Button size="sm" onClick={() => setOrder(rotation)} disabled={saving}>
              Discard
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={<Save size={13} aria-hidden />}
            loading={saving}
            disabled={!dirty}
            onClick={() => void save()}
          >
            Save rotation
          </Button>
        </>
      }
      bodyClassName="p-0"
    >
      {order.length === 0 && available.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={<ListOrdered size={26} aria-hidden />}
            title="No maps installed"
            description="Upload a .pk3 above and its maps appear here, ready to switch on."
          />
        </div>
      ) : (
        <>
          <ol className="divide-y divide-line">
            {order.map((map, index) => (
              <li key={map} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="tabular w-6 shrink-0 text-xs text-faint">{index + 1}</span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-body">
                    {prettifyMapName(map)}
                  </p>
                  <p className="truncate font-mono text-xs text-muted">{map}</p>
                </div>

                {missing.includes(map) && (
                  <span title="No installed pk3 provides this map — the server will fail to load it">
                    <Badge tone="warn">file missing</Badge>
                  </span>
                )}

                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowUp size={13} aria-hidden />}
                    disabled={index === 0}
                    aria-label={`Move ${map} earlier`}
                    onClick={() => move(index, -1)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowDown size={13} aria-hidden />}
                    disabled={index === order.length - 1}
                    aria-label={`Move ${map} later`}
                    onClick={() => move(index, 1)}
                  />
                </div>

                <Toggle
                  checked
                  hideLabel
                  label={`${map} is in the rotation`}
                  onChange={() => setOrder((current) => current.filter((name) => name !== map))}
                />
              </li>
            ))}
          </ol>

          {available.length > 0 && (
            <div className="border-t border-line">
              <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                Installed, not in rotation
              </p>
              <ul className="divide-y divide-line">
                {available.map((map) => (
                  <li key={map} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className="w-6 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-muted">{prettifyMapName(map)}</p>
                      <p className="truncate font-mono text-xs text-faint">{map}</p>
                    </div>
                    <Toggle
                      checked={false}
                      hideLabel
                      label={`Add ${map} to the rotation`}
                      onChange={() => setOrder((current) => [...current, map])}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
