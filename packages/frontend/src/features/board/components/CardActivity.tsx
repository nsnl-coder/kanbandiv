import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "../../../lib/trpc";
import { ActivityLine } from "./ActivityLine";

interface Props {
  cardId: string;
}

export function CardActivity({ cardId }: Props) {
  const trpc = useTRPC();
  const activityQuery = useQuery(trpc.activity.listForCard.queryOptions({ cardId }));
  const items = activityQuery.data ?? [];

  return (
    <section className="mt-5">
      <h3 className="text-sm font-semibold text-foreground/80">Activity</h3>
      <div className="mt-3 flex flex-col gap-2">
        {items.map((a) => (
          <ActivityLine key={a.id} activity={a} scope="card" />
        ))}
        {!activityQuery.isLoading && items.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : null}
        {activityQuery.isLoading ? <p className="text-sm text-muted">Loading...</p> : null}
      </div>
    </section>
  );
}
