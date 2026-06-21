import { CheckSquare } from "lucide-react";
import type { ChecklistProgress } from "shared";
import { progressPercent } from "../utils";

interface Props {
  progress: ChecklistProgress | undefined;
}

// Mini done/total bar. Renders nothing when the card has no checklist items.
export function ChecklistProgressBadge({ progress }: Props) {
  if (!progress || progress.total <= 0) return null;
  const pct = progressPercent(progress);
  const complete = progress.done === progress.total;
  return (
    <div
      className="mt-2 flex items-center gap-1.5 text-xs text-muted"
      aria-label={`Checklist ${progress.done}/${progress.total}`}
    >
      <CheckSquare className={`h-3.5 w-3.5 ${complete ? "text-emerald-600" : ""}`} />
      <span>
        {progress.done}/{progress.total}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={`h-full rounded-full ${complete ? "bg-emerald-500" : "bg-indigo-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
