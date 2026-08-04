import { Loader2 } from 'lucide-react';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/**
 * Base component set.
 *
 * Every interactive control here meets the same bar: a visible focus ring, a
 * disabled state that is obviously disabled, and a minimum 36px hit area
 * (44px for anything primary). Variants are named by role — `danger` means
 * "this destroys something", not "this is red".
 */

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-solid text-accent-on hover:brightness-110 active:brightness-95 border border-transparent font-semibold',
  secondary:
    'bg-raised text-body border border-line hover:border-line-strong hover:bg-sunken',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-raised hover:text-body',
  danger: 'bg-danger-soft text-danger border border-danger/40 hover:bg-danger hover:text-white',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, children, className = '', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      // aria-busy tells assistive tech the control is working, which the
      // spinner alone does not convey.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------------------- */
/* Badge                                                                       */
/* -------------------------------------------------------------------------- */

export type BadgeTone = 'neutral' | 'success' | 'danger' | 'warn' | 'info' | 'accent';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-muted border-line',
  success: 'bg-success-soft text-success border-success/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  info: 'bg-info-soft text-info border-info/30',
  accent: 'bg-accent-soft text-accent border-accent/30',
};

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Status dot. Never used alone — always paired with a text label, so the
 *  meaning does not rest on colour perception. */
export function StatusDot({ tone, pulse = false }: { tone: BadgeTone; pulse?: boolean }) {
  const color =
    tone === 'success'
      ? 'bg-success'
      : tone === 'danger'
        ? 'bg-danger'
        : tone === 'warn'
          ? 'bg-warn'
          : tone === 'info'
            ? 'bg-info'
            : 'bg-faint';
  return <span className={`size-2 shrink-0 rounded-full ${color} ${pulse ? 'live-dot' : ''}`} aria-hidden />;
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = 'p-4',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card flex min-w-0 flex-col ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[13px] font-semibold text-body">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                               */
/* -------------------------------------------------------------------------- */

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, htmlFor, children, className = '' }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-body">
        {label}
      </label>
      {children}
      {/* Hint stays visible alongside the error: the error says what is wrong,
          the hint says what "right" looks like. */}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-9 w-full rounded-md border border-line bg-sunken px-3 text-[13px] text-body placeholder:text-faint transition-colors focus:border-accent focus:outline-none disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}

export function Select({
  className = '',
  children,
  ...rest
}: InputHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={`h-9 w-full rounded-md border border-line bg-sunken px-2.5 text-[13px] text-body transition-colors focus:border-accent focus:outline-none ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-accent bg-accent-solid' : 'border-line-strong bg-sunken'
        } disabled:cursor-not-allowed`}
      >
        <span
          className={`block size-3.5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-body">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                      */
/* -------------------------------------------------------------------------- */

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-muted">
      <Loader2 size={16} className="spin" aria-hidden />
      <span className="text-[13px]">{label}…</span>
    </div>
  );
}

/**
 * Empty state.
 *
 * Always offers the next action rather than just announcing emptiness — a dead
 * end is a design failure, not a state.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <p className="text-[13px] font-medium text-body">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <EmptyState
      title="Something went wrong"
      description={message}
      action={retry && <Button onClick={retry}>Try again</Button>}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Stat tile                                                                   */
/* -------------------------------------------------------------------------- */

export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
}) {
  const accent =
    tone === 'success'
      ? 'text-success'
      : tone === 'danger'
        ? 'text-danger'
        : tone === 'warn'
          ? 'text-warn'
          : tone === 'accent'
            ? 'text-accent'
            : 'text-body';

  return (
    <div className="card flex min-w-0 items-start gap-3 p-4">
      {icon && <div className={`mt-0.5 shrink-0 ${accent}`}>{icon}</div>}
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
        <p className={`tabular mt-1 truncate text-xl font-semibold leading-tight ${accent}`}>{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
      </div>
    </div>
  );
}
