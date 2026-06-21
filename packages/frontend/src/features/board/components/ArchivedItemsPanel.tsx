import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArchivedCard, ArchivedColumn } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { boardErrorMessage } from "../errors";

interface Props {
  boardId: string;
  editable: boolean;
}

// Group archived cards under their column name so the user can restore the
// column first when a restore is blocked by PARENT_ARCHIVED.
function groupByColumn(cards: ArchivedCard[]): Map<string, ArchivedCard[]> {
  const map = new Map<string, ArchivedCard[]>();
  for (const card of cards) {
    const list = map.get(card.columnName) ?? [];
    list.push(card);
    map.set(card.columnName, list);
  }
  return map;
}

export function ArchivedItemsPanel({ boardId, editable }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<
    { kind: "column" | "card"; id: string; name: string } | null
  >(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const itemsKey = trpc.boards.archivedItems.queryKey({ id: boardId });
  const dataKey = trpc.boards.getData.queryKey({ id: boardId });
  const itemsQuery = useQuery(trpc.boards.archivedItems.queryOptions({ id: boardId }));

  const onSettled = () => {
    queryClient.invalidateQueries({ queryKey: itemsKey });
    queryClient.invalidateQueries({ queryKey: dataKey });
  };

  const restoreColumn = useMutation(trpc.columns.restore.mutationOptions({ onSettled }));
  const restoreCard = useMutation(trpc.cards.restore.mutationOptions({ onSettled }));
  const deleteColumn = useMutation(trpc.columns.delete.mutationOptions({ onSettled }));
  const deleteCard = useMutation(trpc.cards.delete.mutationOptions({ onSettled }));

  const restore = (
    mutate: (
      vars: { id: string },
      opts: { onError: (err: unknown) => void },
    ) => void,
    rowKey: string,
    id: string,
  ) => {
    setRowError((e) => ({ ...e, [rowKey]: "" }));
    mutate(
      { id },
      { onError: (err) => setRowError((e) => ({ ...e, [rowKey]: boardErrorMessage(err) })) },
    );
  };

  if (itemsQuery.isLoading) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  if (itemsQuery.error) {
    return <p className="text-sm text-red-600">{boardErrorMessage(itemsQuery.error)}</p>;
  }

  const columns: ArchivedColumn[] = itemsQuery.data?.columns ?? [];
  const cards: ArchivedCard[] = itemsQuery.data?.cards ?? [];

  if (columns.length === 0 && cards.length === 0) {
    return <p className="text-sm text-muted">No archived items.</p>;
  }

  const grouped = groupByColumn(cards);

  return (
    <div className="flex flex-col gap-5">
      {columns.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground/80">Archived columns</h3>
          <div className="flex flex-col gap-1">
            {columns.map((col) => {
              const rowKey = `col-${col.id}`;
              return (
                <div key={col.id} className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground/80">{col.name}</span>
                    {editable ? (
                      <div className="flex shrink-0 gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => restore(restoreColumn.mutate, rowKey, col.id)}
                          className="rounded-lg border border-border px-2 py-1 font-medium text-foreground/80 hover:bg-surface-muted"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete({ kind: "column", id: col.id, name: col.name })}
                          className="rounded-lg border border-red-300 px-2 py-1 font-medium text-red-600 hover:bg-red-50"
                        >
                          Delete permanently
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {rowError[rowKey] ? (
                    <p className="text-xs text-red-600">{rowError[rowKey]}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {cards.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground/80">Archived cards</h3>
          <div className="flex flex-col gap-3">
            {[...grouped.entries()].map(([columnName, group]) => (
              <div key={columnName} className="flex flex-col gap-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{columnName}</p>
                {group.map((card) => {
                  const rowKey = `card-${card.id}`;
                  return (
                    <div key={card.id} className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-foreground/80">{card.title}</span>
                        {editable ? (
                          <div className="flex shrink-0 gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => restore(restoreCard.mutate, rowKey, card.id)}
                              className="rounded-lg border border-border px-2 py-1 font-medium text-foreground/80 hover:bg-surface-muted"
                            >
                              Restore
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete({ kind: "card", id: card.id, name: card.title })}
                              className="rounded-lg border border-red-300 px-2 py-1 font-medium text-red-600 hover:bg-red-50"
                            >
                              Delete permanently
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {rowError[rowKey] ? (
                        <p className="text-xs text-red-600">{rowError[rowKey]}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {confirmDelete ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-foreground/80">
            Permanently delete <strong>{confirmDelete.name}</strong>? This cannot be undone.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteColumn.isPending || deleteCard.isPending}
              onClick={() => {
                const target = confirmDelete;
                const mutation = target.kind === "column" ? deleteColumn : deleteCard;
                mutation.mutate({ id: target.id }, { onSuccess: () => setConfirmDelete(null) });
              }}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Delete permanently
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
