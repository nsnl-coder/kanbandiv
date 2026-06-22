import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useMatch, useNavigate } from "react-router-dom";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, KanbanSquare, Pencil, Plus } from "lucide-react";
import { DEFAULT_BOARD_COLOR, type Board, type Project } from "shared";
import { useTRPC } from "../lib/trpc";
import { canEdit } from "../features/project/utils";
import { EditBoardModal } from "../features/board/components/EditBoardModal";
import { ProjectSettingsModal } from "../features/project/components/ProjectSettingsModal";
import { dndId, useSidebarDnd } from "./sidebarDnd";

// One draggable board row in the sidebar. Reorders within its project and can
// be dragged onto another project to move it (server enforces owner-only).
function BoardRow({
  board,
  projectId,
  editable,
  onEdit,
}: {
  board: Board;
  projectId: string;
  editable: boolean;
  onEdit: (b: Board) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dndId("board", board.id), disabled: !editable });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group flex items-center rounded-lg transition hover:bg-surface-muted"
    >
      <NavLink
        to={`/projects/${projectId}/boards/${board.id}`}
        className={({ isActive }) =>
          `flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
            isActive
              ? "bg-indigo-50 font-medium text-indigo-700"
              : "text-foreground/70"
          }`
        }
      >
        <KanbanSquare
          aria-hidden
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: board.color }}
        />
        <span className="truncate">{board.name}</span>
      </NavLink>
      {editable ? (
        <button
          type="button"
          onClick={() => onEdit(board)}
          aria-label={`Edit ${board.name}`}
          title="Edit board"
          className="mr-1 shrink-0 rounded-md p-1.5 text-muted opacity-0 transition hover:bg-surface-muted hover:text-foreground/80 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

// One project row in the left rail. The row is a sortable/droppable item:
// dragging it reorders projects; dropping a board on it moves the board here.
// Clicking the row expands its boards inline (no navigation).
export function SidebarProject({ project }: { project: Project }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const dnd = useSidebarDnd();
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editBoard, setEditBoard] = useState<Board | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Force-expanded while a board is dragged over this project.
  const forcedOpen = dnd?.openProjectId === project.id;
  const isOpen = open || forcedOpen;

  const boardsQuery = useQuery({
    ...trpc.boards.list.queryOptions({ projectId: project.id }),
    enabled: isOpen,
  });
  // During a board drag, render the live arrangement instead of query data.
  const overlay = dnd?.dragBoards?.get(project.id);
  const boards = overlay ?? boardsQuery.data ?? [];
  const editable = canEdit(project);
  const boardMatch = useMatch("/projects/:projectId/boards/:boardId");
  const hasActiveBoard = boardMatch?.params.projectId === project.id;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dndId("project", project.id), disabled: !editable });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  // Expose loaded boards to the top-level drag handler.
  useEffect(() => {
    if (boardsQuery.data) dnd?.registerBoards(project.id, boardsQuery.data);
  }, [boardsQuery.data, dnd, project.id]);

  const createMutation = useMutation(
    trpc.boards.create.mutationOptions({
      onSuccess: (created: { id: string }) => {
        queryClient.invalidateQueries({
          queryKey: trpc.boards.list.queryKey({ projectId: project.id }),
        });
        setNewName("");
        setCreating(false);
        navigate(`/projects/${project.id}/boards/${created.id}`);
      },
    }),
  );

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const submitCreate = () => {
    const name = newName.trim();
    if (!name || createMutation.isPending) return;
    createMutation.mutate({ projectId: project.id, name, color: DEFAULT_BOARD_COLOR });
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        {...attributes}
        {...listeners}
        className={`group flex items-center rounded-lg transition ${
          hasActiveBoard
            ? "bg-indigo-50 text-indigo-700"
            : "text-foreground/70 hover:bg-surface-muted"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={isOpen}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-sm"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-200 ${
              isOpen ? "rotate-90" : ""
            }`}
          />
          <span
            aria-hidden
            style={{ backgroundColor: project.color }}
            className="h-3 w-3 shrink-0 rounded-full"
          />
          <span className={`truncate ${hasActiveBoard ? "font-semibold text-indigo-700" : ""}`}>
            {project.name}
          </span>
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

      {isOpen ? (
        <div className="mt-0.5 flex flex-col gap-0.5 pl-5">
          {boardsQuery.isLoading && !overlay ? (
            <p className="px-3 py-1.5 text-xs text-muted">Loading boards...</p>
          ) : (
            <SortableContext
              items={boards.map((b) => dndId("board", b.id))}
              strategy={verticalListSortingStrategy}
            >
              {boards.map((b) => (
                <BoardRow
                  key={b.id}
                  board={b}
                  projectId={project.id}
                  editable={editable}
                  onEdit={setEditBoard}
                />
              ))}
            </SortableContext>
          )}

          {editable ? (
            <div className="mt-1 px-3 pb-1 pt-0.5 text-xs text-muted">
              {creating ? (
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCreate();
                    if (e.key === "Escape") {
                      setNewName("");
                      setCreating(false);
                    }
                  }}
                  onBlur={submitCreate}
                  placeholder="Board name"
                  disabled={createMutation.isPending}
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-indigo-400 disabled:opacity-50"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex items-center gap-1 transition hover:text-indigo-600"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New board
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {editable && editBoard ? (
        <EditBoardModal
          projectId={project.id}
          board={editBoard}
          open={editBoard !== null}
          onClose={() => setEditBoard(null)}
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
