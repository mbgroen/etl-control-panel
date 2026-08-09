import { CornerDownLeft, Eraser, ShieldAlert, Terminal } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, Input, Panel } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatClock } from '../lib/format';
import { useToast } from '../lib/toast';
import type { CommandEntry, CommandGroup } from '../lib/types';

/**
 * RCON console.
 *
 * Modelled on a terminal because that is the mental model operators already
 * have: history with the arrow keys, a transcript that scrolls, monospace
 * output. The command palette exists so the common tasks do not require
 * remembering engine cvars — discoverability for newcomers, speed for veterans.
 */

interface Entry {
  id: number;
  kind: 'command' | 'output' | 'error';
  text: string;
  at: string;
}

const MAX_ENTRIES = 400;
let entryId = 0;

/**
 * A quick command that needs a number.
 *
 * Three buttons guessing at 4, 8 and 10 bots is three wrong answers for
 * anyone who wanted 6. One field and one button is smaller on screen and
 * covers every case; the command that will be sent is shown beside it, so
 * pressing Apply holds no surprises.
 */
function NumberCommand({
  entry,
  disabled,
  onRun,
}: {
  entry: CommandEntry;
  disabled: boolean;
  onRun: (command: string) => void;
}) {
  const [value, setValue] = useState(String(entry.input?.defaultValue ?? 0));
  const clean = value.trim();
  const numeric = Number(clean);
  const valid =
    clean !== '' &&
    Number.isInteger(numeric) &&
    numeric >= (entry.input?.min ?? 0) &&
    numeric <= (entry.input?.max ?? 99);

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[13px] text-body">{entry.label}</span>
      <Input
        type="number"
        min={entry.input?.min}
        max={entry.input?.max}
        value={value}
        aria-label={entry.label}
        title={`Sends: ${entry.command} ${clean || '…'}`}
        onChange={(event) => setValue(event.target.value)}
        className="h-7 w-16 px-2 text-right text-xs"
      />
      <Button
        size="sm"
        disabled={disabled || !valid}
        onClick={() => onRun(`${entry.command} ${numeric}`)}
      >
        Apply
      </Button>
    </div>
  );
}

