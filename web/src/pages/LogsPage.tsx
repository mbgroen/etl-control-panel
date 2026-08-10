import { ArrowDownToLine, Eraser, Filter, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, DownloadLink, Input, Panel } from '../components/ui';
import { useLive } from '../lib/live';

/**
 * Live container logs.
 *
 * Two behaviours matter for a log viewer and both are easy to get wrong:
 * auto-scroll must release the moment the user scrolls up to read something,
 * and pausing must keep buffering rather than dropping lines. Both are handled
 * here so the pane is usable while an incident is actually happening.
 */

const MAX_LINES = 3_000;

/**
 * How much a download asks the daemon for.
 *
 * Deliberately more than the pane holds: the point of saving a log is usually
 * something that happened before you opened the page, and the filter is a
 * reading aid rather than a definition of what is worth keeping — a file with
 * the lines around the interesting one is the one you can actually diagnose
 * from.
 */
const DOWNLOAD_LINES = 10_000;

export function LogsPage() {
  const { subscribeLogs } = useLive();
  const [service, setService] = useState<'game' | 'fastdl'>('game');
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [pinned, setPinned] = useState(true);

  const viewportRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<string[]>([]);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
    // Flush whatever arrived while paused, so nothing is lost on resume.
    if (!paused && bufferRef.current.length > 0) {
      const buffered = bufferRef.current;
      bufferRef.current = [];
      setLines((current) => [...current, ...buffered].slice(-MAX_LINES));
    }
  }, [paused]);

  useEffect(() => {
    setLines([]);
    bufferRef.current = [];

    return subscribeLogs(service, (line) => {
      if (pausedRef.current) {
        bufferRef.current = [...bufferRef.current, line].slice(-MAX_LINES);
        return;
      }
      setLines((current) => [...current, line].slice(-MAX_LINES));
    });
  }, [service, subscribeLogs]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return lines;
    const needle = filter.toLowerCase();
    return lines.filter((line) => line.toLowerCase().includes(needle));
  }, [lines, filter]);

  useEffect(() => {
    if (!pinned) return;
    const node = viewportRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [filtered, pinned]);

  // Unpin as soon as the user scrolls away from the bottom; re-pin when they
  // return. Fighting the user's scroll is the classic log-viewer sin.
  const onScroll = () => {
    const node = viewportRef.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
    setPinned(atBottom);
  };

  return (
    <Panel
      title="Container logs"
      description="Streamed live from the Docker daemon"
      className="h-[calc(100vh-7rem)]"
      bodyClassName="flex min-h-0 flex-col p-0"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Container">
            {(['game', 'fastdl'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setService(option)}
                aria-pressed={service === option}
                className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                  service === option ? 'bg-accent-soft text-accent' : 'text-muted hover:text-body'
                }`}
              >
                {option === 'game' ? 'Game server' : 'FastDL'}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            icon={paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button size="sm" icon={<Eraser size={13} aria-hidden />} onClick={() => setLines([])}>
            Clear
          </Button>
          <DownloadLink
            href={`/api/system/logs/${service}/download?tail=${DOWNLOAD_LINES}`}
            title={`Save the last ${DOWNLOAD_LINES.toLocaleString()} lines to your computer`}
          >
            Download
          </DownloadLink>
        </div>
      }
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Filter
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter lines…"
            aria-label="Filter log lines"
            className="h-8 pl-8 font-mono text-xs"
          />
        </div>
        <span className="tabular shrink-0 text-[11px] text-faint">
          {filter ? `${filtered.length} of ${lines.length}` : `${lines.length} lines`}
        </span>
        {paused && <Badge tone="warn">Paused · buffering</Badge>}
      </div>

      <div
        ref={viewportRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto bg-sunken p-3 font-mono text-xs leading-relaxed"
        role="log"
        aria-label={`${service} container logs`}
      >
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-muted">
            {lines.length === 0
              ? 'Waiting for output — the container may be idle or stopped.'
              : 'No lines match the filter.'}
          </p>
        ) : (
          filtered.map((line, index) => (
            <div key={index} className="whitespace-pre-wrap break-words text-muted">
              {line}
            </div>
          ))
        )}
      </div>

      {!pinned && (
        <div className="shrink-0 border-t border-line p-2">
          <Button
            size="sm"
            icon={<ArrowDownToLine size={13} aria-hidden />}
            onClick={() => {
              setPinned(true);
              const node = viewportRef.current;
              if (node) node.scrollTop = node.scrollHeight;
            }}
            className="w-full"
          >
            Jump to latest
          </Button>
        </div>
      )}
    </Panel>
  );
}
