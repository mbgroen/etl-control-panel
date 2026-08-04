import {
  Activity,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Stethoscope,
  Sun,
  Terminal,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ColorText } from '../lib/etColors';
import { useLive } from '../lib/live';
import { Badge, Button, StatusDot } from './ui';

/**
 * Application shell: identity, navigation, live status.
 *
 * Six destinations, flat — under Miller's limit, so no nesting or overflow menu
 * is needed. The header keeps the two facts an operator checks constantly
 * (is the server up, is this page current) visible from every screen.
 */

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/console', label: 'Console', icon: Terminal, end: false },
  { to: '/logs', label: 'Logs', icon: Activity, end: false },
  { to: '/configuration', label: 'Configuration', icon: SlidersHorizontal, end: false },
  { to: '/downloads', label: 'Maps & FastDL', icon: Download, end: false },
  { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope, end: false },
] as const;

export function AppShell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const { snapshot, connection } = useLive();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer on navigation, otherwise it covers the page the
  // user just asked for.
  useEffect(() => setNavOpen(false), [location.pathname]);

  const online = snapshot?.game.status.online ?? false;
  const hostname = snapshot?.game.status.hostname;

  return (
    <div className="flex h-full">
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface transition-transform lg:static lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-solid text-[13px] font-bold text-accent-on"
            aria-hidden
          >
            ET
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight text-body">Legacy Server</p>
            <p className="truncate text-[11px] leading-tight text-faint">Control Panel</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded p-1 text-muted lg:hidden"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2" aria-label="Main">
          <ul className="flex flex-col gap-0.5">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors ${
                      isActive
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-muted hover:bg-raised hover:text-body'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={16} aria-hidden />
                      {label}
                      {/* Marks the current page for screen readers, which cannot
                          see the highlight. */}
                      {isActive && <span className="sr-only">(current page)</span>}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-line p-2">
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              icon={<LogOut size={14} aria-hidden />}
              onClick={onLogout}
              className="flex-1 justify-start"
            >
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur">
          <button
            type="button"
            className="rounded p-1.5 text-muted hover:text-body lg:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={18} aria-hidden />
          </button>

          <div className="min-w-0 flex-1">
            {hostname ? (
              <ColorText value={hostname} className="truncate text-[13px] font-semibold" />
            ) : (
              <span className="text-[13px] text-muted">
                {snapshot ? 'Server offline' : 'Connecting…'}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={online ? 'success' : 'danger'}>
              <StatusDot tone={online ? 'success' : 'danger'} pulse={online} />
              {online ? 'Online' : 'Offline'}
            </Badge>
            <ConnectionBadge state={connection} />
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function ConnectionBadge({ state }: { state: ReturnType<typeof useLive>['connection'] }) {
  // Only surfaced when it is *not* healthy: a permanent "live" chip becomes
  // furniture and stops being read.
  if (state === 'live') return null;

  const tone = state === 'connecting' ? 'info' : 'warn';
  const label = state === 'connecting' ? 'Connecting' : 'Reconnecting';

  return (
    <Badge tone={tone} className="hidden sm:inline-flex">
      <StatusDot tone={tone} pulse />
      {label}
    </Badge>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (document.documentElement.dataset.theme as 'dark' | 'light') ?? 'dark',
  );

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('etl-theme', next);
    } catch {
      /* private browsing — the choice just will not persist */
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      icon={theme === 'dark' ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
    />
  );
}
