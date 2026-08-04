import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Transient feedback.
 *
 * Every mutating action in the app confirms itself here, because an operator
 * clicking "Restart" needs to know whether Docker accepted it — silence reads
 * as a broken button. Errors persist until dismissed; successes auto-expire.
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  notify: (tone: ToastTone, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS: Record<ToastTone, number | null> = {
  success: 4_000,
  info: 5_000,
  warning: 8_000,
  // Errors stay until dismissed — they usually carry a remedy worth reading.
  error: null,
};

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'text-success border-success/40',
  error: 'text-danger border-danger/40',
  warning: 'text-warn border-warn/40',
  info: 'text-info border-info/40',
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = nextId++;
      setToasts((current) => [...current.slice(-4), { id, tone, title, description }]);

      const ttl = AUTO_DISMISS_MS[tone];
      if (ttl !== null) window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      notify,
      success: (title, description) => notify('success', title, description),
      error: (title, description) => notify('error', title, description),
      warning: (title, description) => notify('warning', title, description),
    }),
    [notify],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        // Announced by screen readers without stealing focus.
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];
          return (
            <div
              key={toast.id}
              className={`rise pointer-events-auto flex items-start gap-3 rounded-lg border bg-raised p-3 shadow-lg ${TONE_CLASS[toast.tone]}`}
            >
              <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-body">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 break-words text-xs text-muted">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-body"
                aria-label="Dismiss notification"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
