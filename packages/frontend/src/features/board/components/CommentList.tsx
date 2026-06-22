import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import type { BoardData, CommentThread } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { commentErrorMessage } from "../commentErrors";
import type { MentionMember } from "../utils";
import { CommentComposer } from "./CommentComposer";
import { CommentItem } from "./CommentItem";
import { SectionHeading } from "./SectionHeading";

interface Props {
  boardId: string;
  cardId: string;
  editable: boolean;
  members: MentionMember[];
  currentUserId: string;
  isOwner: boolean;
}

export function CommentList({
  boardId,
  cardId,
  editable,
  members,
  currentUserId,
  isOwner,
}: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const listKey = trpc.comments.list.queryKey({ cardId });
  const listQuery = useQuery(trpc.comments.list.queryOptions({ cardId }));
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
                  ? { ...cd, commentCount: Math.max(0, cd.commentCount + delta) }
                  : cd,
              ),
            })),
          }
        : prev,
    );

  const createMutation = useMutation(trpc.comments.create.mutationOptions());
  const updateMutation = useMutation(trpc.comments.update.mutationOptions());
  const deleteMutation = useMutation(trpc.comments.delete.mutationOptions());

  const threads = [...(listQuery.data ?? [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  const create = (body: string, parentId?: string) => {
    const snapshot = queryClient.getQueryData<BoardData>(dataKey);
    bumpCount(1);
    createMutation.mutate(
      { cardId, body, ...(parentId ? { parentId } : {}) },
      {
        onSuccess: invalidate,
        onError: () => {
          if (snapshot) queryClient.setQueryData(dataKey, snapshot);
        },
      },
    );
  };

  const remove = (id: string) => {
    const snapshot = queryClient.getQueryData<CommentThread[]>(listKey);
    const dataSnapshot = queryClient.getQueryData<BoardData>(dataKey);
    queryClient.setQueryData<CommentThread[]>(listKey, (prev) =>
      prev
        ? prev
            .filter((t) => t.id !== id)
            .map((t) => ({ ...t, replies: t.replies.filter((r) => r.id !== id) }))
        : prev,
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

  const edit = (id: string, body: string) => {
    const snapshot = queryClient.getQueryData<CommentThread[]>(listKey);
    queryClient.setQueryData<CommentThread[]>(listKey, (prev) =>
      prev
        ? prev.map((t) => ({
            ...t,
            body: t.id === id ? body : t.body,
            replies: t.replies.map((r) => (r.id === id ? { ...r, body } : r)),
          }))
        : prev,
    );
    updateMutation.mutate(
      { id, body },
      {
        onSuccess: invalidate,
        onError: () => {
          if (snapshot) queryClient.setQueryData(listKey, snapshot);
        },
      },
    );
  };

  const error = createMutation.error ?? updateMutation.error ?? deleteMutation.error;

  return (
    <section className="mt-5">
      <SectionHeading icon={MessageSquare}>Comments</SectionHeading>

      {editable ? (
        <div className="mt-2">
          <CommentComposer members={members} editable onSubmit={(b) => create(b)} />
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600">{commentErrorMessage(error)}</p> : null}
      {listQuery.error ? (
        <p className="mt-2 text-xs text-red-600">{commentErrorMessage(listQuery.error)}</p>
      ) : null}

      <div className="mt-3 flex flex-col gap-4">
        {threads.map((thread) => (
          <div key={thread.id} className="flex flex-col gap-2">
            <CommentItem
              comment={thread}
              members={members}
              currentUserId={currentUserId}
              isOwner={isOwner}
              editable={editable}
              canReply
              onEdit={(b) => edit(thread.id, b)}
              onDelete={() => remove(thread.id)}
              onReply={(b) => create(b, thread.id)}
            />
            {thread.replies.length > 0 ? (
              <div className="ml-5 flex flex-col gap-3 border-l border-border pl-3">
                {[...thread.replies]
                  .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                  .map((reply) => (
                    <CommentItem
                      key={reply.id}
                      comment={reply}
                      members={members}
                      currentUserId={currentUserId}
                      isOwner={isOwner}
                      editable={editable}
                      onEdit={(b) => edit(reply.id, b)}
                      onDelete={() => remove(reply.id)}
                    />
                  ))}
              </div>
            ) : null}
          </div>
        ))}
        {!listQuery.isLoading && threads.length === 0 ? (
          <p className="text-sm text-muted">No comments yet.</p>
        ) : null}
        {listQuery.isLoading ? <p className="text-sm text-muted">Loading...</p> : null}
      </div>
    </section>
  );
}
