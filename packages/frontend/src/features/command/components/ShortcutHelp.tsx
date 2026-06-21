import { Modal } from "../../../components/Modal";
import { useShortcutHelpStore } from "../useShortcutHelpStore";
import { SHORTCUTS } from "../shortcuts";

export function ShortcutHelp() {
  const open = useShortcutHelpStore((s) => s.open);
  const setOpen = useShortcutHelpStore((s) => s.setOpen);

  if (!open) return null;

  return (
    <Modal
      open
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      widthClassName="max-w-lg"
    >
      <ul className="flex flex-col gap-1.5">
        {SHORTCUTS.map((row) => (
          <li
            key={row.description + row.keys.join("+")}
            className="flex items-center justify-between gap-4 rounded-lg px-1 py-1.5"
          >
            <div className="flex flex-col">
              <span className="text-sm text-slate-800">{row.description}</span>
              {row.contextNote ? (
                <span className="text-xs text-slate-400">{row.contextNote}</span>
              ) : null}
            </div>
            <span className="flex shrink-0 items-center gap-1">
              {row.keys.map((k) => (
                <kbd
                  key={k}
                  className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-400">
        Context shortcuts (c, b) require a board. Cmd/Ctrl+P overrides the browser
        Print dialog.
      </p>
    </Modal>
  );
}
