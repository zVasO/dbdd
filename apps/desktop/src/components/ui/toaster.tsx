import { Toast as ToastPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { cn } from '@/lib/utils';

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismissToast = useToastStore((s) => s.dismissToast);

  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
      {toasts.map((toast) => (
        <ToastPrimitive.Root
          key={toast.id}
          duration={toast.duration}
          onOpenChange={(open) => {
            if (!open) {
              dismissToast(toast.id);
            }
          }}
          className={cn(
            'group pointer-events-auto relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-md border p-4 shadow-lg transition-all',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-80 data-[state=open]:fade-in-0',
            'data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full',
            'data-[swipe=cancel]:translate-x-0 data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
            'data-[swipe=end]:animate-out data-[swipe=end]:slide-out-to-right-full',
            toast.variant === 'destructive'
              ? 'border-destructive bg-destructive text-white'
              : toast.variant === 'success'
              ? 'border-green-600 bg-green-600 text-white'
              : 'border-border bg-background text-foreground',
          )}
        >
          <ToastPrimitive.Description className="text-sm leading-snug">
            {toast.message}
          </ToastPrimitive.Description>
          <ToastPrimitive.Close
            className={cn(
              'shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2',
              toast.variant === 'destructive' || toast.variant === 'success'
                ? 'text-white focus:ring-white/50'
                : 'text-foreground focus:ring-ring',
            )}
            aria-label="Dismiss"
          >
            <XIcon className="size-4" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport
        className="fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:flex-col sm:max-w-[420px]"
      />
    </ToastPrimitive.Provider>
  );
}
