import { useQuery } from "@tanstack/react-query";
import type { CardTemplate } from "shared";
import { useTRPC } from "../../../lib/trpc";

interface Props {
  boardId: string;
  onPick: (templateId: string) => void;
  onClose: () => void;
}

// Small inline list of the board's templates for the add-card flow.
export function TemplatePicker({ boardId, onPick, onClose }: Props) {
  const trpc = useTRPC();
  const listQuery = useQuery(trpc.cardTemplates.list.queryOptions({ boardId }));
  const templates = listQuery.data ?? [];

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      {templates.length === 0 ? (
        <p className="px-2 py-1 text-sm text-slate-500">No templates yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {templates.map((t: CardTemplate) => (
            <li key={t.id}>
              <button
                type="button"
                aria-label={`use template ${t.name}`}
                onClick={() => onPick(t.id)}
                className="w-full truncate rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-1 self-end rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
      >
        Cancel
      </button>
    </div>
  );
}
