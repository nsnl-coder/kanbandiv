import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useTRPC } from "../../../lib/trpc";
import { NotificationItem } from "./NotificationItem";

export function NotificationBell() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Fallback path: works with SSE off via focus refetch + a 60s interval.
  const unreadQuery = useQuery(
    trpc.notifications.unreadCount.queryOptions(undefined, {
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    }),
  );
  const count = unreadQuery.data?.count ?? 0;

  const listQuery = useQuery(
    trpc.notifications.list.queryOptions(
      { limit: 20, offset: 0 },
      { enabled: open },
    ),
  );

  const invalidateBoth = () => {
    queryClient.invalidateQueries({
      queryKey: trpc.notifications.unreadCount.queryKey(),
    });
    queryClient.invalidateQueries({
      queryKey: trpc.notifications.list.queryKey(),
    });
  };

  const markAll = useMutation(
    trpc.notifications.markAllRead.mutationOptions({ onSuccess: invalidateBoth }),
  );

  const items = listQuery.data?.items ?? [];
  const badge = count > 99 ? "99+" : String(count);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications, ${count} unread`}
        aria-expanded={open}
        className="relative text-foreground/70 hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {count > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold leading-none text-white">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Notifications"
            className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold text-foreground">
                Notifications
              </span>
              <button
                type="button"
                onClick={() => markAll.mutate()}
                disabled={count === 0 || markAll.isPending}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:text-muted"
              >
                Mark all read
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {listQuery.isLoading ? (
                <p className="px-3 py-6 text-center text-sm text-muted">
                  Loading...
                </p>
              ) : items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted">
                  You&apos;re all caught up.
                </p>
              ) : (
                items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onNavigate={() => setOpen(false)}
                  />
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
