import * as Toast from "@radix-ui/react-toast";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { useToastStore, type Toast as ToastData } from "../hooks/useToastStore";

// Radix Toast viewport driven by the zustand queue, so any component can call
// useToastStore().add(...) and the toast persists across route changes.
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  return (
    <Toast.Provider swipeDirection="up" duration={3000}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
      ))}
      <Toast.Viewport className="fixed left-1/2 top-4 z-[60] flex w-80 max-w-[100vw] -translate-x-1/2 flex-col items-center gap-2 outline-none" />
    </Toast.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: ToastData; onClose: () => void }) {
  const success = toast.variant === "success";

  return (
    <Toast.Root
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-foreground/80 shadow-lg data-[state=closed]:animate-[fadeOut_150ms_ease-in] data-[swipe=end]:animate-[fadeOut_150ms_ease-in]"
    >
      {success ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
      )}
      <Toast.Title className="flex-1">{toast.message}</Toast.Title>
      <Toast.Close
        aria-label="Dismiss"
        className="rounded p-0.5 text-muted hover:bg-surface-muted hover:text-foreground/70"
      >
        <X className="h-3.5 w-3.5" />
      </Toast.Close>
    </Toast.Root>
  );
}
