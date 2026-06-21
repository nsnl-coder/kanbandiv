import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  // Tailwind max-width class for the dialog card.
  widthClassName?: string;
}

// Backdrop click and Escape both close (Radix default). Focus is trapped and
// restored on close.
export function Modal({ open, onClose, title, children, widthClassName = "max-w-sm" }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className={`fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 text-foreground shadow-lg focus:outline-none sm:inset-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg ${widthClassName}`}
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <Dialog.Title className="text-lg font-semibold text-foreground">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded-lg p-1 text-muted hover:bg-surface-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
