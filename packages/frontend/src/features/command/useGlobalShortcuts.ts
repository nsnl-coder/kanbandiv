import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSearchStore } from "../../hooks/useSearchStore";
import { useCommandStore } from "./useCommandStore";
import { useShortcutHelpStore } from "./useShortcutHelpStore";
import { useBoardActionsStore } from "./useBoardActionsStore";

// True when the event target is a typing surface; bare-key / chord shortcuts
// must not fire while the user is typing in any of these.
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const name = target.nodeName;
  if (name === "INPUT" || name === "TEXTAREA" || name === "SELECT") return true;
  if (target.isContentEditable) return true;
  if (target.closest('[role="textbox"]')) return true;
  return false;
}

const CHORD_WINDOW_MS = 1000;

// One window keydown listener for the whole app. Registered once in AppLayout.
export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const openSearch = useSearchStore((s) => s.setOpen);
  const openCommand = useCommandStore((s) => s.setOpen);
  const openHelp = useShortcutHelpStore((s) => s.setOpen);
  const gArmed = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const disarm = () => {
      gArmed.current = false;
      if (gTimer.current) {
        clearTimeout(gTimer.current);
        gTimer.current = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Modifier combos bypass the typing guard (they are not text being typed).
      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === "p") {
          e.preventDefault(); // FIRST, synchronously: intercept browser Print.
          openCommand(true);
          return;
        }
        if (key === "k") {
          e.preventDefault();
          openSearch(true);
          return;
        }
        return;
      }

      // Resolve an armed `g` chord before the typing guard so timing is honored,
      // but only when not typing (the chord only arms outside inputs anyway).
      if (gArmed.current) {
        if (isTypingTarget(e.target)) {
          disarm();
          return;
        }
        if (e.key.toLowerCase() === "p") {
          disarm();
          e.preventDefault();
          navigate("/projects");
          return;
        }
        // Any other key disarms WITHOUT preventing default.
        disarm();
      }

      if (e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const { ctx, handlers } = useBoardActionsStore.getState();

      if (e.key === "?") {
        e.preventDefault();
        openHelp(true);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        openSearch(true);
        return;
      }
      if (e.key === "g") {
        gArmed.current = true;
        gTimer.current = setTimeout(disarm, CHORD_WINDOW_MS);
        return;
      }
      if (e.key === "c") {
        if (ctx?.canEdit && handlers) handlers.newCard();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (gTimer.current) clearTimeout(gTimer.current);
    };
  }, [navigate, openSearch, openCommand, openHelp]);
}
