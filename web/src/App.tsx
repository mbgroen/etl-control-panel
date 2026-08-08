import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { api, setUnauthorizedHandler } from './lib/api';
import { LiveProvider } from './lib/live';
import { ToastProvider } from './lib/toast';
import { ConfigPage } from './pages/ConfigPage';
import { ConsolePage } from './pages/ConsolePage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { FastdlPage } from './pages/FastdlPage';
import { MapsPage } from './pages/MapsPage';
import { Login } from './pages/Login';
import { LogsPage } from './pages/LogsPage';
import { Overview } from './pages/Overview';
import { PlayersPage } from './pages/PlayersPage';
import { AccountsPage } from './pages/AccountsPage';
import { SettingsPage } from './pages/SettingsPage';
import { Setup } from './pages/Setup';

type Session =
  | { status: 'checking' }
  | { status: 'setup'; minPasswordLength: number }
  | { status: 'out' }
  | { status: 'in'; username: string };

export function App() {
  const [session, setSession] = useState<Session>({ status: 'checking' });

  useEffect(() => {
    // A 401 from any endpoint — including an expired session mid-use — drops
    // straight back to the login screen instead of leaving a dead UI.
    setUnauthorizedHandler(() => setSession({ status: 'out' }));

    // Resolve in one pass: an existing session wins, otherwise ask whether the
    // control panel has been claimed yet, so a fresh install lands on setup rather
    // than on a login form nobody has credentials for.
    void (async () => {
      try {
        const { user } = await api.auth.session();
        setSession({ status: 'in', username: user.username });
        return;
      } catch {
        /* no active session — fall through */
      }

      try {
        const status = await api.auth.status();
        setSession(
          status.needsSetup
            ? { status: 'setup', minPasswordLength: status.minPasswordLength }
            : { status: 'out' },
        );
      } catch {
        setSession({ status: 'out' });
      }
    })();
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setSession({ status: 'out' });
    }
  }, []);

  if (session.status === 'checking') {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <Spinner label="Starting control panel" />
      </div>
    );
  }

  if (session.status === 'setup') {
    return (
      <ToastProvider>
        <Setup
          minPasswordLength={session.minPasswordLength}
          onComplete={(username) => setSession({ status: 'in', username })}
        />
      </ToastProvider>
    );
  }

  if (session.status === 'out') {
    return (
      <ToastProvider>
        <Login onSuccess={(username) => setSession({ status: 'in', username })} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      {/* LiveProvider mounts only once authenticated: the WebSocket upgrade
          requires a session cookie and would be rejected otherwise. */}
      <LiveProvider>
        <BrowserRouter>
          <AppShell onLogout={() => void logout()}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/players" element={<PlayersPage />} />
              <Route path="/console" element={<ConsolePage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/configuration" element={<ConfigPage />} />
              <Route path="/maps" element={<MapsPage />} />
              <Route path="/fastdl" element={<FastdlPage />} />
              {/* The two used to share one page; keep old links working. */}
              <Route path="/downloads" element={<Navigate to="/maps" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </LiveProvider>
    </ToastProvider>
  );
}
