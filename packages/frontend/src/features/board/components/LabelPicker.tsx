import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Tag } from "lucide-react";
import type { BoardData, Label } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { labelErrorMessage } from "../labelErrors";
import { LabelBadge } from "./LabelBadge";
import { SectionHeading } from "./SectionHeading";

interface Props {
  boardId: string;
  cardId: string;
  labels: Label[];
  editable: boolean;
}

export function LabelPicker({ boardId, cardId, labels, editable }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const listQuery = useQuery(trpc.labels.list.queryOptions({ boardId }));
  const boardLabels = listQuery.data ?? [];

  const dataKey = trpc.boards.getData.queryKey({ id: boardId });
  const patchCardLabels = (next: Label[]) =>
    queryClient.setQueryData<BoardData>(dataKey, (prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((c) => ({
              ...c,
              cards: c.cards.map((card) =>
                card.id === cardId ? { ...card, labels: next } : card,
              ),
            })),
          }
        : prev,
    );

  const attachMutation = useMutation(trpc.labels.attach.mutationOptions());
  const detachMutation = useMutation(trpc.labels.detach.mutationOptions());

  const selected = new Set(labels.map((l) => l.id));

  const toggle = (label: Label) => {
    const snapshot = queryClient.getQueryData<BoardData>(dataKey);
    const isOn = selected.has(label.id);
    const optimistic = isOn
      ? labels.filter((l) => l.id !== label.id)
      : [...labels, label];
    patchCardLabels(optimistic);

    const mutation = isOn ? detachMutation : attachMutation;
    mutation.mutate(
      { cardId, labelId: label.id },
      {
        onSuccess: (serverLabels) => patchCardLabels(serverLabels),
        onError: () => {
          if (snapshot) queryClient.setQueryData(dataKey, snapshot);
        },
      },
    );
  };

  const error = attachMutation.error ?? detachMutation.error;

  return (
    <div className="mt-4">
      <SectionHeading icon={Tag}>Labels</SectionHeading>
      {error ? <p className="mt-1 text-xs text-red-600">{labelErrorMessage(error)}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {labels.map((l) => (
          <LabelBadge key={l.id} label={l} />
        ))}
        {labels.length === 0 ? <span className="text-xs text-muted">None</span> : null}
      </div>
      {editable ? (
        <div className="mt-2 flex flex-col gap-1">
          {boardLabels.map((label) => (
            <button
              key={label.id}
              type="button"
              aria-label={`toggle label ${label.name || "label"}`}
              aria-pressed={selected.has(label.id)}
              onClick={() => toggle(label)}
              className="flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-surface-muted"
            >
              <span
                style={{ backgroundColor: label.color }}
                className="h-4 w-8 rounded"
                aria-hidden
              />
              <span className="flex-1 truncate text-foreground/80">{label.name || "(no name)"}</span>
              {selected.has(label.id) ? <Check className="h-4 w-4 text-indigo-600" /> : null}
            </button>
          ))}
          {boardLabels.length === 0 ? (
            <span className="text-xs text-muted">No board labels. Create some first.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
