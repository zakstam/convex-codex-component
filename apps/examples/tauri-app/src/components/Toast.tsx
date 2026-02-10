import { useEffect } from "react";

export type ToastItem = {
  id: string;
  type: "error" | "success" | "info";
  message: string;
};

const TOAST_ICONS: Record<string, string> = {
  error: "!",
  success: "\u2713",
  info: "i",
};

type ToastProps = {
  toast: ToastItem;
  onDismiss: (id: string) => void;
};

function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className={`toast toast-${toast.type}`} role="alert" aria-live="assertive">
      <span className="toast-icon">{TOAST_ICONS[toast.type]}</span>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-dismiss"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

type ContainerProps = {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
};

export function ToastContainer({ toasts, onDismiss }: ContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-label="Notifications">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
