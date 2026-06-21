import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Settings, Users, Plus } from "lucide-react";
import { useTRPC } from "../../../lib/trpc";
import { Modal } from "../../../components/Modal";
import { AccessPanel } from "../../../features/project/components/AccessPanel";
import { EditProjectModal } from "../../../features/project/components/EditProjectModal";
import { canEdit, isOwner } from "../../../features/project/utils";
import { BoardCard } from "../../../features/board/components/BoardCard";
import { CreateBoardModal } from "../../../features/board/components/CreateBoardModal";
import { ArchivedBoardsSection } from "../../../features/board/components/ArchivedBoardsSection";

export function ProjectDetailPage() {
  const trpc = useTRPC();
  const { id } = useParams<{ id: string }>();
  const [showAccess, setShowAccess] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showCreateBoard, setShowCreateBoard] = useState(false);

  const projectQuery = useQuery(trpc.projects.get.queryOptions({ id: id! }));
  const project = projectQuery.data;

  const boardsQuery = useQuery(trpc.boards.list.queryOptions({ projectId: id! }));
  const boards = boardsQuery.data ?? [];

  if (projectQuery.error) {
    return (
      <main className="w-full p-6">
        <p className="text-sm text-foreground/70">Project not found or no access.</p>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="w-full p-6">
        <p className="text-sm text-muted">Loading...</p>
      </main>
    );
  }

  return (
    <>
      <main className="relative p-6">
        <div className="fixed right-4 top-4 z-20 flex items-center gap-2 text-sm">
          {isOwner(project) ? (
            <button
              type="button"
              onClick={() => setShowAccess(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 font-medium text-foreground/80 shadow-sm hover:bg-surface-muted"
            >
              <Users className="h-4 w-4" />
              Manage access
            </button>
          ) : null}
          {canEdit(project) ? (
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              aria-label="Project settings"
              title="Project settings"
              className="flex items-center justify-center rounded-lg border border-border bg-surface p-2 text-foreground/80 shadow-sm hover:bg-surface-muted"
            >
              <Settings className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Boards</h2>
            <p className="text-sm text-muted">Organize work into kanban boards.</p>
          </div>

          {boardsQuery.isLoading ? (
            <p className="text-sm text-muted">Loading...</p>
          ) : !canEdit(project) && boards.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
              No boards yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {canEdit(project) ? (
                <button
                  type="button"
                  onClick={() => setShowCreateBoard(true)}
                  aria-label="New board"
                  title="New board"
                  className="flex min-h-[7.5rem] items-center justify-center rounded-lg border border-dashed border-border text-muted hover:border-indigo-400 hover:text-indigo-600"
                >
                  <Plus className="h-6 w-6" />
                </button>
              ) : null}
              {boards.map((b) => (
                <BoardCard key={b.id} board={b} />
              ))}
            </div>
          )}

          <ArchivedBoardsSection projectId={project.id} />
        </section>
      </main>

      {isOwner(project) ? (
        <Modal
          open={showAccess}
          onClose={() => setShowAccess(false)}
          title="Project access"
          widthClassName="max-w-lg"
        >
          <AccessPanel projectId={project.id} />
        </Modal>
      ) : null}

      {canEdit(project) ? (
        <EditProjectModal
          project={project}
          open={showEdit}
          onClose={() => setShowEdit(false)}
        />
      ) : null}

      {canEdit(project) ? (
        <CreateBoardModal
          projectId={project.id}
          open={showCreateBoard}
          onClose={() => setShowCreateBoard(false)}
        />
      ) : null}
    </>
  );
}
