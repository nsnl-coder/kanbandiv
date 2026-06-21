import { Link } from "react-router-dom";
import { KanbanSquare } from "lucide-react";
import type { Board } from "shared";
import { PERMISSION_LABELS } from "../utils";

export function BoardCard({ board }: { board: Board }) {
  return (
    <Link
      to={`/projects/${board.projectId}/boards/${board.id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 hover:border-border hover:shadow-sm"
    >
      <div className="flex items-center gap-2">
        <KanbanSquare aria-hidden className="h-4 w-4 shrink-0" style={{ color: board.color }} />
        <h2 className="truncate font-semibold text-foreground">{board.name}</h2>
      </div>
      <p className="line-clamp-2 min-h-[2.5rem] text-sm text-foreground/70">
        {board.description || "No description"}
      </p>
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-lg bg-indigo-100 px-2 py-0.5 font-medium text-indigo-700">
          {PERMISSION_LABELS[board.myPermission]}
        </span>
      </div>
    </Link>
  );
}
