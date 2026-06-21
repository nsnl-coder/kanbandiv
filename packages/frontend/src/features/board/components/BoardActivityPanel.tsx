import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Activity } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { ActivityLine } from "./ActivityLine";

interface Props {
  boardId: string;
}

const PAGE_SIZE = 50;

// No useInfiniteQuery precedent in this codebase (audit L1): page with simple
// offset state and append each page as it arrives. "Load more" advances offset.
export function BoardActivityPanel({ boardId }: Props) {
  const trpc = useTRPC();
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<Activity[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  const pageQuery = useQuery(
    trpc.activity.listForBoard.queryOptions({ boardId, limit: PAGE_SIZE, offset }),
  );

  const page = pageQuery.data;
  useEffect(() => {
    if (!page) return;
    setItems((prev) =>
      offset === 0 ? page.items : [...prev, ...page.items.filter((a) => !prev.some((p) => p.id === a.id))],
    );
    setNextOffset(page.nextOffset);
  }, [page, offset]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {items.map((a) => (
          <ActivityLine key={a.id} activity={a} scope="board" />
        ))}
        {!pageQuery.isLoading && items.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : null}
        {pageQuery.isLoading && items.length === 0 ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : null}
      </div>

      {nextOffset !== null ? (
        <button
          type="button"
          onClick={() => setOffset(nextOffset)}
          className="self-start rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground/80 hover:bg-surface-muted"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
