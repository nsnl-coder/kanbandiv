import { Paperclip } from "lucide-react";

interface Props {
  count: number;
}

// Attachment count on a card tile. Hidden when there are none.
export function AttachmentCountBadge({ count }: Props) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} attachments`}
      className="mt-2 inline-flex items-center gap-1 text-xs text-muted"
    >
      <Paperclip className="h-3.5 w-3.5" />
      {count}
    </span>
  );
}
