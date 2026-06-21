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
      <div className="flex items-center gap-1 rounded-lg border border-slate-300 p-0.5" role="group" aria-label="board view">
        {VIEW_MODES.map((m) => {
          const Icon = ICONS[m.value];
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              aria-pressed={active}
              onClick={() => onModeChange(m.value)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium ${
                active ? "bg-slate-800 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-4 w-4" />
              {m.label}
            </button>
          );
        })}
      </div>
      {mode === BoardViewMode.SWIMLANES ? (
        <div className="flex items-center gap-1 rounded-lg border border-slate-300 p-0.5" role="group" aria-label="group swimlanes by">
          {SWIMLANE_GROUPINGS.map((g) => {
            const active = (swimlaneBy ?? "label") === g.value;
            return (
              <button
                key={g.value}
                type="button"
                aria-pressed={active}
                onClick={() => onSwimlaneByChange(g.value)}
                className={`rounded-md px-2.5 py-1 font-medium ${
                  active ? "bg-slate-800 text-white" : "text-slate-700 hover:bg-slate-100"
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
