import type { DueViewFilter } from "shared";
import { DUE_FILTER_OPTIONS } from "../boardView";

interface Props {
  value: DueViewFilter | null;
  onChange: (value: DueViewFilter | null) => void;
}

export function DueFilterBar({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="filter by due">
      <span className="text-xs font-medium text-muted">Due:</span>
      {DUE_FILTER_OPTIONS.map((opt) => {
        const on = value === opt.value;
        return (
          <button
            key={opt.label}
            type="button"
            aria-label={`due ${opt.label}`}
            aria-pressed={on}
            onClick={() => onChange(opt.value)}
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              on ? "border-indigo-600 bg-indigo-600 text-white" : "bg-surface text-foreground/70"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
