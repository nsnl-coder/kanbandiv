import type { DueViewFilter } from "shared";
import { DUE_FILTER_OPTIONS } from "../boardView";

interface Props {
  value: DueViewFilter | null;
  onChange: (value: DueViewFilter | null) => void;
}

export function DueFilterBar({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2" aria-label="filter by due">
      <span className="w-16 shrink-0 text-xs font-medium text-muted">Due</span>
      <div className="inline-flex items-center gap-0.5 rounded-full bg-surface-muted p-0.5">
        {DUE_FILTER_OPTIONS.map((opt) => {
          const on = value === opt.value;
          return (
            <button
              key={opt.label}
              type="button"
              aria-label={`due ${opt.label}`}
              aria-pressed={on}
              onClick={() => onChange(opt.value)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                on
                  ? "bg-surface text-indigo-700 shadow-sm"
                  : "text-foreground/55 hover:text-foreground/80"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
