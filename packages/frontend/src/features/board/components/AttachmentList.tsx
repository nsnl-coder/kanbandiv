import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { Attachment, BoardData } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { attachmentErrorMessage } from "../attachmentErrors";
import { formatBytes } from "../utils";
import { AttachmentUpload } from "./AttachmentUpload";

interface Props {
  boardId: string;
  cardId: string;
  canEdit: boolean;
  currentUserId: string;
  isOwner: boolean;
}

export function AttachmentList({ boardId, cardId, canEdit, currentUserId, isOwner }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const listKey = trpc.attachments.list.queryKey({ cardId });
  const listQuery = useQuery(trpc.attachments.list.queryOptions({ cardId }));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });

  const dataKey = trpc.boards.getData.queryKey({ id: boardId });
  const bumpCount = (delta: number) =>
    queryClient.setQueryData<BoardData>(dataKey, (prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((c) => ({
              ...c,
              cards: c.cards.map((cd) =>
                cd.id === cardId
                  ? { ...cd, attachmentCount: Math.max(0, cd.attachmentCount + delta) }
                  : cd,
              ),
            })),
          }
        : prev,
    );

  const deleteMutation = useMutation(trpc.attachments.delete.mutationOptions());

  const remove = (id: string) => {
    const snapshot = queryClient.getQueryData<Attachment[]>(listKey);
    const dataSnapshot = queryClient.getQueryData<BoardData>(dataKey);
    queryClient.setQueryData<Attachment[]>(listKey, (prev) =>
      prev ? prev.filter((a) => a.id !== id) : prev,
    );
    bumpCount(-1);
    deleteMutation.mutate(
      { id },
      {
        onSuccess: invalidate,
        onError: () => {
          if (snapshot) queryClient.setQueryData(listKey, snapshot);
          if (dataSnapshot) queryClient.setQueryData(dataKey, dataSnapshot);
        },
      },
    );
  };

  const rows = listQuery.data ?? [];

  return (
    <section className="mt-5">
      <h3 className="text-sm font-semibold text-slate-700">Attachments</h3>

      {listQuery.error ? (
        <p className="mt-2 text-xs text-red-600">{attachmentErrorMessage(listQuery.error)}</p>
      ) : null}
      {deleteMutation.error ? (
        <p className="mt-2 text-xs text-red-600">{attachmentErrorMessage(deleteMutation.error)}</p>
      ) : null}

      <ul className="mt-2 flex flex-col gap-2">
        {rows.map((row) => {
          const canDelete = currentUserId === row.uploaderId || isOwner;
          return (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <a
                  href={`/api/attachments/${row.id}/download`}
                  download
                  className="block truncate font-medium text-indigo-600 hover:underline"
                >
                  {row.filename}
                </a>
                <span className="text-xs text-slate-400">{formatBytes(row.sizeBytes)}</span>
              </div>
              {canDelete ? (
                <button
                  type="button"
                  aria-label={`delete ${row.filename}`}
                  onClick={() => remove(row.id)}
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!listQuery.isLoading && rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No attachments yet.</p>
      ) : null}
      {listQuery.isLoading ? <p className="mt-2 text-sm text-slate-400">Loading...</p> : null}

      {canEdit ? <AttachmentUpload boardId={boardId} cardId={cardId} /> : null}
    </section>
  );
}
