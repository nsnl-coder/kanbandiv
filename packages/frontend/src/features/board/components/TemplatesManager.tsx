import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { CardTemplate, CardTemplatePayload } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { cardTemplateErrorMessage } from "../cardTemplateErrors";
import { TemplateForm } from "./TemplateForm";

interface Props {
  boardId: string;
  editable: boolean;
}

type Mode = { kind: "list" } | { kind: "new" } | { kind: "edit"; template: CardTemplate };

export function TemplatesManager({ boardId, editable }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  const listKey = trpc.cardTemplates.list.queryKey({ boardId });
  const listQuery = useQuery(trpc.cardTemplates.list.queryOptions({ boardId }));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });

  const createMutation = useMutation(
    trpc.cardTemplates.create.mutationOptions({ onSettled: invalidate }),
  );
  const updateMutation = useMutation(
    trpc.cardTemplates.update.mutationOptions({ onSettled: invalidate }),
  );
  const deleteMutation = useMutation(
    trpc.cardTemplates.delete.mutationOptions({ onSettled: invalidate }),
  );

  const templates = listQuery.data ?? [];
  const error = createMutation.error ?? updateMutation.error ?? deleteMutation.error;

  const onCreate = (values: { name: string; payload: CardTemplatePayload }) => {
    createMutation.mutate({ boardId, ...values });
    setMode({ kind: "list" });
  };
  const onUpdate = (id: string, values: { name: string; payload: CardTemplatePayload }) => {
    updateMutation.mutate({ id, ...values });
    setMode({ kind: "list" });
  };

  if (mode.kind === "new") {
    return (
      <TemplateForm
        boardId={boardId}
        submitLabel="Create template"
        onSubmit={onCreate}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }
  if (mode.kind === "edit") {
    return (
      <TemplateForm
        boardId={boardId}
        initialName={mode.template.name}
        initialPayload={mode.template.payload}
        submitLabel="Save changes"
        onSubmit={(values) => onUpdate(mode.template.id, values)}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }

  return (
    <section>
      {error ? (
        <p className="mb-2 text-sm text-red-600">{cardTemplateErrorMessage(error)}</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {templates.map((t: CardTemplate) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{t.name}</p>
              <p className="text-xs text-slate-500">
                {t.payload.labelIds.length} labels, {t.payload.checklists.length} checklists
              </p>
            </div>
            {editable ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`edit template ${t.name}`}
                  onClick={() => setMode({ kind: "edit", template: t })}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`delete template ${t.name}`}
                  onClick={() => deleteMutation.mutate({ id: t.id })}
                  className="rounded p-1 text-slate-300 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </li>
        ))}
        {templates.length === 0 ? (
          <li className="text-sm text-slate-500">No templates yet.</li>
        ) : null}
      </ul>

      {editable ? (
        <button
          type="button"
          aria-label="new template"
          onClick={() => setMode({ kind: "new" })}
          className="mt-4 flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          New template
        </button>
      ) : null}
    </section>
  );
}
