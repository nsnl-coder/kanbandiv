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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className={`fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded bg-white p-5 shadow-lg focus:outline-none ${widthClassName}`}
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <Dialog.Title className="text-lg font-semibold text-slate-800">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
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
