import { Columns3, Table, Calendar, Rows3 } from "lucide-react";
import type { BoardViewModeValue, SwimlaneGrouping } from "shared";
import { BoardViewMode } from "shared";
import { VIEW_MODES, SWIMLANE_GROUPINGS } from "../boardView";

interface Props {
  mode: BoardViewModeValue;
  onModeChange: (mode: BoardViewModeValue) => void;
  swimlaneBy: SwimlaneGrouping | null;
  onSwimlaneByChange: (by: SwimlaneGrouping) => void;
}

const ICONS: Record<BoardViewModeValue, typeof Columns3> = {
  kanban: Columns3,
  table: Table,
  calendar: Calendar,
  swimlanes: Rows3,
};

export function ViewSwitcher({ mode, onModeChange, swimlaneBy, onSwimlaneByChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5 rounded-xl border border-border/80 bg-surface/70 p-1 shadow-[0_1px_2px_rgb(15_23_42/0.04)] backdrop-blur-sm" role="group" aria-label="board view">
        {VIEW_MODES.map((m) => {
          const Icon = ICONS[m.value];
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              aria-pressed={active}
              onClick={() => onModeChange(m.value)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-all duration-200 ${
                active
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-foreground/70 hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {m.label}
            </button>
          );
        })}
      </div>
      {mode === BoardViewMode.SWIMLANES ? (
        <div className="flex items-center gap-0.5 rounded-xl border border-border/80 bg-surface/70 p-1 shadow-[0_1px_2px_rgb(15_23_42/0.04)] backdrop-blur-sm" role="group" aria-label="group swimlanes by">
          {SWIMLANE_GROUPINGS.map((g) => {
            const active = (swimlaneBy ?? "label") === g.value;
            return (
              <button
                key={g.value}
                type="button"
                aria-pressed={active}
                onClick={() => onSwimlaneByChange(g.value)}
                className={`rounded-lg px-3 py-1.5 font-medium transition-all duration-200 ${
                  active ? "bg-indigo-600 text-white shadow-sm" : "text-foreground/70 hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