export function ConsolePage() {
  const toast = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState<{ available: boolean; groups: CommandGroup[] } | null>(null);

  // Shell-style history: the index walks backwards from the most recent entry.
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.console.palette().then(setPalette).catch(() => setPalette(null));
  }, []);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries]);

  const append = (kind: Entry['kind'], text: string) => {
    setEntries((current) =>
      [...current, { id: entryId++, kind, text, at: new Date().toISOString() }].slice(-MAX_ENTRIES),
    );
  };

  const run = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || busy) return;

    historyRef.current = [...historyRef.current.filter((c) => c !== trimmed), trimmed].slice(-100);
    historyIndexRef.current = -1;

    append('command', trimmed);
    setCommand('');
    setBusy(true);

    try {
      const result = await api.console.run(trimmed);
      append('output', result.outputPlain || '(no output)');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The command failed';
      append('error', message);
      if (err instanceof ApiError && err.status === 403) {
        toast.warning('Command blocked', message);
      }
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const history = historyRef.current;

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (history.length === 0) return;
      historyIndexRef.current = Math.min(historyIndexRef.current + 1, history.length - 1);
      setCommand(history[history.length - 1 - historyIndexRef.current] ?? '');
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndexRef.current <= 0) {
        historyIndexRef.current = -1;
        setCommand('');
        return;
      }
      historyIndexRef.current -= 1;
      setCommand(history[history.length - 1 - historyIndexRef.current] ?? '');
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(command);
  };

  const rconUnavailable = palette !== null && !palette.available;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_17rem]">
      <Panel
        title="RCON console"
        description="Commands are sent to the running game server over UDP"
        actions={
          <Button
            size="sm"
            icon={<Eraser size={13} aria-hidden />}
            onClick={() => setEntries([])}
            disabled={entries.length === 0}
          >
            Clear
          </Button>
        }
        bodyClassName="flex flex-col p-0"
        className="min-h-[32rem]"
      >
        {rconUnavailable && (
          <div className="flex items-start gap-2 border-b border-warn/30 bg-warn-soft px-4 py-2.5 text-xs text-warn">
            <ShieldAlert size={15} className="mt-px shrink-0" aria-hidden />
            <span>
              No rcon password is set. Add <code className="font-mono">rconpassword</code> on the{' '}
              <Link to="/configuration" className="font-medium underline underline-offset-2">
                Configuration
              </Link>{' '}
              page — the console starts working straight away, with no restart.
            </span>
          </div>
        )}

        <div
          ref={transcriptRef}
          className="min-h-0 flex-1 overflow-y-auto bg-sunken p-3 font-mono text-xs leading-relaxed"
          // Output is announced politely so a screen reader user hears results
          // without losing their place in the input.
          role="log"
          aria-live="polite"
          aria-label="Console output"
        >
          {entries.length === 0 ? (
            <EmptyState
              icon={<Terminal size={24} aria-hidden />}
              title="No commands yet"
              description="Type a command, or pick one from Quick commands. Use ↑ and ↓ to recall history."
            />
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="mb-1.5">
                {entry.kind === 'command' ? (
                  <p className="text-accent">
                    <span className="select-none text-faint">{formatClock(entry.at)} › </span>
                    {entry.text}
                  </p>
                ) : (
                  <pre
                    className={`whitespace-pre-wrap break-words ${
                      entry.kind === 'error' ? 'text-danger' : 'text-muted'
                    }`}
                  >
                    {entry.text}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>

        <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-line p-2.5">
          <span className="select-none pl-1 font-mono text-sm text-accent" aria-hidden>
            ›
          </span>
          <input
            ref={inputRef}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy || rconUnavailable}
            placeholder={rconUnavailable ? 'RCON is not configured' : 'e.g. status, map oasis, say Hello'}
            aria-label="RCON command"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-body placeholder:text-faint focus:outline-none disabled:opacity-50"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!command.trim() || rconUnavailable}
            icon={<CornerDownLeft size={13} aria-hidden />}
          >
            Send
          </Button>
        </form>
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel title="Quick commands" bodyClassName="p-3">
          {palette?.groups.length ? (
            <div className="flex flex-col gap-3">
              {palette.groups.map((group) => (
                <div key={group.name}>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
                    {group.name}
                  </p>
                  <div className="flex flex-col gap-1">
                    {group.commands.map((entry) =>
                      entry.input ? (
                        <NumberCommand
                          key={entry.command}
                          entry={entry}
                          disabled={busy || rconUnavailable}
                          onRun={(command) => void run(command)}
                        />
                      ) : (
                        <button
                          key={entry.command}
                          type="button"
                          disabled={busy || rconUnavailable}
                          onClick={() => void run(entry.command)}
                          className="group flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[13px] text-body transition-colors hover:border-line hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <span className="truncate">{entry.label}</span>
                          {entry.danger && <Badge tone="warn">disruptive</Badge>}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-1 py-2 text-xs text-muted">Quick commands are unavailable.</p>
          )}
        </Panel>

        <Panel title="Tips" bodyClassName="p-3">
          <ul className="flex flex-col gap-2 text-xs text-muted">
            <li>
              <code className="font-mono text-body">say &lt;message&gt;</code> broadcasts to everyone in
              chat.
            </li>
            <li>
              <code className="font-mono text-body">map &lt;name&gt;</code> switches map immediately and
              disconnects nobody.
            </li>
            <li>
              <code className="font-mono text-body">clientkick &lt;slot&gt;</code> — slot numbers are in the
              player table on Overview.
            </li>
            <li>
              Changes made here are <strong className="text-body">not saved</strong> to the config file.
              Edit Configuration to make them survive a restart.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
