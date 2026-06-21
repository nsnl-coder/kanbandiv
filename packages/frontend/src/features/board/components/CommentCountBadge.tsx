import { MessageSquare } from "lucide-react";

interface Props {
  count: number;
}

// Comment count on a card tile. Hidden when there are no comments.
export function CommentCountBadge({ count }: Props) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} comments`}
      className="mt-2 inline-flex items-center gap-1 text-xs text-muted"
    >
      <MessageSquare className="h-3.5 w-3.5" />
      {count}
    </span>
  );
}
