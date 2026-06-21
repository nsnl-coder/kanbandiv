import type { Assignee } from "shared";
import { AssigneeAvatar } from "./AssigneeAvatar";

interface Props {
  assignees: Assignee[];
  cap?: number;
}

export function AssigneeStack({ assignees, cap = 3 }: Props) {
  if (assignees.length === 0) return null;
  const shown = assignees.slice(0, cap);
  const extra = assignees.length - shown.length;
  return (
    <div className="flex items-center" aria-label="assignees">
      <div className="flex -space-x-1.5">
        {shown.map((a) => (
          <AssigneeAvatar key={a.id} assignee={a} size="sm" />
        ))}
      </div>
      {extra > 0 ? (
        <span className="ml-1 text-[10px] font-medium text-muted">+{extra}</span>
      ) : null}
    </div>
  );
}
