import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, X } from "lucide-react";
import type { BoardData, Card } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { boardErrorMessage } from "../errors";
import { REMINDER_OPTIONS } from "../utils";
import { SectionHeading } from "./SectionHeading";

interface Props {
  boardId: string;
  card: Card;
  editable: boolean;
}

// Convert a Date to the `YYYY-MM-DDTHH:mm` value a datetime-local input wants,
// in local time.
function toInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function DueDatePicker({ boardId, card, editable }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const dataKey = trpc.boards.getData.queryKey({ id: boardId });
  const patchCard = (patch: Partial<Card>) =>
    queryClient.setQueryData<BoardData>(dataKey, (prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((c) => ({
              ...c,
              cards: c.cards.map((cd) => (cd.id === card.id ? { ...cd, ...patch } : cd)),
            })),
          }
        : prev,
    );

  const updateMutation = useMutation(trpc.cards.update.mutationOptions());

  const save = (patch: { dueAt?: Date | null; reminderMinutes?: number | null }) => {
    const snapshot = queryClient.getQueryData<BoardData>(dataKey);
    const optimistic: Partial<Card> = { ...patch };
    if (patch.dueAt !== undefined) {
      optimistic.isOverdue = patch.dueAt ? patch.dueAt.getTime() < Date.now() : false;
    }
    patchCard(optimistic);
    updateMutation.mutate(
      { id: card.id, ...patch },
      {
        onError: () => {
          if (snapshot) queryClient.setQueryData(dataKey, snapshot);
        },
      },
    );
  };

  const onDateChange = (value: string) => {
    if (!value) {
      save({ dueAt: null, reminderMinutes: null });
      return;
    }
    save({ dueAt: new Date(value) });
  };

  const onReminderChange = (value: string) => {
    save({ reminderMinutes: value === "" ? null : Number(value) });
  };

  return (
    <div className="mt-4">
      <SectionHeading icon={Clock}>Due date</SectionHeading>
      {updateMutation.error ? (
        <p className="mt-1 text-xs text-red-600">{boardErrorMessage(updateMutation.error)}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="datetime-local"
          aria-label="due date"
          disabled={!editable}
          value={card.dueAt ? toInputValue(card.dueAt) : ""}
          onChange={(e) => onDateChange(e.target.value)}
          className="rounded border border-border px-2 py-1 text-sm outline-none focus:border-indigo-500 disabled:bg-surface-muted"
        />
        <select
          aria-label="reminder"
          disabled={!editable || !card.dueAt}
          value={card.reminderMinutes ?? ""}
          onChange={(e) => onReminderChange(e.target.value)}
          className="rounded border border-border px-2 py-1 text-sm disabled:bg-surface-muted"
        >
          {REMINDER_OPTIONS.map((o) => (
            <option key={String(o.value)} value={o.value ?? ""}>
              {o.label}
            </option>
          ))}
        </select>
        {editable && card.dueAt ? (
          <button
            type="button"
            aria-label="clear due date"
            onClick={() => save({ dueAt: null, reminderMinutes: null })}
            className="flex items-center gap-0.5 rounded px-1.5 py-1 text-xs font-medium text-muted hover:bg-surface-muted"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
