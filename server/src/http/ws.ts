import type { Server } from 'node:http';
import type { Duplex as NodeDuplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../logger.js';
import * as docker from '../services/docker.js';
import { poller, type Snapshot } from '../services/poller.js';
import { authenticateUpgrade } from './auth.js';

/**
 * Realtime channel for the control panel.
 *
 * Two things stream: the poller's status snapshots (fan-out of one shared
 * poll), and container logs. Log follow streams are opened once per service and
 * reference-counted across subscribers — a dozen open browser tabs must not
 * mean a dozen follow streams against the Docker daemon.
 */

type Channel = 'status' | 'logs:game' | 'logs:fastdl';

interface ClientState {
  socket: WebSocket;
  channels: Set<Channel>;
  alive: boolean;
  username: string;
}

const clients = new Set<ClientState>();

/** Keeps a bounded tail per service so a new subscriber gets instant context. */
class LogBroadcaster {
  private stream: NodeDuplex | null = null;
  private subscribers = 0;
  private buffer: string[] = [];
  private partial = '';
  private readonly maxBuffer = 300;

  constructor(private readonly service: docker.ManagedService) {}

  get backlog(): string[] {
    return this.buffer;
  }

  async subscribe(): Promise<void> {
    this.subscribers += 1;
    if (this.stream) return;

    try {
      const stream = await docker.logsStream(this.service, 200);
      this.stream = stream;

      stream.on('data', (chunk: Buffer) => this.ingest(chunk));
      stream.on('error', (err) => {
        logger.warn({ err, service: this.service }, 'log stream error');
        this.teardown();
      });
      stream.on('end', () => this.teardown());
    } catch (err) {
      this.subscribers = Math.max(0, this.subscribers - 1);
      throw err;
    }
  }

  unsubscribe(): void {
    this.subscribers = Math.max(0, this.subscribers - 1);
    if (this.subscribers === 0) this.teardown();
  }

  private ingest(chunk: Buffer): void {
    // Docker frames may split mid-line; hold the remainder until the next chunk
    // so the UI never renders half a log line.
    const text = this.partial + docker.demultiplex(chunk);
    const lines = text.split('\n');
    this.partial = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim() === '') continue;
      this.buffer.push(line);
      broadcast(`logs:${this.service}` as Channel, { type: 'log', service: this.service, line });
    }

    if (this.buffer.length > this.maxBuffer) {
      this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    }
  }

  private teardown(): void {
    this.stream?.destroy();
    this.stream = null;
    this.partial = '';
  }
}

const broadcasters: Record<docker.ManagedService, LogBroadcaster> = {
  game: new LogBroadcaster('game'),
  fastdl: new LogBroadcaster('fastdl'),
};

function broadcast(channel: Channel, payload: unknown): void {
  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (!client.channels.has(channel)) continue;
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    client.socket.send(message);
  }
}

const CHANNELS: readonly Channel[] = ['status', 'logs:game', 'logs:fastdl'];

function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

export function attachWebSocket(server: Server): void {
  // noServer + a manual upgrade handler, so an unauthenticated client is
  // rejected before the WebSocket handshake completes rather than after.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/api/ws')) {
      socket.destroy();
      return;
    }

    const user = authenticateUpgrade(req);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, user);
    });
  });

  wss.on('connection', (socket: WebSocket, _req: unknown, user: { username: string }) => {
    const client: ClientState = {
      socket,
      channels: new Set<Channel>(['status']),
      alive: true,
      username: user.username,
    };
    clients.add(client);

    // Send current state immediately so the UI is never briefly empty.
    const snapshot = poller.current();
    socket.send(JSON.stringify({ type: 'hello', channels: [...client.channels] }));
    if (snapshot) socket.send(JSON.stringify({ type: 'snapshot', data: snapshot }));

    socket.on('pong', () => {
      client.alive = true;
    });

    socket.on('message', (raw) => {
      void handleMessage(client, raw.toString());
    });

    socket.on('close', () => {
      for (const channel of client.channels) {
        if (channel.startsWith('logs:')) {
          broadcasters[channel.slice(5) as docker.ManagedService]?.unsubscribe();
        }
      }
      clients.delete(client);
    });

    socket.on('error', (err) => {
      logger.debug({ err }, 'websocket client error');
    });
  });

  async function handleMessage(client: ClientState, raw: string): Promise<void> {
    let message: { type?: string; channel?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isChannel(message.channel)) return;
    const channel = message.channel;

    if (message.type === 'subscribe' && !client.channels.has(channel)) {
      if (channel.startsWith('logs:')) {
        const service = channel.slice(5) as docker.ManagedService;
        try {
          await broadcasters[service].subscribe();
        } catch (err) {
          client.socket.send(
            JSON.stringify({
              type: 'error',
              channel,
              message: err instanceof Error ? err.message : 'Cannot open log stream',
            }),
          );
          return;
        }
        client.channels.add(channel);
        // Replay the buffered tail so the pane is populated on open.
        client.socket.send(
          JSON.stringify({ type: 'log-backlog', service, lines: broadcasters[service].backlog }),
        );
        return;
      }
      client.channels.add(channel);
    }

    if (message.type === 'unsubscribe' && client.channels.has(channel)) {
      client.channels.delete(channel);
      if (channel.startsWith('logs:')) {
        broadcasters[channel.slice(5) as docker.ManagedService]?.unsubscribe();
      }
    }
  }

  poller.on('snapshot', (snapshot: Snapshot) => {
    broadcast('status', { type: 'snapshot', data: snapshot });
  });

  // Drop half-open connections (sleeping laptops, dropped Wi-Fi) so log stream
  // reference counts do not leak.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  server.on('close', () => {
    clearInterval(heartbeat);
    wss.close();
  });

  logger.info('websocket endpoint ready at /api/ws');
}
