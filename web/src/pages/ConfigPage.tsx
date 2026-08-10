import {
  Upload,
  AlertCircle,
  FileCode2,
  History,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  Badge,
  Button,
  DownloadLink,
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
import { formatDateTime, formatRelative } from '../lib/format';
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

type Tab = 'settings' | 'raw' | 'backups';

const TABS: { id: Tab; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
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
      {tab === 'raw' && <RawTab config={config} onSaved={load} />}
      {tab === 'backups' && <BackupsTab onRestored={load} />}
    </div>
  );
}

/**
 * A bitmask cvar, as one checkbox per bit.
 *
 * The engine reads a single number, so guides say "set it to 15" and leave you
 * to work out that you just switched three other things on — and "set it to 1"
 * quietly switches them off. Bits the schema does not name are left untouched
 * rather than cleared, because a newer server may define more of them than this
 * control panel knows about.
 */
function FlagField({
  spec,
  value,
  hint,
  onChange,
}: {
  spec: CvarSpec;
  value: string;
  hint: ReactNode;
  onChange: (next: string) => void;
}) {
  const parsed = Number.parseInt(value, 10);
  const numeric = Number.isNaN(parsed) ? 0 : parsed;
  // An unparseable value is shown as-is rather than silently read as zero: the
  // file says something this field cannot represent, and saying so beats
  // pretending every box is simply unticked.
  const unreadable = value.trim() !== '' && Number.isNaN(parsed);

  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-body">{spec.label}</p>
        <p className="font-mono text-xs text-faint">
          {spec.key} {unreadable ? value : numeric}
        </p>
      </div>

      <div className="grid gap-1.5 rounded-lg border border-line bg-sunken p-3 sm:grid-cols-2">
        {spec.flags?.map((flag) => (
          <label key={flag.bit} className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5 accent-accent"
              // The wrapping label names it visually; the explicit label keeps
              // the hint text out of the announced name.
              aria-label={flag.label}
              checked={(numeric & flag.bit) !== 0}
              onChange={(event) =>
                onChange(String(event.target.checked ? numeric | flag.bit : numeric & ~flag.bit))
              }
            />
            <span>
              <span className="text-body">{flag.label}</span>
              <span className="ml-1.5 font-mono text-faint">{flag.bit}</span>
              {flag.hint && <span className="block text-muted">{flag.hint}</span>}
            </span>
          </label>
        ))}
      </div>

      {unreadable && (
        <p className="text-xs text-warn">
          The file has <span className="font-mono">{value}</span>, which is not a number. Ticking a
          box replaces it.
        </p>
      )}
      <p className="text-xs text-muted">{hint}</p>
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
      toast.success('Configuration created', 'Set your server name and passwords on this page.');
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

/**
 * Cvars this page deliberately no longer holds, and where they went.
 *
 * Removing the Downloads section fixed one problem — two screens claiming to
 * own sv_wwwBaseURL — and would have created another: someone who knows the
 * cvar searches for it, finds nothing, and concludes the control panel cannot set
 * it. A search that comes up empty should say where to look.
 */
const MOVED = [
  {
    match: /^sv_(www|dl|allowdownload)/i,
    where: 'Download and FastDL settings are on the FastDL page under Manage.',
  },
];

/** Lower-case cvar name to the spelling the schema uses. */
const CANONICAL_KEYS = new Map(ALL_CVARS.map((spec) => [spec.key.toLowerCase(), spec.key]));

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
  const [showExpert, setShowExpert] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);

  useEffect(() => setValues(initial), [initial]);

  const changed = useMemo(
    () =>
      Object.entries(values).filter(([key, value]) => (initial[key] ?? '') !== value),
    [values, initial],
  );

  /**
   * Numeric fields cleared by the operator, which means "remove this setting".
   *
   * Writing an empty value would be wrong — the engine reads it back as 0, and
   * 0 in g_redlimbotime is a modulo by zero — and blocking the save, which is
   * what this used to do, left no way to hand a setting back to the engine
   * short of editing the raw file. Clearing the box deletes the line instead,
   * which is what someone clearing a box means.
   *
   * Only for numbers: an empty message of the day is a legitimate value.
   */
  const removed = useMemo(
    () =>
      changed
        .filter(([key, value]) => {
          const spec = ALL_CVARS.find((candidate) => candidate.key.toLowerCase() === key);
          return spec?.kind === 'number' && value.trim() === '' && initial[key] !== undefined;
        })
        .map(([key]) => key),
    [changed, initial],
  );

  const save = async () => {
    if (changed.length === 0) return;
    setSaving(true);
    try {
      // State is keyed lower-case so a config that writes G_GRAVITY still
      // matches the field, but what gets written back should be the spelling
      // the schema uses — that is what every other line in the file looks like.
      const updates = Object.fromEntries(
        changed
          .filter(([key]) => !removed.includes(key))
          .map(([key, value]) => [CANONICAL_KEYS.get(key) ?? key, value]),
      );
      const result = await api.config.patch(
        updates,
        config.revision,
        reload,
        removed.map((key) => CANONICAL_KEYS.get(key) ?? key),
      );
      reportRconHandover(result.rconPassword, toast);
      toast.success(
        removed.length > 0
          ? `Saved — ${removed.length} setting${removed.length === 1 ? '' : 's'} handed back to the server default`
          : `Saved ${result.applied.length} setting${result.applied.length === 1 ? '' : 's'}`,
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
        // "What have I actually changed?" is the question a 190-field form
        // cannot answer by decoration alone, however good the decoration.
        if (onlyMine && initial[spec.key.toLowerCase()] === undefined) return false;
        // Search reaches everything. Someone typing "omnibot" knows what they
        // are looking for, and hiding the match would only send them to the raw
        // editor to do the same edit with less help.
        if (!needle && spec.expert && !showExpert) return false;
        if (!needle && spec.advanced && !showAdvanced) return false;
        if (!needle) return true;
        return (
          spec.label.toLowerCase().includes(needle) ||
          spec.key.toLowerCase().includes(needle) ||
          (spec.hint ?? '').toLowerCase().includes(needle)
        );
      }),
    })).filter((section) => section.cvars.length > 0);
  }, [query, showAdvanced, showExpert, onlyMine, initial]);

  const matchCount = visibleSections.reduce((total, section) => total + section.cvars.length, 0);
  const advancedCount = ALL_CVARS.filter((spec) => spec.advanced && !spec.expert).length;
  const expertCount = ALL_CVARS.filter((spec) => spec.expert).length;
  const storedCount = ALL_CVARS.filter(
    (spec) => initial[spec.key.toLowerCase()] !== undefined,
  ).length;

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
            onChange={(next) => {
              setShowAdvanced(next);
              // Expert lives inside advanced; leaving it on while its parent is
              // off would hide settings that the toggle says are showing.
              if (!next) setShowExpert(false);
            }}
            label="Show advanced"
            description={`${advancedCount} rarely-changed settings`}
          />
          {showAdvanced && (
            <Toggle
              checked={showExpert}
              onChange={setShowExpert}
              label="Expert"
              description={`${expertCount} settings that can stop the server booting`}
            />
          )}
          <Toggle
            checked={onlyMine}
            onChange={setOnlyMine}
            label="Only my settings"
            description={`${storedCount} of ${ALL_CVARS.length} are in your config`}
          />
        </div>

        {query.trim() ? (
          <p className="text-xs text-muted" role="status">
            {matchCount === 0
              ? (MOVED.find((entry) => entry.match.test(query.trim()))?.where ??
                'Nothing matches. Try the cvar name, or look in the raw editor.')
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
                removing={removed.includes(spec.key.toLowerCase())}
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
                : `${changed.length} unsaved change${changed.length === 1 ? '' : 's'}` +
                  (removed.length > 0 ? `, ${removed.length} removed` : '')}
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
  removing = false,
  onChange,
}: {
  spec: CvarSpec;
  value: string;
  defined: boolean;
  /** Cleared numeric field: saving deletes the line rather than writing 0. */
  removing?: boolean;
  onChange: (next: string) => void;
}) {
  /**
   * What the server is actually using.
   *
   * A cvar missing from the config is not off — it is whatever the engine
   * defaults to, and for most of the vote_allow_* list that is on. Rendering an
   * absent setting as blank made the form state the opposite of the truth, and
   * the only way to find out was to switch everything on, save, and switch back
   * the ones you did not want.
   */
  const effective = defined || value !== '' ? value : (spec.defaultValue ?? '');

  /**
   * True when nothing in the file mentions this cvar, so what the field shows
   * is the engine's own value.
   *
   * Text and number inputs render it as a placeholder rather than a value:
   * greyed by the browser, cleared the moment you type, and unmistakably not
   * something that has been saved. Passwords are excluded entirely — several
   * default to the string "none", which the mod treats as "disabled" and a
   * browser treats as a password worth offering to save.
   */
  /**
   * Nothing in the file, and the operator has not touched the control either.
   *
   * Touching it has to end the "default" styling straight away — a switch that
   * stays dashed after you flip it is telling you your click did not count.
   */
  const untouched = !defined && value === '';
  const usingDefault = untouched && spec.defaultValue !== undefined;

  /** The default, said in words — "empty" and "on" beat "" and "1". */
  const defaultLabel = (() => {
    const raw = spec.defaultValue;
    if (raw === undefined) return 'none';
    if (raw === '') return 'empty';
    if (spec.kind === 'boolean') return raw === '1' ? 'on' : 'off';
    return spec.options?.find((option) => option.value === raw)?.label ?? raw;
  })();
  const placeholder = usingDefault && spec.kind !== 'password' ? spec.defaultValue : undefined;

  const hint = (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {spec.hint}
      <Badge tone={spec.appliesOn === 'immediately' ? 'success' : 'neutral'}>
        {APPLIES_LABEL[spec.appliesOn]}
      </Badge>
      {/* One marker, on every unset field, quiet enough that 166 of them do not
          shout — and carrying the value, so "unset with a default of empty" and
          "unset with nothing behind it" cannot be mistaken for each other. The
          control's own styling (placeholder, dashed switch, option text) says
          the same thing a second time, because a single cue is one theme change
          away from invisible. */}
      {untouched && (
        <span
          className="text-faint"
          title="Not in the config file. The server uses this value; changing it saves it."
        >
          {spec.kind === 'password'
            ? 'not set'
            : spec.defaultValue === undefined
              ? 'not in the config'
              : `default: ${defaultLabel}`}
        </span>
      )}
    </span>
  );

  if (spec.kind === 'flags') {
    return (
      <div className={usingDefault ? 'opacity-70 transition-opacity focus-within:opacity-100' : ''}>
        <FlagField spec={spec} value={effective} hint={hint} onChange={onChange} />
      </div>
    );
  }

  if (spec.kind === 'boolean') {
    return (
      <div className="flex flex-col gap-1.5">
        <div>
          <Toggle
            checked={effective === '1'}
            unset={untouched}
            onChange={(next) => onChange(next ? '1' : '0')}
            label={spec.label}
          />
        </div>
        <p className="text-xs text-muted">{hint}</p>
      </div>
    );
  }

  return (
    <Field
      label={spec.label}
      hint={
        removing ? (
          <span className="text-info">
            Saving removes this setting; the server falls back to its default
            {spec.defaultValue ? ` of ${spec.defaultValue}` : ''}.
          </span>
        ) : (
          hint
        )
      }
      htmlFor={`cvar-${spec.key}`}
    >
      {spec.kind === 'select' ? (
        <Select
          id={`cvar-${spec.key}`}
          value={effective}
          className={usingDefault ? 'text-muted' : ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {/* Preserve an unrecognised existing value rather than silently
              rewriting it to the first option. */}
          {!spec.options?.some((option) => option.value === effective) && (
            <option value={effective}>{effective ? `Current: ${effective}` : 'Not set'}</option>
          )}
          {spec.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {usingDefault && option.value === effective
                ? `Server default — ${option.label}`
                : option.label}
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
          placeholder={placeholder}
          value={usingDefault ? '' : effective}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
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
        toast.error('Save blocked by validation errors', 'Fix the listed problems, or force-save.');
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
          <DownloadLink href="/api/config/download" title="Save the running config to your computer">
            Download
          </DownloadLink>
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
  /** A .cfg the operator picked off their own machine, waiting for a yes. */
  const [upload, setUpload] = useState<{
    name: string;
    content: string;
    problems: ConfigProblem[];
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  /**
   * Restore from a file the operator downloaded earlier.
   *
   * Validated before it is offered, and shown by name with its problems, so
   * "restore" is never a blind overwrite — the wrong file looks exactly like
   * the right one in a Downloads folder. The save takes its own backup first,
   * which makes even a mistaken restore reversible.
   */
  const pickFile = async (file: File) => {
    if (file.size > 1_000_000) {
      toast.error('That file is too large', 'A server config is a few kilobytes; this is not one.');
      return;
    }
    const content = await file.text();
    try {
      const { problems } = await api.config.validate(content);
      setUpload({ name: file.name, content, problems });
    } catch (err) {
      toast.error('Could not read it', err instanceof ApiError ? err.message : 'Unexpected error');
    }
  };

  const applyUpload = async () => {
    if (!upload) return;
    setBusy(true);
    try {
      const result = await api.config.save({
        content: upload.content,
        note: `Restored from uploaded file ${upload.name}`,
        force: true,
        reload: true,
      });
      reportRconHandover(result.rconPassword, toast);
      toast.success('Configuration restored', 'The version you replaced was backed up first.');
      await onRestored();
      await load();
    } catch (err) {
      toast.error('Could not restore', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
      setUpload(null);
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
          ) : (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".cfg,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Cleared so picking the same file twice still fires a change.
                  event.target.value = '';
                  if (file) void pickFile(file);
                }}
              />
              <Button
                size="sm"
                icon={<Upload size={13} aria-hidden />}
                onClick={() => fileInput.current?.click()}
              >
                Restore from file
              </Button>
            </>
          )
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
                <DownloadLink
                  href={`/api/config/backups/${backup.id}/download`}
                  title="Save this backup to your computer"
                >
                  Download
                </DownloadLink>
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
        open={upload !== null}
        tone="danger"
        title={`Restore from ${upload?.name ?? 'file'}?`}
        description={
          <div className="flex flex-col gap-3">
            <span>
              This replaces the running configuration with the contents of that file. The version
              you replace is backed up first, so this is reversible.
            </span>
            {upload && upload.problems.length > 0 ? (
              <ProblemList problems={upload.problems} />
            ) : (
              <span className="text-xs text-muted">
                {upload ? `${upload.content.split('\n').length} lines · no problems found.` : ''}
              </span>
            )}
          </div>
        }
        confirmLabel="Restore"
        loading={busy}
        onConfirm={() => void applyUpload()}
        onCancel={() => setUpload(null)}
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

