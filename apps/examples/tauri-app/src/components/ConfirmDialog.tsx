import { useEffect, useRef, useCallback } from "react";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // For danger dialogs, auto-focus Cancel to prevent accidental confirms.
    // For default dialogs, auto-focus Confirm as the expected action.
    if (variant === "danger") {
      cancelRef.current?.focus();
    } else {
      confirmRef.current?.focus();
    }
  }, [open, variant]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
      // Simple focus trap between the two buttons
      if (e.key === "Tab") {
        const a = cancelRef.current;
        const b = confirmRef.current;
        if (!a || !b) return;
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    },
    [onCancel],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onCancel();
      }
    },
    [onCancel],
  );

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
    >
      <div className="modal-card confirm-dialog">
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="confirm-dialog-actions">
          <button ref={cancelRef} className="secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className={variant === "danger" ? "danger" : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
