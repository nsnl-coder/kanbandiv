import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useAuthStore } from "../hooks/useAuthStore";

const KEY = "demoBanner:dismissed";

// Keyed by user id: every /api/auth/demo visit mints a fresh account, so a new
// demo session shows the banner again even if an earlier one dismissed it.
function readDismissed(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(KEY);
}

// Shown only for throwaway demo accounts (users.is_demo). Dismissible.
export function DemoBanner() {
  const user = useAuthStore((s) => s.user);
  const [dismissedFor, setDismissedFor] = useState(readDismissed);

  if (!user?.isDemo || dismissedFor === user.id) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, user.id);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
    setDismissedFor(user.id);
  };

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-3 bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white"
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span>Demo mode — temporary account, everything resets. Enjoy the board.</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss demo banner"
        className="rounded-md bg-white/20 p-0.5 transition hover:bg-white/30"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
