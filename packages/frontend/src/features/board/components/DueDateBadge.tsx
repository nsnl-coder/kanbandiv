import { Clock } from "lucide-react";
import type { Card } from "shared";
import { dueState, formatDueDate } from "../utils";

interface Props {
  card: Pick<Card, "dueAt" | "isOverdue">;
}

const STYLES: Record<string, string> = {
  overdue: "bg-red-100 text-red-700",
  soon: "bg-amber-100 text-amber-700",
  upcoming: "bg-surface-muted text-foreground/70",
};

// Pill on a card tile. Hidden when there is no due date.
export function DueDateBadge({ card }: Props) {
  const state = dueState(card);
  if (state === "none" || !card.dueAt) return null;
  return (
    <span
      aria-label={`Due ${formatDueDate(card.dueAt)}`}
      data-due-state={state}
      className={`mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${STYLES[state]}`}
    >
      <Clock className="h-3 w-3" />
      {formatDueDate(card.dueAt)}
    </span>
  );
}
