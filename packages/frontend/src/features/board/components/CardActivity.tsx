import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import { useTRPC } from "../../../lib/trpc";
import { ActivityLine } from "./ActivityLine";

interface Props {
  cardId: string;
}

export function CardActivity({ cardId }: Props) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const activityQuery = useQuery(
    trpc.activity.listForCard.queryOptions({ cardId }, { enabled: open }),
  );
  const items = activityQuery.data ?? [];

  return (
    <section className="mt-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-sm font-semibold text-foreground/80"
      >
        <Activity className="h-4 w-4 text-muted" aria-hidden />
        Activity
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
        )}
      </button>
      {open ? (
        <div className="mt-3 flex flex-col gap-2">
          {items.map((a) => (
            <ActivityLine key={a.id} activity={a} scope="card" />
          ))}
          {!activityQuery.isLoading && items.length === 0 ? (
            <p className="text-sm text-muted">No activity yet.</p>
          ) : null}
          {activityQuery.isLoading ? <p className="text-sm text-muted">Loading...</p> : null}
        </div>
      ) : null}
    </section>
  );
}
