import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BoardEvent } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { refreshSession } from "../../../lib/trpc";
import { authStore } from "../../../hooks/useAuthStore";
import { connectionStore } from "../../../hooks/useConnectionStore";
import { config } from "../../../config/env.config";

// Coalesce bursts (a board-wide drag emits several events fast) into one
// invalidation per key.
const DEBOUNCE_MS = 200;
// Consecutive onerror count before we assume the access cookie expired and
// proactively refresh (EventSource hides the HTTP status).
const REFRESH_AFTER_ERRORS = 2;

/**
 * Opens an SSE stream for `boardId` and invalidates the board's TanStack Query
 * caches when a remote change arrives. Self-echo (actorId === me) is skipped.
 * No-ops when `boardId` is falsy.
 */
export function useBoardRealtime(boardId: string | undefined): void {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Long-lived stream handlers read current values through refs to avoid stale
  // closures (the connection is not re-opened per render).
  const userIdRef = useRef<string | undefined>(authStore.getUser()?.id);
  const currentUser = authStore.getUser();
  userIdRef.current = currentUser?.id;

  const boardKeyRef = useRef<readonly unknown[]>([]);
  boardKeyRef.current = boardId
    ? trpc.boards.getData.queryKey({ id: boardId })
    : [];
  const activityKeyFor = useRef<(cardId: string) => readonly unknown[]>(
    () => [],
  );
  activityKeyFor.current = (cardId: string) =>
    trpc.activity.listForCard.queryKey({ cardId });

  useEffect(() => {
    if (!boardId) return;

    const url = `${config.apiBaseUrl}/boards/${boardId}/events`;

    // Pending invalidation set, keyed by a stable string so duplicate keys
    // within the debounce window collapse to one entry.
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

    const queueBoard = () => queue(boardKeyRef.current);

    const open = () => {
      es = new EventSource(url, { withCredentials: true });

      es.onopen = () => {
        consecutiveErrors = 0;
        connectionStore.setOnline(true);
        // Skip the very first open; on a reconnect, catch up on anything missed
        // while disconnected.
        if (seenOpen) queueBoard();
        seenOpen = true;
      };

      es.onmessage = (e: MessageEvent) => {
        let ev: BoardEvent;
        try {
          ev = JSON.parse(e.data) as BoardEvent;
        } catch {
          return;
        }
        // Self-echo: the originator already has fresh state from its optimistic
        // update (v1 skips by user id, so the user's own 2nd tab also skips).
        if (ev.actorId === userIdRef.current) return;
        queueBoard();
        if (ev.type === "CARD_ACTIVITY" && ev.cardId) {
          queue(activityKeyFor.current(ev.cardId));
        }
      };

      es.onerror = () => {
        consecutiveErrors += 1;
        // Do NOT close on a single transient error - that kills native
        // auto-reconnect. Only act once the errors persist (likely an expired
        // access cookie the reconnect keeps replaying).
        if (consecutiveErrors < REFRESH_AFTER_ERRORS) return;
        connectionStore.setOnline(false);
        consecutiveErrors = 0;
        void refreshSession().then((ok) => {
          if (closed) return;
          // Reuses the single in-flight refresh dedup in trpc.ts.
          es.close();
          if (ok) {
            // A fresh EventSource sends the now-refreshed cookie.
            open();
          }
          // ok === false: refresh token also dead; authStore is cleared and the
          // route guards redirect to /login. Stop retrying.
        });
      };
    };

    open();

    return () => {
      closed = true;
      // Leaving the board: drop this stream's offline state so a stale banner
      // does not linger (the per-user notifications stream keeps reporting).
      connectionStore.setOnline(true);
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);
}
