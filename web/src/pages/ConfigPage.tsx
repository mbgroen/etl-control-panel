import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  FileCode2,
  History,
  ListOrdered,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Panel,
  PasswordInput,
  Select,
  Spinner,
  Toggle,
} from '../components/ui';
import { api, ApiError } from '../lib/api';
import { ALL_CVARS, APPLIES_LABEL, CVAR_SECTIONS, type CvarSpec } from '../lib/cvarSchema';
import { formatDateTime, formatRelative, prettifyMapName } from '../lib/format';
import { useToast } from '../lib/toast';
import type {
  BackupEntry,
  ConfigPayload,
  ConfigProblem,
  RconHandover,
} from '../lib/types';

/**
 * Server configuration.
 *
 * Three views over one file, in order of increasing power: guided forms for the
 * settings people actually change, a rotation builder for the one structure
 * that is painful to hand-write, and the raw editor as the escape hatch. The
 * raw file is always the source of truth — the forms patch it, never replace it.
 */

const MASK = '••••••••';

/**
 * Real values of the secret cvars, read out of the raw config text.
 *
 * The API masks secrets in its structured cvar list but returns the file itself
 * verbatim in the same response, because the raw editor cannot work without it.
 * So this reads what the browser already holds rather than asking for anything
 * extra — no additional endpoint, and nothing crosses the wire that was not
 * crossing it already.
 */
function secretValues(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  const line = /^[ \t]*set[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]+"([^"]*)"/gm;
  for (const match of content.matchAll(line)) {
    values[(match[1] ?? '').toLowerCase()] = match[2] ?? '';
  }
  return values;
}

/**
 * Tells the operator what happened to the rcon password, if they changed it.
 *
 * Changing it used to break the console silently, and the breakage only showed
 * up later on a different page — so the one moment worth reporting is the save
 * itself. A warning here is not an error: the config was written either way,
 * and the message says what remains to be done.
 */
function reportRconHandover(
  handover: RconHandover | null,
  toast: ReturnType<typeof useToast>,
): void {
  if (!handover) return;
  if (handover.ok) {
    toast.success('RCON password updated', handover.message);
  } else {
    toast.warning('RCON password needs one more step', handover.message);
  }
}

type Tab = 'settings' | 'rotation' | 'raw' | 'backups';

const TABS: { id: Tab; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
  { id: 'rotation', label: 'Map rotation', icon: ListOrdered },
  { id: 'raw', label: 'Raw file', icon: FileCode2 },
  { id: 'backups', label: 'Backups', icon: History },
];

