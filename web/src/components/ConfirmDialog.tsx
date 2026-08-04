import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './ui';

/**
 * Confirmation for destructive or disruptive actions.
 *
 * Deliberately used sparingly — a confirm on every click trains people to
 * dismiss them without reading. It guards exactly the actions that interrupt
 * players or lose data: stopping the server, deleting a pak, restoring a config.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Focus the safe choice, not the destructive one: a stray Enter keypress
    // should cancel, never confirm.
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="rise card w-full max-w-md p-5"
      >
        <div className="flex gap-3">
          <div
            className={`mt-0.5 shrink-0 ${tone === 'danger' ? 'text-danger' : 'text-accent'}`}
            aria-hidden
          >
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-sm font-semibold text-body">
              {title}
            </h2>
            {description && <div className="mt-1.5 text-[13px] text-muted">{description}</div>}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
