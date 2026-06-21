import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { Assignee, BoardData } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { assigneeErrorMessage } from "../assigneeErrors";
import { assigneeDisplayName } from "../utils";
import { AssigneeAvatar } from "./AssigneeAvatar";

interface Props {
  boardId: string;
  cardId: string;
  assignees: Assignee[];
  editable: boolean;
}

export function AssigneePicker({ boardId, cardId, assignees = [], editable }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const membersQuery = useQuery(trpc.assignees.boardMembers.queryOptions({ boardId }));
  const members = membersQuery.data ?? [];

  const dataKey = trpc.boards.getData.queryKey({ id: boardId });
  const patchCardAssignees = (next: Assignee[]) =>
    queryClient.setQueryData<BoardData>(dataKey, (prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((c) => ({
              ...c,
              cards: c.cards.map((card) =>
                card.id === cardId ? { ...card, assignees: next } : card,
              ),
            })),
          }
        : prev,
    );

  const assignMutation = useMutation(trpc.assignees.assign.mutationOptions());
  const unassignMutation = useMutation(trpc.assignees.unassign.mutationOptions());

  const selected = new Set(assignees.map((a) => a.id));

  const toggle = (member: Assignee) => {
    const snapshot = queryClient.getQueryData<BoardData>(dataKey);
    const isOn = selected.has(member.id);
    const optimistic = isOn
      ? assignees.filter((a) => a.id !== member.id)
      : [...assignees, member];
    patchCardAssignees(optimistic);

    const mutation = isOn ? unassignMutation : assignMutation;
    mutation.mutate(
      { cardId, userId: member.id },
      {
        onSuccess: (serverAssignees) => patchCardAssignees(serverAssignees),
        onError: () => {
          if (snapshot) queryClient.setQueryData(dataKey, snapshot);
        },
      },
    );
  };

  const error = assignMutation.error ?? unassignMutation.error;

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-slate-700">Assignees</h3>
      {error ? <p className="mt-1 text-xs text-red-600">{assigneeErrorMessage(error)}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {assignees.map((a) => (
          <AssigneeAvatar key={a.id} assignee={a} size="md" />
        ))}
        {assignees.length === 0 ? <span className="text-xs text-slate-400">None</span> : null}
      </div>
      {editable ? (
        <div className="mt-2 flex flex-col gap-1">
          {members.map((member: Assignee) => (
            <button
              key={member.id}
              type="button"
              aria-label={`toggle assignee ${assigneeDisplayName(member.email)}`}
              aria-pressed={selected.has(member.id)}
              onClick={() => toggle(member)}
              className="flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-slate-100"
            >
              <AssigneeAvatar assignee={member} size="sm" />
              <span className="flex-1 truncate text-slate-700" title={member.email}>
                {assigneeDisplayName(member.email)}
              </span>
              {selected.has(member.id) ? <Check className="h-4 w-4 text-indigo-600" /> : null}
            </button>
          ))}
          {members.length === 0 ? (
            <span className="text-xs text-slate-400">No board members to assign.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
