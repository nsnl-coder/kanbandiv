import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { Label } from "shared";
import { useTRPC } from "../../../lib/trpc";

interface Props {
  boardId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function LabelFilterBar({ boardId, selected, onChange }: Props) {
  const trpc = useTRPC();
  const listQuery = useQuery(trpc.labels.list.queryOptions({ boardId }));
  const labels = listQuery.data ?? [];

  if (labels.length === 0) return null;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="filter by labels">
      <span className="text-xs font-medium text-muted">Filter:</span>
      {labels.map((label: Label) => {
        const on = selected.includes(label.id);
        return (
          <button
            key={label.id}
            type="button"
            aria-label={`filter ${label.name || "label"}`}
            aria-pressed={on}
            onClick={() => toggle(label.id)}
            style={on ? { backgroundColor: label.color, color: "#fff" } : { borderColor: label.color }}
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              on ? "" : "bg-surface text-foreground/70"
            }`}
          >
            {label.name || "(no name)"}
          </button>
        );
      })}
      {selected.length > 0 ? (
        <button
          type="button"
          aria-label="clear label filter"
          onClick={() => onChange([])}
          className="flex items-center gap-0.5 text-xs font-medium text-muted hover:text-foreground/80"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
