import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Notification } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { relativeTime } from "../../board/utils";
import { describeNotification } from "../describe";

interface Props {
  notification: Notification;
  onNavigate: () => void;
}

export function NotificationItem({ notification, onNavigate }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const markRead = useMutation(
    trpc.notifications.markRead.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.notifications.unreadCount.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.notifications.list.queryKey(),
        });
      },
    }),
  );

  const { icon: Icon, text } = describeNotification(notification);
  const { boardId, cardId, snippet } = notification.payload;
  const unread = notification.readAt === null;

  const handleClick = () => {
    // Fire-and-forget: marking does not block navigation.
    markRead.mutate({ id: notification.id });
    const href = cardId
      ? `/boards/${boardId}?card=${cardId}`
      : `/boards/${boardId}`;
    navigate(href);
    onNavigate();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-canvas ${
        unread ? "bg-indigo-50/40" : ""
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className={`block ${unread ? "font-medium text-foreground" : "text-foreground/70"}`}>
          {text}
        </span>
        {snippet ? (
          <span className="mt-0.5 block truncate text-xs text-muted">{snippet}</span>
        ) : null}
        <span className="mt-0.5 block text-xs text-muted">
          {relativeTime(notification.createdAt)}
        </span>
      </span>
      {unread ? (
        <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
      ) : null}
    </button>
  );
}
