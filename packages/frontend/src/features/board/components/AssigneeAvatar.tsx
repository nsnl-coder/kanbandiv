import type { Assignee } from "shared";
import { assigneeColor, assigneeDisplayName, assigneeInitials } from "../utils";

interface Props {
  assignee: Assignee;
  size?: "sm" | "md";
}

export function AssigneeAvatar({ assignee, size = "sm" }: Props) {
  const name = assigneeDisplayName(assignee.email);
  const dims = size === "md" ? "h-8 w-8 text-xs" : "h-6 w-6 text-[10px]";
  return (
    <span
      aria-label={name}
      title={assignee.email}
      style={{ backgroundColor: assigneeColor(assignee.id) }}
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-white ${dims}`}
    >
      {assigneeInitials(assignee.email)}
    </span>
  );
}
