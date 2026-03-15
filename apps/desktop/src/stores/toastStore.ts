import { create } from 'zustand';

export type ToastVariant = 'default' | 'destructive';

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void;
  dismissToast: (id: string) => void;
}

const DEFAULT_DURATION_MS = 5000;
const MAX_TOASTS = 5;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (message, variant = 'default', duration = DEFAULT_DURATION_MS) => {
    const { toasts } = get();

    // Deduplicate: skip if an identical message with the same variant is already showing
    const isDuplicate = toasts.some(
      (t) => t.message === message && t.variant === variant,
    );
    if (isDuplicate) return;

    const id = crypto.randomUUID();
    const newToast: ToastItem = { id, message, variant, duration };

    // Keep a bounded number of toasts visible
    const updated = [...toasts, newToast].slice(-MAX_TOASTS);
    set({ toasts: updated });
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/**
 * Convenience helper for showing error toasts from non-React code (stores, utils).
 * Avoids the need to import and call `useToastStore.getState()` everywhere.
 */
export function showErrorToast(message: string): void {
  useToastStore.getState().addToast(message, 'destructive');
}
