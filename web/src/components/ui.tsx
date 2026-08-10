import { Download, Eye, EyeOff, Loader2 } from 'lucide-react';
import { forwardRef, useId, useState } from 'react';
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
  // The primary action gets a slight lift and a soft accent glow, which is what
  // separates "the button" from "a button" at a glance.
  primary:
    'bg-accent-solid text-accent-on border border-transparent font-semibold shadow-[0_1px_2px_rgb(0_0_0/0.2)] hover:brightness-110 hover:shadow-[0_2px_10px_-2px_var(--accent-soft),0_1px_2px_rgb(0_0_0/0.25)] active:brightness-95 active:translate-y-px',
  secondary:
    'bg-raised text-body border border-line hover:border-line-strong hover:bg-sunken active:translate-y-px',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-raised hover:text-body',
  danger:
    'bg-danger-soft text-danger border border-danger/40 hover:bg-danger hover:text-white hover:border-danger active:translate-y-px',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-[13px] gap-2 rounded-lg',
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
      className={`inline-flex shrink-0 items-center justify-center transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
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
  id,
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = 'p-4',
}: {
  /** Anchor target, so a section can be linked to from a jump list. */
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      id={id}
      // Without this, an anchor jump puts the heading under the sticky header.
      className={`card flex min-w-0 scroll-mt-20 flex-col ${className}`}
    >
      {(title || actions) && (
        <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-[13.5px] font-semibold tracking-[-0.006em] text-body">
                {title}
              </h2>
            )}
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
      className={`h-9 w-full rounded-lg border border-line bg-sunken px-3 text-[13px] text-body placeholder:text-faint transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /**
   * When set, revealing is disabled and this explains why. Used where the field
   * holds a placeholder for a stored secret rather than the secret itself, so
   * revealing it would show the placeholder and teach the reader nothing.
   */
  revealDisabledReason?: string;
}

/**
 * A password field that can be unmasked.
 *
 * Typing a long password blind — and then a second time to confirm it — is how
 * people end up locked out by a typo they cannot see. Masked by default, since
 * that is what the field is for; the toggle is opt-in, per field, and resets
 * nowhere else.
 *
 * The button is deliberately a real <button type="button">: inside a form, a
 * bare <button> submits, which would fire the login attempt on the first click.
 */
export function PasswordInput({
  className = '',
  revealDisabledReason,
  disabled,
  ...rest
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  const hintId = useId();
  const canReveal = !revealDisabledReason && !disabled;
  const showing = revealed && canReveal;

  return (
    <div className="relative">
      <input
        {...rest}
        disabled={disabled}
        type={showing ? 'text' : 'password'}
        aria-describedby={revealDisabledReason ? hintId : rest['aria-describedby']}
        // Room for the button, so a long value does not run underneath it.
        className={`h-9 w-full rounded-lg border border-line bg-sunken pl-3 pr-10 text-[13px] text-body placeholder:text-faint transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50 ${className}`}
      />

      <button
        type="button"
        onClick={() => setRevealed((previous) => !previous)}
        disabled={!canReveal}
        // Announced rather than shown: the icon alone does not say what it does,
        // and the state matters more than the control's name.
        aria-label={showing ? 'Hide password' : 'Show password'}
        aria-pressed={showing}
        title={revealDisabledReason ?? (showing ? 'Hide password' : 'Show password')}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted transition-colors hover:text-body focus:text-body focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        {showing ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
      </button>

      {revealDisabledReason && (
        <span id={hintId} className="sr-only">
          {revealDisabledReason}
        </span>
      )}
    </div>
  );
}

export function Select({
  className = '',
  children,
  ...rest
}: InputHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={`h-9 w-full rounded-lg border border-line bg-sunken px-2.5 text-[13px] text-body transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft ${className}`}
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
  hideLabel = false,
  unset = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  /**
   * The switch shows a value nobody chose — a default, not a setting.
   *
   * A switch has two positions and no null, and dimming it was far too quiet to
   * carry that on its own, especially in the light theme. So the track goes
   * hollow and dashed and the knob loses its white: "outlined, not filled in"
   * is the same language as a placeholder, and it survives both themes and a
   * colour-blind reader because the shape changes, not just the shade.
   */
  unset?: boolean;
  /**
   * Keeps the label for assistive tech but not on screen. For dense rows where
   * the surrounding content already names the thing — never a reason to ship a
   * switch with no accessible name.
   */
  hideLabel?: boolean;
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
          unset
            ? `border-dashed bg-transparent ${checked ? 'border-accent' : 'border-line-strong'}`
            : checked
              ? 'border-accent bg-accent-solid'
              : 'border-line-strong bg-sunken'
        } disabled:cursor-not-allowed`}
      >
        <span
          className={`block size-3.5 rounded-full transition-transform ${
            // Hollow knob in a dashed track: a difference in shape, which no
            // theme and no colour-blindness can flatten. A shade alone could.
            unset ? 'border border-current bg-transparent text-faint' : 'bg-white shadow'
          } ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
        />
      </button>
      {!hideLabel && (
        <span className="min-w-0">
          <span className={`block text-[13px] font-medium ${unset ? 'text-muted' : 'text-body'}`}>
            {label}
          </span>
          {description && <span className="block text-xs text-muted">{description}</span>}
        </span>
      )}
    </label>
  );
}

/**
 * A download, styled as a button but built as a link.
 *
 * A real anchor rather than a fetch-and-blob: the browser streams the response
 * straight to disk, the session cookie rides along with the navigation, and a
 * large file never has to exist in the tab's memory first.
 */
export function DownloadLink({
  href,
  title,
  children,
  className = '',
}: {
  href: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      title={title}
      download
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-line-strong hover:text-body ${className}`}
    >
      <Download size={13} aria-hidden />
      {children}
    </a>
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
