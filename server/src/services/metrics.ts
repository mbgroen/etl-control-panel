import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Rolling activity history for the control panel charts.
 *
 * This is deliberately a bounded in-memory ring buffer flushed to a single JSON
 * file, not a time-series database. At the default 10s poll interval, 2880
 * samples is ~8 hours of history — the horizon an operator actually looks at —
 * for a few hundred KB and zero extra services to run on the NAS.
 */

export interface Sample {
  /** Epoch milliseconds. */
  t: number;
  players: number;
  maxPlayers: number;
  cpuPercent: number;
  memoryBytes: number;
  online: boolean;
  map: string;
}

const STATE_FILE = path.join(env.STATE_PATH, 'history.json');

class History {
  private samples: Sample[] = [];
  private dirty = false;

  push(sample: Sample): void {
    this.samples.push(sample);
    if (this.samples.length > env.HISTORY_POINTS) {
      this.samples.splice(0, this.samples.length - env.HISTORY_POINTS);
    }
    this.dirty = true;
  }

  /**
   * Returns samples from the last `minutes`, thinned to at most `maxPoints`.
   *
   * Thinning happens here rather than in the browser so a long window does not
   * ship tens of thousands of points over the wire to be thrown away by the
   * chart anyway.
   */
  query(minutes: number, maxPoints = 240): Sample[] {
    const cutoff = Date.now() - minutes * 60_000;
    const window = this.samples.filter((s) => s.t >= cutoff);
    if (window.length <= maxPoints) return window;

    const step = window.length / maxPoints;
    const thinned: Sample[] = [];
    for (let i = 0; i < maxPoints; i += 1) {
      const sample = window[Math.floor(i * step)];
      if (sample) thinned.push(sample);
    }
    // Always keep the newest point so the chart's right edge is current.
    const last = window.at(-1);
    if (last && thinned.at(-1)?.t !== last.t) thinned.push(last);
    return thinned;
  }

  summary(minutes: number): { peakPlayers: number; avgPlayers: number; uptimePercent: number } {
    const window = this.query(minutes, Number.MAX_SAFE_INTEGER);
    if (window.length === 0) return { peakPlayers: 0, avgPlayers: 0, uptimePercent: 0 };

    const peakPlayers = window.reduce((max, s) => Math.max(max, s.players), 0);
    const avgPlayers = window.reduce((sum, s) => sum + s.players, 0) / window.length;
    const onlineCount = window.filter((s) => s.online).length;

    return {
      peakPlayers,
      avgPlayers: Number(avgPlayers.toFixed(2)),
      uptimePercent: Number(((onlineCount / window.length) * 100).toFixed(1)),
    };
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(STATE_FILE, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.samples = parsed.filter(isSample).slice(-env.HISTORY_POINTS);
        logger.info({ samples: this.samples.length }, 'restored activity history');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err }, 'could not restore activity history — starting empty');
      }
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
      const temp = `${STATE_FILE}.tmp`;
      await fs.writeFile(temp, JSON.stringify(this.samples), 'utf8');
      await fs.rename(temp, STATE_FILE);
      this.dirty = false;
    } catch (err) {
      logger.warn({ err }, 'could not persist activity history');
    }
  }
}

function isSample(value: unknown): value is Sample {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Sample).t === 'number' &&
    typeof (value as Sample).players === 'number'
  );
}

export const history = new History();
