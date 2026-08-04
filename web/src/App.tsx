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
import { DownloadsPage } from './pages/DownloadsPage';
import { Login } from './pages/Login';
import { LogsPage } from './pages/LogsPage';
import { Overview } from './pages/Overview';

type Session = { status: 'checking' } | { status: 'out' } | { status: 'in'; username: string };

export function App() {
  const [session, setSession] = useState<Session>({ status: 'checking' });

  useEffect(() => {
    // A 401 from any endpoint — including an expired session mid-use — drops
    // straight back to the login screen instead of leaving a dead UI.
    setUnauthorizedHandler(() => setSession({ status: 'out' }));

    void api.auth
      .session()
      .then(({ user }) => setSession({ status: 'in', username: user.username }))
      .catch(() => setSession({ status: 'out' }));
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
        <Spinner label="Starting dashboard" />
      </div>
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
              <Route path="/console" element={<ConsolePage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/configuration" element={<ConfigPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </LiveProvider>
    </ToastProvider>
  );
}
