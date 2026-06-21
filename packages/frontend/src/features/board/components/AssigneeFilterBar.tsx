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

  if (members.length === 0) return null;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  const hasFilter = selected.length > 0 || assignedToMe;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="filter by assignees">
      <span className="text-xs font-medium text-slate-500">Members:</span>
      {currentUserId ? (
        <button
          type="button"
          aria-label="filter assigned to me"
          aria-pressed={assignedToMe}
          onClick={() => onAssignedToMeChange(!assignedToMe)}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
            assignedToMe ? "border-indigo-600 bg-indigo-600 text-white" : "bg-white text-slate-600"
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
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              on ? "border-indigo-600 bg-indigo-600 text-white" : "bg-white text-slate-600"
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
          className="flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
