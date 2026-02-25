import { useState, useCallback } from "react";
import type { ToastItem } from "../components/Toast";

export type UseToastsReturn = {
  toasts: ToastItem[];
  addToast: (type: ToastItem["type"], message: string) => void;
  dismissToast: (id: string) => void;
};

/**
 * Standalone hook for toast notification state.
 *
 * `addToast` has a stable callback identity (empty deps) so it can be safely
 * passed to other hooks without triggering their re-creation.
 */
export function useToasts(): UseToastsReturn {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastItem["type"], message: string) => {
    setToasts((prev) => {
      const now = Date.now();
      const isDuplicate = prev.some(
        (t) => t.message === message && t.type === type && now - Number(t.id.split("-")[0]) < 2000,
      );
      if (isDuplicate) return prev;
      const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
      return [...prev, { id, type, message }];
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}
