import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, KanbanSquare } from "lucide-react";
import type { Board } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { isOwner } from "../utils";
import { boardErrorMessage } from "../errors";

interface Props {
  projectId: string;
}

export function ArchivedBoardsSection({ projectId }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Board | null>(null);

  const archivedQuery = useQuery(trpc.boards.archived.queryOptions({ projectId }));
  const boards = archivedQuery.data ?? [];

  const onSettled = () => {
    queryClient.invalidateQueries({ queryKey: trpc.boards.list.queryKey({ projectId }) });
    queryClient.invalidateQueries({ queryKey: trpc.boards.archived.queryKey({ projectId }) });
  };

  const restoreMutation = useMutation(trpc.boards.restore.mutationOptions({ onSettled }));
  const deleteMutation = useMutation(trpc.boards.delete.mutationOptions({ onSettled }));

  if (boards.length === 0) return null;

  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Archived boards ({boards.length})
      </button>

      {open ? (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {boards.map((b) => (
            <div key={b.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <KanbanSquare aria-hidden className="h-4 w-4 shrink-0" style={{ color: b.color }} />
                <h3 className="truncate font-semibold text-slate-700">{b.name}</h3>
              </div>
              {isOwner(b) ? (
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => restoreMutation.mutate({ id: b.id })}
                    className="rounded-lg border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(b)}
                    className="rounded-lg border border-red-300 px-2 py-1 font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete permanently
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-slate-700">
            Permanently delete <strong>{confirmDelete.name}</strong>? This cannot be undone.
          </p>
          {deleteMutation.error ? (
            <p className="mt-2 text-sm text-red-600">{boardErrorMessage(deleteMutation.error)}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => {
                const target = confirmDelete;
                deleteMutation.mutate({ id: target.id }, { onSuccess: () => setConfirmDelete(null) });
              }}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Delete permanently
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
