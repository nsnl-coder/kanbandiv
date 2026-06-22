import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command as CommandIcon } from "lucide-react";
import { useLogout } from "../../../hooks/useLogout";
import { useSearchStore } from "../../../hooks/useSearchStore";
import { useCanAny } from "../../rbac/hooks/useCan";
import { ADMIN_READ_PERMS } from "../../rbac/constants";
import { Modal } from "../../../components/Modal";
import { useCommandStore } from "../useCommandStore";
import { useShortcutHelpStore } from "../useShortcutHelpStore";
import { useBoardActionsStore } from "../useBoardActionsStore";
import { buildCommands, type Command, type CommandGroup } from "../commands";
import { filterCommands } from "../fuzzy";

const GROUP_ORDER: CommandGroup[] = ["Navigate", "Create", "Board", "Account"];

export function CommandPalette() {
  const open = useCommandStore((s) => s.open);
  const setOpen = useCommandStore((s) => s.setOpen);

  if (!open) return null;
  return <PaletteBody onClose={() => setOpen(false)} />;
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const setOpen = useCommandStore((s) => s.setOpen);
  const openSearch = useSearchStore((s) => s.setOpen);
  const openHelp = useShortcutHelpStore((s) => s.setOpen);
  const ctx = useBoardActionsStore((s) => s.ctx);
  const handlers = useBoardActionsStore((s) => s.handlers);
  const logout = useLogout();
  const canAdmin = useCanAny(ADMIN_READ_PERMS);

  const commands = useMemo(
    () =>
      buildCommands({
        navigate,
        ctx,
        handlers,
        logout: logout.run,
        openSearch,
        openHelp,
        setOpen,
        canAdmin,
      }),
    [navigate, ctx, handlers, logout.run, openSearch, openHelp, setOpen, canAdmin],
  );

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  const onQueryChange = (v: string) => {
    setQuery(v);
    setActiveIndex(0);
  };

  const grouped = useMemo(() => {
    const map = new Map<CommandGroup, Command[]>();
    for (const cmd of filtered) {
      const arr = map.get(cmd.group) ?? [];
      arr.push(cmd);
      map.set(cmd.group, arr);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
  }, [filtered]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[activeIndex]?.run();
    }
  };

  return (
    <Modal open onClose={onClose} title="Command palette" widthClassName="max-w-xl">
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
        <CommandIcon className="h-4 w-4 shrink-0 text-muted" />
        <input
          ref={inputRef}
          autoFocus
          type="text"
          aria-label="command input"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
        />
      </div>

      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted">No commands</p>
        ) : null}

        {grouped.map((group) => (
          <div key={group.group} className="mb-3">
            <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {group.group}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((cmd) => {
                const idx = filtered.indexOf(cmd);
                const active = idx === activeIndex;
                const Icon = cmd.icon;
                return (
                  <li key={cmd.id}>
                    <button
                      type="button"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => cmd.run()}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                        active ? "bg-indigo-50 text-indigo-900" : "text-foreground hover:bg-surface-muted"
                      }`}
                    >
                      {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted" /> : null}
                      <span className="flex-1">{cmd.label}</span>
                      {cmd.shortcut ? (
                        <kbd className="rounded border border-border bg-canvas px-1.5 py-0.5 text-xs text-muted">
                          {cmd.shortcut}
                        </kbd>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}
