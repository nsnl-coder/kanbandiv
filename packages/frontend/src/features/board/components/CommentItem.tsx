import { useState } from "react";
import type { Comment } from "shared";
import { relativeTime, renderMentions, type MentionMember } from "../utils";
import { CommentComposer } from "./CommentComposer";

interface Props {
  comment: Comment;
  members: MentionMember[];
  currentUserId: string;
  isOwner: boolean;
  editable: boolean;
  canReply?: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
  onReply?: (body: string) => void;
}

export function CommentItem({
  comment,
  members,
  currentUserId,
  isOwner,
  editable,
  canReply,
  onEdit,
  onDelete,
  onReply,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);

  const isAuthor = comment.authorId === currentUserId;
  const canEditComment = editable && isAuthor;
  const canDeleteComment = editable && (isAuthor || isOwner);

  const segments = renderMentions(comment.body, members);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-foreground/80">{comment.author.name}</span>
        <span>{relativeTime(comment.createdAt)}</span>
      </div>

      {editing ? (
        <CommentComposer
          members={members}
          editable
          initialBody={comment.body}
          submitLabel="Save"
          onSubmit={(body) => {
            onEdit(body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground/80">
          {segments.map((s, i) =>
            s.isMention ? (
              <span key={i} className="font-medium text-indigo-600">
                {s.text}
              </span>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
      )}

      {!editing ? (
        <div className="flex gap-3 text-xs">
          {canReply && onReply ? (
            <button
              type="button"
              aria-label="reply"
              onClick={() => setReplying((r) => !r)}
              className="font-medium text-muted hover:text-foreground/80"
            >
              Reply
            </button>
          ) : null}
          {canEditComment ? (
            <button
              type="button"
              aria-label={`edit comment ${comment.id}`}
              onClick={() => setEditing(true)}
              className="font-medium text-muted hover:text-foreground/80"
            >
              Edit
            </button>
          ) : null}
          {canDeleteComment ? (
            <button
              type="button"
              aria-label={`delete comment ${comment.id}`}
              onClick={onDelete}
              className="font-medium text-red-500 hover:text-red-700"
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}

      {replying && onReply ? (
        <div className="mt-1">
          <CommentComposer
            members={members}
            editable
            placeholder="Write a reply..."
            submitLabel="Reply"
            onSubmit={(body) => {
              onReply(body);
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