export function ConfigPage() {
  const [tab, setTab] = useState<Tab>('settings');
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConfig(await api.config.get());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load the configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !config) return <Spinner label="Loading configuration" />;

  if (loadError) return <MissingConfig message={loadError} onRetry={load} />;

  if (!config) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                tab === id ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-body'
              }`}
            >
              <Icon size={14} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted">
          <code className="font-mono">{config.path}</code> · saved {formatRelative(config.modifiedAt)}
        </p>
      </div>

      <ProblemList problems={config.problems} />

      {tab === 'settings' && <SettingsTab config={config} onSaved={load} />}
      {tab === 'rotation' && <RotationTab config={config} onSaved={load} />}
      {tab === 'raw' && <RawTab config={config} onSaved={load} />}
      {tab === 'backups' && <BackupsTab onRestored={load} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Shown when etmain holds no config yet — the normal state right after a fresh
 * install. Offers to write a working starter file rather than telling the
 * operator to go find a shell, which is the whole point of a WebUI install.
 */
function MissingConfig({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.config.initialize();
      toast.success('Configuration created', 'Set your server name and passwords below.');
      await onRetry();
    } catch (err) {
      toast.error(
        'Could not create the configuration',
        err instanceof ApiError ? err.message : 'Unexpected error',
      );
    } finally {
      setBusy(false);
    }
  };

  const missing = message.toLowerCase().includes('no ') || message.toLowerCase().includes('not found');

  return (
    <Panel>
      <EmptyState
        icon={<FileCode2 size={26} aria-hidden />}
        title={missing ? 'No server configuration yet' : 'Configuration not available'}
        description={
          missing
            ? 'Create a starter config with sensible defaults and a working six-map rotation. You can change everything afterwards, and each save is backed up.'
            : message
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {missing && (
              <Button variant="primary" loading={busy} onClick={() => void create()}>
                Create default configuration
              </Button>
            )}
            <Button onClick={() => void onRetry()}>Try again</Button>
          </div>
        }
      />
    </Panel>
  );
}

function ProblemList({ problems }: { problems: ConfigProblem[] }) {
  if (problems.length === 0) return null;

  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');

  return (
    <div className="flex flex-col gap-2">
      {[...errors, ...warnings].map((problem, index) => (
        <div
          key={index}
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
            problem.severity === 'error'
              ? 'border-danger/40 bg-danger-soft text-danger'
              : 'border-warn/40 bg-warn-soft text-warn'
          }`}
          role={problem.severity === 'error' ? 'alert' : undefined}
        >
          {problem.severity === 'error' ? (
            <AlertCircle size={14} className="mt-px shrink-0" aria-hidden />
          ) : (
            <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden />
          )}
          <span>
            {problem.line !== null && <strong className="font-mono">Line {problem.line}: </strong>}
            {problem.message}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SettingsTab({ config, onSaved }: { config: ConfigPayload; onSaved: () => Promise<void> }) {
  const toast = useToast();

  const initial = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cvar of config.cvars) map[cvar.key.toLowerCase()] = cvar.value;

    // The cvar list arrives with secrets replaced by a row of bullets, but the
    // same response carries the raw file, so the real values are already here.
    // Seeding them means a password field holds its actual password: masked by
    // the input, revealable with the eye, and correctly seen as unchanged when
    // left alone. Substituting the mask instead made every one of those true
    // only by accident, and required special-casing focus to avoid appending to
    // a row of bullets that was never the password.
    for (const [key, value] of Object.entries(secretValues(config.content))) {
      if (map[key] === MASK) map[key] = value;
    }
    return map;
  }, [config.cvars, config.content]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(true);
  const [query, setQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => setValues(initial), [initial]);

  const changed = useMemo(
    () =>
      Object.entries(values).filter(([key, value]) => (initial[key] ?? '') !== value),
    [values, initial],
  );

  const save = async () => {
    if (changed.length === 0) return;
    setSaving(true);
    try {
      const updates = Object.fromEntries(changed);
      const result = await api.config.patch(updates, config.revision, reload);
      reportRconHandover(result.rconPassword, toast);
      toast.success(
        `Saved ${result.applied.length} setting${result.applied.length === 1 ? '' : 's'}`,
        reload ? 'The running server was asked to re-read its config.' : undefined,
      );
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error('The file changed on disk', 'Reload the page to see the current version.');
      } else {
        toast.error('Could not save', err instanceof ApiError ? err.message : 'Unexpected error');
      }
    } finally {
      setSaving(false);
    }
  };

  // Filtering happens here rather than per section so an empty section can be
  // dropped entirely — a page of empty panels is a worse answer than a short
  // list of matches.
  const visibleSections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CVAR_SECTIONS.map((section) => ({
      ...section,
      cvars: section.cvars.filter((spec) => {
        if (!showAdvanced && spec.advanced && !needle) return false;
        if (!needle) return true;
        return (
          spec.label.toLowerCase().includes(needle) ||
          spec.key.toLowerCase().includes(needle) ||
          (spec.hint ?? '').toLowerCase().includes(needle)
        );
      }),
    })).filter((section) => section.cvars.length > 0);
  }, [query, showAdvanced]);

  const matchCount = visibleSections.reduce((total, section) => total + section.cvars.length, 0);
  const advancedCount = ALL_CVARS.filter((spec) => spec.advanced).length;

  return (
    <div className="flex flex-col gap-4">
      {/* With around a hundred settings, finding one by scrolling is hopeless.
          Search and the advanced toggle are what keep the page usable; the
          jump list turns the sections into navigation rather than a wall. */}
      <div className="card flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search settings — name, cvar or description"
              aria-label="Search settings"
              className="pl-8"
            />
          </div>
          <Toggle
            checked={showAdvanced}
            onChange={setShowAdvanced}
            label="Show advanced"
            description={`${advancedCount} rarely-changed settings`}
          />
        </div>

        {query.trim() ? (
          <p className="text-xs text-muted" role="status">
            {matchCount === 0
              ? 'Nothing matches. Try the cvar name, or look in the raw editor.'
              : `${matchCount} setting${matchCount === 1 ? '' : 's'} match — advanced ones included.`}
          </p>
        ) : (
          <nav aria-label="Jump to a section" className="flex flex-wrap gap-1.5">
            {visibleSections.map((section) => (
              <a
                key={section.id}
                href={`#section-${section.id}`}
                className="rounded-md border border-line px-2 py-1 text-xs text-muted transition-colors hover:border-line-strong hover:text-body"
              >
                {section.title}
              </a>
            ))}
          </nav>
        )}
      </div>

      {visibleSections.map((section) => (
        <Panel
          key={section.id}
          id={`section-${section.id}`}
          title={section.title}
          description={section.description}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {section.cvars.map((spec) => (
              <CvarField
                key={spec.key}
                spec={spec}
                value={values[spec.key.toLowerCase()] ?? ''}
                defined={initial[spec.key.toLowerCase()] !== undefined}
                onChange={(next) =>
                  setValues((current) => ({ ...current, [spec.key.toLowerCase()]: next }))
                }
              />
            ))}
          </div>
        </Panel>
      ))}

      {/* Sticky save bar: with four sections of fields, a save button at the
          bottom of the page would be off-screen most of the time. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">
              {changed.length === 0
                ? 'No unsaved changes'
                : `${changed.length} unsaved change${changed.length === 1 ? '' : 's'}`}
            </span>
            <Toggle
              checked={reload}
              onChange={setReload}
              label="Apply to running server"
              disabled={changed.length === 0}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setValues(initial)} disabled={changed.length === 0 || saving}>
              Discard
            </Button>
            <Button
              variant="primary"
              icon={<Save size={14} aria-hidden />}
              loading={saving}
              disabled={changed.length === 0}
              onClick={() => void save()}
            >
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CvarField({
  spec,
  value,
  defined,
  onChange,
}: {
  spec: CvarSpec;
  value: string;
  defined: boolean;
  onChange: (next: string) => void;
}) {
  const hint = (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {spec.hint}
      <Badge tone={spec.appliesOn === 'immediately' ? 'success' : 'neutral'}>
        {APPLIES_LABEL[spec.appliesOn]}
      </Badge>
      {!defined && <Badge tone="info">not set — will be added</Badge>}
    </span>
  );

  if (spec.kind === 'boolean') {
    return (
      <div className="flex flex-col gap-1.5">
        <Toggle
          checked={value === '1'}
          onChange={(next) => onChange(next ? '1' : '0')}
          label={spec.label}
        />
        <p className="text-xs text-muted">{hint}</p>
      </div>
    );
  }

  return (
    <Field label={spec.label} hint={hint} htmlFor={`cvar-${spec.key}`}>
      {spec.kind === 'select' ? (
        <Select id={`cvar-${spec.key}`} value={value} onChange={(e) => onChange(e.target.value)}>
          {/* Preserve an unrecognised existing value rather than silently
              rewriting it to the first option. */}
          {!spec.options?.some((option) => option.value === value) && (
            <option value={value}>{value ? `Current: ${value}` : 'Not set'}</option>
          )}
          {spec.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : spec.kind === 'password' ? (
        <PasswordInput
          id={`cvar-${spec.key}`}
          value={value}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={`cvar-${spec.key}`}
          type={spec.kind === 'number' ? 'number' : 'text'}
          inputMode={spec.kind === 'number' ? 'numeric' : undefined}
          min={spec.min}
          max={spec.max}
          value={value}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/* -------------------------------------------------------------------------- */

const STOCK_MAPS = [
  'oasis',
  'battery',
  'goldrush',
  'radar',
  'railgun',
  'fueldump',
  'beach',
  'braundorf_b4',
  'sw_goldrush_te',
  'supply',
  'adlernest',
  'et_beach',
];

function RotationTab({ config, onSaved }: { config: ConfigPayload; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [maps, setMaps] = useState<string[]>(config.rotation.map((entry) => entry.map));
  const [candidate, setCandidate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => setMaps(config.rotation.map((entry) => entry.map)), [config.rotation]);

  const dirty = useMemo(
    () => JSON.stringify(maps) !== JSON.stringify(config.rotation.map((e) => e.map)),
    [maps, config.rotation],
  );

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= maps.length) return;
    const next = [...maps];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as string);
    setMaps(next);
  };

  const add = (name: string) => {
    const clean = name.trim().toLowerCase();
    if (!clean || !/^[a-z0-9_-]+$/.test(clean)) {
      toast.warning('Invalid map name', 'Use only letters, digits, dashes and underscores.');
      return;
    }
    setMaps((current) => [...current, clean]);
    setCandidate('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.config.setRotation(maps, config.revision);
      toast.success(
        maps.length === 0 ? 'Rotation cleared' : `Rotation saved (${maps.length} maps)`,
        'It takes effect at the next map change.',
      );
      await onSaved();
    } catch (err) {
      toast.error('Could not save rotation', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <Panel
        title="Rotation order"
        description="Maps play in this order and then loop back to the first."
        bodyClassName="p-0"
        actions={
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
        }
      >
        {maps.length === 0 ? (
          <EmptyState
            icon={<ListOrdered size={26} aria-hidden />}
            title="No rotation configured"
            description="Without a rotation the server stays on whichever map it loaded at start-up. Add maps on the right to build one."
          />
        ) : (
          <ol className="divide-y divide-line">
            {maps.map((map, index) => (
              <li key={`${map}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
                <span className="tabular w-6 shrink-0 text-xs text-faint">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-body">
                  {prettifyMapName(map)}
                  <span className="ml-2 font-mono text-[11px] text-faint">{map}</span>
                </span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${map} earlier`}
                    icon={<ArrowUp size={13} aria-hidden />}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, 1)}
                    disabled={index === maps.length - 1}
                    aria-label={`Move ${map} later`}
                    icon={<ArrowDown size={13} aria-hidden />}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setMaps((current) => current.filter((_, i) => i !== index))}
                    aria-label={`Remove ${map} from rotation`}
                    icon={<Trash2 size={13} aria-hidden />}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Add a map" bodyClassName="p-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add(candidate);
          }}
          className="flex gap-2"
        >
          <Input
            value={candidate}
            onChange={(event) => setCandidate(event.target.value)}
            placeholder="map name"
            aria-label="Map name"
            className="font-mono"
          />
          <Button type="submit" variant="primary" disabled={!candidate.trim()}>
            Add
          </Button>
        </form>

        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-faint">Stock maps</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {STOCK_MAPS.map((map) => (
            <button
              key={map}
              type="button"
              onClick={() => add(map)}
              className="rounded-md border border-line px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-accent hover:text-accent"
            >
              {map}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs text-muted">
          Custom maps must be installed as <code className="font-mono">.pk3</code> files before they can be
          rotated. Manage those on the Maps &amp; FastDL page.
        </p>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function RawTab({ config, onSaved }: { config: ConfigPayload; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [content, setContent] = useState(config.content);
  const [problems, setProblems] = useState<ConfigProblem[]>(config.problems);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(false);

  useEffect(() => setContent(config.content), [config.content]);

  const dirty = content !== config.content;
  const lineCount = content.split('\n').length;

  // Validate as the operator types, but debounced — the check is a round trip
  // and firing it on every keystroke would be both noisy and pointless.
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void api.config
        .validate(content)
        .then((result) => setProblems(result.problems))
        .catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [content, dirty]);

  const save = async (force = false) => {
    setSaving(true);
    try {
      const result = await api.config.save({
        content,
        expectedRevision: config.revision,
        force,
        reload,
        note: 'Edited in the raw editor',
      });
      reportRconHandover(result.rconPassword, toast);
      toast.success('Configuration saved', 'A backup of the previous version was kept.');
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        toast.error('Save blocked by validation errors', 'Fix the errors listed above, or force-save.');
      } else if (err instanceof ApiError && err.status === 409) {
        toast.error('The file changed on disk', 'Reload the page before saving again.');
      } else {
        toast.error('Could not save', err instanceof ApiError ? err.message : 'Unexpected error');
      }
    } finally {
      setSaving(false);
    }
  };

  const hasErrors = problems.some((p) => p.severity === 'error');

  return (
    <Panel
      title="Raw configuration file"
      description={`${lineCount} lines · edits here are written verbatim`}
      bodyClassName="p-0"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Toggle checked={reload} onChange={setReload} label="Reload after save" />
          <Button onClick={() => setContent(config.content)} disabled={!dirty || saving} size="sm">
            Revert
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Save size={13} aria-hidden />}
            loading={saving}
            disabled={!dirty}
            onClick={() => void save(false)}
          >
            Save
          </Button>
        </div>
      }
    >
      {problems.length > 0 && (
        <div className="border-b border-line p-3">
          <ProblemList problems={problems} />
          {hasErrors && (
            <Button
              variant="danger"
              size="sm"
              className="mt-2"
              disabled={!dirty || saving}
              onClick={() => void save(true)}
            >
              Save anyway
            </Button>
          )}
        </div>
      )}

      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        spellCheck={false}
        aria-label="Server configuration file contents"
        className="h-[32rem] w-full resize-y bg-sunken p-4 font-mono text-xs leading-relaxed text-body focus:outline-none"
      />
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function BackupsTab({ onRestored }: { onRestored: () => Promise<void> }) {
  const toast = useToast();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<BackupEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBackups((await api.config.backups()).backups);
      // Anything selected may no longer exist after a reload.
      setSelected(new Set());
    } catch {
      setBackups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await api.config.restore(pending.id);
      reportRconHandover(result.rconPassword, toast);
      toast.success('Configuration restored', 'The version you replaced was backed up first.');
      await onRestored();
      await load();
    } catch (err) {
      toast.error('Could not restore', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { deleted } = await api.config.deleteBackups([...selected]);
      toast.success(
        `Deleted ${deleted} backup${deleted === 1 ? '' : 's'}`,
        'The configuration itself is unchanged.',
      );
      await load();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  if (loading) return <Spinner label="Loading backups" />;

  return (
    <>
      <Panel
        title="Configuration history"
        description="A snapshot is taken automatically before every save. The 30 most recent are kept."
        actions={
          selected.size > 0 ? (
            <>
              <span className="text-xs text-muted">{selected.size} selected</span>
              <Button size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={13} aria-hidden />}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            </>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {backups.length === 0 ? (
          <EmptyState
            icon={<History size={26} aria-hidden />}
            title="No backups yet"
            description="The first backup is created the next time you save a change."
          />
        ) : (
          <ul className="divide-y divide-line">
            {backups.map((backup) => (
              <li key={backup.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(backup.id)}
                  onChange={() => toggle(backup.id)}
                  className="size-4 shrink-0 accent-[var(--accent-solid)]"
                  aria-label={`Select the backup from ${formatDateTime(backup.createdAt)}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-body">{formatDateTime(backup.createdAt)}</p>
                  <p className="truncate text-xs text-muted">
                    {backup.note || 'No description'} · {backup.sizeBytes} bytes
                  </p>
                </div>
                <Button
                  size="sm"
                  icon={<RotateCcw size={13} aria-hidden />}
                  onClick={() => setPending(backup)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ConfirmDialog
        open={pending !== null}
        tone="primary"
        title="Restore this configuration?"
        description={
          pending && (
            <>
              The current configuration will be replaced with the version from{' '}
              <strong className="text-body">{formatDateTime(pending.createdAt)}</strong>. Your current file
              is backed up first, so this is reversible. The running server keeps its loaded settings until
              it reloads or restarts.
            </>
          )
        }
        confirmLabel="Restore"
        loading={busy}
        onConfirm={() => void restore()}
        onCancel={() => setPending(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title={`Delete ${selected.size} backup${selected.size === 1 ? '' : 's'}?`}
        description="This removes the snapshots only — the configuration in use is not touched. Deleted backups cannot be recovered."
        confirmLabel="Delete"
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

