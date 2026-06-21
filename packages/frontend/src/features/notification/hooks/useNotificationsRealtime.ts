import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "../../../lib/trpc";
import { refreshSession } from "../../../lib/trpc";
import { authStore } from "../../../hooks/useAuthStore";
import { config } from "../../../config/env.config";

// Coalesce a burst of nudges into one invalidation per key.
const DEBOUNCE_MS = 200;
// Consecutive onerror count before we assume the access cookie expired and
// proactively refresh (EventSource hides the HTTP status).
const REFRESH_AFTER_ERRORS = 2;

/**
 * Opens the per-user SSE stream and invalidates the notification caches when a
 * content-free nudge arrives. No-ops when logged out. Mounted once near the app
 * root (AppLayout) so a single connection is shared by every bell.
 */
export function useNotificationsRealtime(): void {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Long-lived handlers read current keys through refs (no re-open per render).
  const countKeyRef = useRef<readonly unknown[]>([]);
  countKeyRef.current = trpc.notifications.unreadCount.queryKey();
  const listKeyRef = useRef<readonly unknown[]>([]);
  listKeyRef.current = trpc.notifications.list.queryKey();

  const userId = authStore.getUser()?.id;

  useEffect(() => {
    if (!userId) return;

    const url = `${config.apiBaseUrl}/me/notifications/events`;

    const pending = new Map<string, readonly unknown[]>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveErrors = 0;
    let seenOpen = false;
    let closed = false;
    let es: EventSource;

    const flush = () => {
      debounceTimer = null;
      for (const key of pending.values()) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      pending.clear();
    };

    const queue = (key: readonly unknown[]) => {
      pending.set(JSON.stringify(key), key);
      if (debounceTimer === null) {
        debounceTimer = setTimeout(flush, DEBOUNCE_MS);
      }
    };

    const queueCount = () => queue(countKeyRef.current);
    // Invalidate the list root so any open dropdown refetches.
    const queueBoth = () => {
      queue(countKeyRef.current);
      queue(listKeyRef.current);
    };

    const open = () => {
      es = new EventSource(url, { withCredentials: true });

      es.onopen = () => {
        consecutiveErrors = 0;
        // Skip the very first open; on a reconnect, catch up on the count.
        if (seenOpen) queueCount();
        seenOpen = true;
      };

      es.onmessage = () => {
        // The nudge carries no data and the recipient is never the actor (no
        // self-notify), so there is NO self-echo skip here - always refetch.
        queueBoth();
      };

      es.onerror = () => {
        consecutiveErrors += 1;
        // Do NOT close on a single transient error - that kills native
        // auto-reconnect. Act only once the errors persist (likely an expired
        // access cookie the reconnect keeps replaying).
        if (consecutiveErrors < REFRESH_AFTER_ERRORS) return;
        consecutiveErrors = 0;
        void refreshSession().then((ok) => {
          if (closed) return;
          es.close();
          if (ok) {
            // A fresh EventSource sends the now-refreshed cookie.
            open();
          }
          // ok === false: refresh token also dead; route guards redirect.
        });
      };
    };

    open();

    return () => {
      closed = true;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
