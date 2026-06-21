import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type NotificationPref } from "shared";
import { useTRPC } from "../../../lib/trpc";

const TYPE_LABELS: Record<NotificationPref["type"], { title: string; hint: string }> = {
  MENTION: { title: "Mentions", hint: "When someone @mentions you in a comment" },
  CARD_ASSIGNED: { title: "Card assignments", hint: "When you are assigned to a card" },
  CARD_DUE_SOON: { title: "Due-date reminders", hint: "When a card you can see is due soon" },
};

// Per-type in-app / email delivery switches. Writes are optimistic against the
// prefs list cache and reconciled by onSettled invalidation.
export function NotificationSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const prefsKey = trpc.notifications.prefsList.queryKey();
  const prefsQuery = useQuery(trpc.notifications.prefsList.queryOptions());

  const setPref = useMutation(
    trpc.notifications.prefsSet.mutationOptions({
      onMutate: (next) => {
        const snapshot = queryClient.getQueryData<NotificationPref[]>(prefsKey);
        queryClient.setQueryData<NotificationPref[]>(prefsKey, (prev) =>
          (prev ?? []).map((p) => (p.type === next.type ? next : p)),
        );
        return { snapshot };
      },
      onError: (_e, _v, ctx) => {
        if (ctx?.snapshot) queryClient.setQueryData(prefsKey, ctx.snapshot);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: prefsKey }),
    }),
  );

  const prefs = prefsQuery.data ?? [];

  const toggle = (pref: NotificationPref, channel: "inApp" | "email") =>
    setPref.mutate({ ...pref, [channel]: !pref[channel] });

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
      <p className="mt-1 text-xs text-muted">
        Choose how you want to be notified. Off everywhere means you will not be
        notified for that event.
      </p>

      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-border bg-surface-muted/50 px-4 py-2 text-xs font-medium text-muted">
          <span>Event</span>
          <span className="w-12 text-center">In-app</span>
          <span className="w-12 text-center">Email</span>
        </div>
        {prefsQuery.isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-muted">Loading...</p>
        ) : (
          prefs.map((pref) => {
            const meta = TYPE_LABELS[pref.type];
            return (
              <div
                key={pref.type}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-border px-4 py-3 last:border-b-0"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{meta.title}</p>
                  <p className="text-xs text-muted">{meta.hint}</p>
                </div>
                <div className="flex w-12 justify-center">
                  <input
                    type="checkbox"
                    aria-label={`${meta.title} in-app`}
                    checked={pref.inApp}
                    onChange={() => toggle(pref, "inApp")}
                    className="h-4 w-4 accent-indigo-600"
                  />
                </div>
                <div className="flex w-12 justify-center">
                  <input
                    type="checkbox"
                    aria-label={`${meta.title} email`}
                    checked={pref.email}
                    onChange={() => toggle(pref, "email")}
                    className="h-4 w-4 accent-indigo-600"
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
