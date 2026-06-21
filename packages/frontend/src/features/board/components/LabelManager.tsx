import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus } from "lucide-react";
import { LABEL_COLORS, LABEL_NAME_MAX, type Label } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { labelErrorMessage } from "../labelErrors";

interface Props {
  boardId: string;
  editable: boolean;
}

export function LabelManager({ boardId, editable }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<(typeof LABEL_COLORS)[number]>(LABEL_COLORS[0]);

  const listKey = trpc.labels.list.queryKey({ boardId });
  const listQuery = useQuery(trpc.labels.list.queryOptions({ boardId }));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });

  const createMutation = useMutation(trpc.labels.create.mutationOptions({ onSettled: invalidate }));
  const updateMutation = useMutation(trpc.labels.update.mutationOptions({ onSettled: invalidate }));
  const deleteMutation = useMutation(trpc.labels.delete.mutationOptions({ onSettled: invalidate }));

  const labels = listQuery.data ?? [];

  const create = () => {
    createMutation.mutate({ boardId, name: name.trim(), color });
    setName("");
  };

  const error = createMutation.error ?? updateMutation.error ?? deleteMutation.error;

  return (
    <section>
      {error ? <p className="mb-2 text-sm text-red-600">{labelErrorMessage(error)}</p> : null}

      <ul className="flex flex-col gap-2">
        {labels.map((label: Label) => (
          <li key={label.id} className="flex items-center gap-2">
            <select
              aria-label={`color for ${label.name || "label"}`}
              value={label.color}
              disabled={!editable}
              onChange={(e) =>
                updateMutation.mutate({
                  id: label.id,
                  color: e.target.value as (typeof LABEL_COLORS)[number],
                })
              }
              style={{ backgroundColor: label.color, color: "#fff" }}
              className="h-7 w-12 rounded border border-border text-xs"
            >
              {LABEL_COLORS.map((c) => (
                <option key={c} value={c} style={{ backgroundColor: c }}>
                  {c}
                </option>
              ))}
            </select>
            <input
              aria-label={`name for ${label.name || "label"}`}
              defaultValue={label.name}
              disabled={!editable}
              maxLength={LABEL_NAME_MAX}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next !== label.name) updateMutation.mutate({ id: label.id, name: next });
              }}
              className="flex-1 rounded border border-border px-2 py-1 text-sm outline-none focus:border-indigo-500 disabled:bg-surface-muted"
            />
            {editable ? (
              <button
                type="button"
                aria-label={`delete label ${label.name || "label"}`}
                onClick={() => deleteMutation.mutate({ id: label.id })}
                className="text-muted hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </li>
        ))}
        {labels.length === 0 ? (
          <li className="text-sm text-muted">No labels yet.</li>
        ) : null}
      </ul>

      {editable ? (
        <div className="mt-4 flex items-center gap-2">
          <select
            aria-label="new label color"
            value={color}
            onChange={(e) => setColor(e.target.value as (typeof LABEL_COLORS)[number])}
            className="h-8 rounded border border-border px-1 text-sm"
            style={{ backgroundColor: color, color: "#fff" }}
          >
            {LABEL_COLORS.map((c) => (
              <option key={c} value={c} style={{ backgroundColor: c }}>
                {c}
              </option>
            ))}
          </select>
          <input
            aria-label="new label name"
            value={name}
            placeholder="Label name"
            maxLength={LABEL_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            className="flex-1 rounded border border-border px-2 py-1 text-sm outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            aria-label="add label"
            onClick={create}
            className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
