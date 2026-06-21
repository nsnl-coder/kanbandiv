import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { ChevronRight, KanbanSquare, Pencil, Plus } from "lucide-react";
import type { Project } from "shared";
import { useTRPC } from "../lib/trpc";
import { canEdit } from "../features/project/utils";
import { CreateBoardModal } from "../features/board/components/CreateBoardModal";
import { ProjectSettingsModal } from "../features/project/components/ProjectSettingsModal";

// One project row in the left rail. Clicking the row expands its boards inline
// (no navigation); project actions open modals so the board-list page is never
// needed for day-to-day use.
export function SidebarProject({ project }: { project: Project }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const boardsQuery = useQuery({
    ...trpc.boards.list.queryOptions({ projectId: project.id }),
    enabled: open,
  });
  const boards = boardsQuery.data ?? [];
  const editable = canEdit(project);

  return (
    <div>
      <div className="group flex items-center rounded-lg text-foreground/70 transition hover:bg-surface-muted">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-sm"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-200 ${
              open ? "rotate-90" : ""
            }`}
          />
          <span
            aria-hidden
            style={{ backgroundColor: project.color }}
            className="h-3 w-3 shrink-0 rounded-full"
          />
          <span className="truncate">{project.name}</span>
        </button>
        {editable ? (
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label={`Edit ${project.name}`}
            title="Edit project"
            className="mr-1 shrink-0 rounded-md p-1.5 text-muted opacity-0 transition hover:bg-surface-muted hover:text-foreground/80 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-0.5 flex flex-col gap-0.5 pl-5">
          {boardsQuery.isLoading ? (
            <p className="px-3 py-1.5 text-xs text-muted">Loading boards...</p>
          ) : boards.length === 0 ? (
            <p className="px-3 py-1.5 text-xs text-muted">No boards yet</p>
          ) : (
            boards.map((b) => (
              <NavLink
                key={b.id}
                to={`/projects/${project.id}/boards/${b.id}`}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                    isActive
                      ? "bg-indigo-50 font-medium text-indigo-700"
                      : "text-foreground/70 hover:bg-surface-muted"
                  }`
                }
              >
                <KanbanSquare
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: b.color }}
                />
                <span className="truncate">{b.name}</span>
              </NavLink>
            ))
          )}

          {editable ? (
            <div className="mt-1 px-3 pb-1 pt-0.5 text-xs text-muted">
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1 transition hover:text-indigo-600"
              >
                <Plus className="h-3.5 w-3.5" />
                New board
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {editable ? (
        <CreateBoardModal
          projectId={project.id}
          open={showCreate}
          onClose={() => setShowCreate(false)}
        />
      ) : null}

      {editable ? (
        <ProjectSettingsModal
          project={project}
          open={showSettings}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
    </div>
  );
}
