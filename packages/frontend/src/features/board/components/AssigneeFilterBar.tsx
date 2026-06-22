import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { Assignee } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { assigneeDisplayName } from "../utils";

interface Props {
  boardId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  assignedToMe: boolean;
  onAssignedToMeChange: (value: boolean) => void;
  currentUserId: string;
}

export function AssigneeFilterBar({
  boardId,
  selected,
  onChange,
  assignedToMe,
  onAssignedToMeChange,
  currentUserId,
}: Props) {
  const trpc = useTRPC();
  const membersQuery = useQuery(trpc.assignees.boardMembers.queryOptions({ boardId }));
  const members = membersQuery.data ?? [];

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  const hasFilter = selected.length > 0 || assignedToMe;

  // Hide when there's nobody worth filtering by (just the owner or empty), but
  // keep it visible if a filter is still active so it can be cleared.
  if (members.length <= 1 && !hasFilter) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="filter by assignees">
      <span className="flex w-16 shrink-0 items-center gap-1 text-xs font-medium text-muted">
        Members
        {selected.length > 0 ? (
          <span className="rounded-full bg-indigo-100 px-1 text-[10px] font-semibold tabular-nums text-indigo-700">
            {selected.length}
          </span>
        ) : null}
      </span>
      {currentUserId ? (
        <button
          type="button"
          aria-label="filter assigned to me"
          aria-pressed={assignedToMe}
          onClick={() => onAssignedToMeChange(!assignedToMe)}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium transition ${
            assignedToMe
              ? "border-indigo-600 bg-indigo-600 text-white"
              : "border-border bg-surface text-foreground/70 hover:border-indigo-300 hover:text-foreground/90"
          }`}
        >
          Assigned to me
        </button>
      ) : null}
      {members.map((member: Assignee) => {
        const on = selected.includes(member.id);
        return (
          <button
            key={member.id}
            type="button"
            aria-label={`filter ${assigneeDisplayName(member.email)}`}
            aria-pressed={on}
            title={member.email}
            onClick={() => toggle(member.id)}
            className={`rounded-full border px-2 py-0.5 text-xs font-medium transition ${
              on
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-border bg-surface text-foreground/70 hover:border-indigo-300 hover:text-foreground/90"
            }`}
          >
            {assigneeDisplayName(member.email)}
          </button>
        );
      })}
      {hasFilter ? (
        <button
          type="button"
          aria-label="clear assignee filter"
          onClick={() => {
            onChange([]);
            onAssignedToMeChange(false);
          }}
          className="flex items-center gap-0.5 text-xs font-medium text-muted hover:text-foreground/80"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
