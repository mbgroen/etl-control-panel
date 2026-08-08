import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import type { Snapshot } from './types';

/**
 * Live connection to the server.
 *
 * One WebSocket is shared by the whole app. It carries status snapshots
 * continuously and container logs on demand; when it drops, an exponential
 * backoff reconnects and an HTTP poll keeps the UI truthful in the meantime.
 * A control panel that silently shows stale numbers is worse than one that admits
 * it is disconnected, so connection state is surfaced, never hidden.
 */

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

type LogListener = (line: string) => void;

interface LiveContextValue {
  snapshot: Snapshot | null;
  connection: ConnectionState;
  /** Forces an immediate HTTP refresh, e.g. straight after a lifecycle action. */
  refresh: () => Promise<void>;
  subscribeLogs: (service: 'game' | 'fastdl', listener: LogListener) => () => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

const MAX_BACKOFF_MS = 15_000;

export function LiveProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  const socketRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1_000);
  const reconnectRef = useRef<number | null>(null);
  const listenersRef = useRef(new Map<string, Set<LogListener>>());
  const closedByUsRef = useRef(false);

  const send = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.server.status());
    } catch {
      // The API client already routes 401s to the login screen; anything else
      // here is transient and the next poll or reconnect will correct it.
    }
  }, []);

  useEffect(() => {
    closedByUsRef.current = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        setConnection('live');
        backoffRef.current = 1_000;
        // Re-subscribe: the server does not remember channels across a reconnect.
        for (const [service, listeners] of listenersRef.current) {
          if (listeners.size > 0) send({ type: 'subscribe', channel: `logs:${service}` });
        }
      });

      socket.addEventListener('message', (event) => {
        let message: {
          type?: string;
          data?: Snapshot;
          service?: string;
          line?: string;
          lines?: string[];
        };
        try {
          message = JSON.parse(event.data as string);
        } catch {
          return;
        }

        if (message.type === 'snapshot' && message.data) {
          setSnapshot(message.data);
          return;
        }

        if (message.type === 'log' && message.service && message.line !== undefined) {
          for (const listener of listenersRef.current.get(message.service) ?? []) {
            listener(message.line);
          }
          return;
        }

        if (message.type === 'log-backlog' && message.service && message.lines) {
          const listeners = listenersRef.current.get(message.service);
          if (!listeners) return;
          for (const line of message.lines) {
            for (const listener of listeners) listener(line);
          }
        }
      });

      socket.addEventListener('close', () => {
        if (closedByUsRef.current) return;
        setConnection('reconnecting');
        scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        // 'close' always follows, so reconnection is handled in one place.
        socket.close();
      });
    };

    const scheduleReconnect = () => {
      if (reconnectRef.current !== null) return;
      const wait = backoffRef.current;
      backoffRef.current = Math.min(wait * 2, MAX_BACKOFF_MS);

      reconnectRef.current = window.setTimeout(() => {
        reconnectRef.current = null;
        void refresh();
        connect();
      }, wait);
    };

    connect();
    void refresh();

    // Coming back from a sleeping laptop, reconnect at once rather than waiting
    // out the backoff the browser accumulated while the tab was frozen.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refresh();
      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        backoffRef.current = 1_000;
        if (reconnectRef.current !== null) {
          window.clearTimeout(reconnectRef.current);
          reconnectRef.current = null;
        }
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      closedByUsRef.current = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (reconnectRef.current !== null) window.clearTimeout(reconnectRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [refresh, send]);

  const subscribeLogs = useCallback(
    (service: 'game' | 'fastdl', listener: LogListener) => {
      const listeners = listenersRef.current.get(service) ?? new Set<LogListener>();
      const isFirst = listeners.size === 0;
      listeners.add(listener);
      listenersRef.current.set(service, listeners);

      if (isFirst) send({ type: 'subscribe', channel: `logs:${service}` });

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) send({ type: 'unsubscribe', channel: `logs:${service}` });
      };
    },
    [send],
  );

  const value = useMemo<LiveContextValue>(
    () => ({ snapshot, connection, refresh, subscribeLogs }),
    [snapshot, connection, refresh, subscribeLogs],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const context = useContext(LiveContext);
  if (!context) throw new Error('useLive must be used inside a LiveProvider');
  return context;
}
