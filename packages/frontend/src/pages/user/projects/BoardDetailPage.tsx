import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, Pencil, Trash2, Plus, Users, Maximize2, Minimize2 } from "lucide-react";
import {
  COLUMN_NAME_MAX,
  type BoardData,
  type Card,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import { Nav } from "../../../components/Nav";
import { Modal } from "../../../components/Modal";
import { Column } from "../../../features/board/components/Column";
import { CardEditor } from "../../../features/board/components/CardEditor";
import { BoardAccessPanel } from "../../../features/board/components/BoardAccessPanel";
import { canEdit, isOwner, sortByPosition } from "../../../features/board/utils";
import { boardErrorMessage } from "../../../features/board/errors";

// Reorder neighbours: midpoint between the surrounding positions. Mirrors the
// backend's double-precision strategy so the optimistic order matches the
// server result.
function midpoint(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return next! - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}

export function BoardDetailPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id, boardId } = useParams<{ id: string; boardId: string }>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  // Full-width by default; only "fit" is an explicit opt-out stored as "0".
  const [wide, setWide] = useState(() => localStorage.getItem("boardWide") !== "0");

  const toggleWide = () =>
    setWide((w) => {
      localStorage.setItem("boardWide", w ? "0" : "1");
      return !w;
    });

  const dataQuery = useQuery(trpc.boards.getData.queryOptions({ id: boardId! }));
  const board = dataQuery.data;

  const dataKey = trpc.boards.getData.queryKey({ id: boardId! });
  const setData = (updater: (d: BoardData) => BoardData) =>
    queryClient.setQueryData<BoardData>(dataKey, (prev) => (prev ? updater(prev) : prev));
  const invalidateData = () => queryClient.invalidateQueries({ queryKey: dataKey });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const deleteBoardMutation = useMutation(
    trpc.boards.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.boards.list.queryKey({ projectId: id }) });
        navigate(`/projects/${id}`);
      },
    }),
  );

  const createColumnMutation = useMutation(
    trpc.columns.create.mutationOptions({ onSettled: invalidateData }),
  );
  const updateColumnMutation = useMutation(
    trpc.columns.update.mutationOptions({ onSettled: invalidateData }),
  );
  const deleteColumnMutation = useMutation(
    trpc.columns.delete.mutationOptions({ onSettled: invalidateData }),
  );
  const moveColumnMutation = useMutation(trpc.columns.move.mutationOptions());

  const createCardMutation = useMutation(
    trpc.cards.create.mutationOptions({ onSettled: invalidateData }),
  );
  const updateCardMutation = useMutation(trpc.cards.update.mutationOptions());
  const deleteCardMutation = useMutation(trpc.cards.delete.mutationOptions());
  const moveCardMutation = useMutation(trpc.cards.move.mutationOptions());

  if (dataQuery.error) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Nav />
        <main className="mx-auto max-w-3xl p-6">
          <p className="text-sm text-slate-600">Board not found or no access.</p>
          <Link
            to={`/projects/${id}`}
            className="text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            Back to project
          </Link>
        </main>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Nav />
        <main className="mx-auto max-w-3xl p-6">
          <p className="text-sm text-slate-500">Loading...</p>
        </main>
      </div>
    );
  }

  const editable = canEdit(board);
  const columns = sortByPosition(board.columns);

  const addColumn = () => {
    const name = window.prompt("Column name")?.trim();
    if (name && name.length <= COLUMN_NAME_MAX) {
      createColumnMutation.mutate({ boardId: board.id, name });
    }
  };

  const onColumnDrop = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ordered = columns;
    const fromIdx = ordered.findIndex((c) => c.id === active.id);
    const toIdx = ordered.findIndex((c) => c.id === over.id);
    if (fromIdx < 0 || toIdx < 0) return;

    const reordered = [...ordered];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const pos = reordered.findIndex((c) => c.id === moved.id);
    const prev = reordered[pos - 1]?.position;
    const next = reordered[pos + 1]?.position;
    const newPos = midpoint(prev, next);

    const snapshot = queryClient.getQueryData<BoardData>(dataKey);
    setData((d) => ({
      ...d,
      columns: d.columns.map((c) => (c.id === moved.id ? { ...c, position: newPos } : c)),
    }));

    const neighbour =
      reordered[pos + 1]?.id !== undefined
        ? { beforeId: reordered[pos + 1].id }
        : reordered[pos - 1]?.id !== undefined
          ? { afterId: reordered[pos - 1].id }
          : {};
    moveColumnMutation.mutate(
      { id: String(active.id), ...neighbour },
      {
        onError: () => {
          if (snapshot) queryClient.setQueryData(dataKey, snapshot);
        },
        onSettled: invalidateData,
      },
    );
  };

  const onCardDrop = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const cardId = String(active.id);
    const fromColumn = columns.find((c) => c.cards.some((card) => card.id === cardId));
    if (!fromColumn) return;

    // `over` may be a card or a column container.
    const overCardColumn = columns.find((c) => c.cards.some((card) => card.id === over.id));
    const toColumn = overCardColumn ?? columns.find((c) => c.id === over.id);
    if (!toColumn) return;

    const targetCards = sortByPosition(toColumn.cards).filter((c) => c.id !== cardId);
    let insertIdx = targetCards.length;
    if (overCardColumn) {
      insertIdx = targetCards.findIndex((c) => c.id === over.id);
      if (insertIdx < 0) insertIdx = targetCards.length;
    }

    const prev = targetCards[insertIdx - 1]?.position;
    const next = targetCards[insertIdx]?.position;
    const newPos = midpoint(prev, next);

    const snapshot = queryClient.getQueryData<BoardData>(dataKey);
    setData((d) => {
      const moving = d.columns
        .flatMap((c) => c.cards)
        .find((c) => c.id === cardId);
      if (!moving) return d;
      const updated = { ...moving, columnId: toColumn.id, position: newPos };
      return {
        ...d,
        columns: d.columns.map((c) => {
          if (c.id === fromColumn.id && c.id === toColumn.id) {
            return {
              ...c,
              cards: c.cards.map((card) => (card.id === cardId ? updated : card)),
            };
          }
          if (c.id === fromColumn.id) {
            return { ...c, cards: c.cards.filter((card) => card.id !== cardId) };
          }
          if (c.id === toColumn.id) {
            return { ...c, cards: [...c.cards, updated] };
          }
          return c;
        }),
      };
    });

    const neighbour =
      targetCards[insertIdx]?.id !== undefined
        ? { beforeId: targetCards[insertIdx].id }
        : targetCards[insertIdx - 1]?.id !== undefined
          ? { afterId: targetCards[insertIdx - 1].id }
          : {};
    moveCardMutation.mutate(
      { id: cardId, toColumnId: toColumn.id, ...neighbour },
      {
        onError: () => {
          if (snapshot) queryClient.setQueryData(dataKey, snapshot);
        },
        onSettled: invalidateData,
      },
    );
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (event.active.data.current?.type === "column") {
      onColumnDrop(event);
    } else {
      onCardDrop(event);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />
      <main className={`flex flex-1 flex-col overflow-hidden ${wide ? "w-full" : "mx-auto w-full max-w-6xl"} px-6 pt-6`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              to={`/projects/${id}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to project
            </Link>
            <div className="mt-1 flex items-center gap-3">
              <span
                aria-hidden
                style={{ backgroundColor: board.color }}
                className="h-6 w-6 rounded-full"
              />
              <h1 className="text-2xl font-bold text-slate-800">{board.name}</h1>
            </div>
          </div>
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={toggleWide}
              aria-label={wide ? "Use fixed width" : "Use full width"}
              title={wide ? "Use fixed width" : "Use full width"}
              className="flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
            >
              {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              {wide ? "Fit" : "Full width"}
            </button>
            {editable ? (
              <Link
                to={`/projects/${id}/boards/${board.id}/edit`}
                className="flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            ) : null}
            {isOwner(board) ? (
              <button
                type="button"
                onClick={() => setShowAccess(true)}
                className="flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                <Users className="h-4 w-4" />
                Manage access
              </button>
            ) : null}
            {isOwner(board) ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded border border-red-300 px-3 py-1.5 font-medium text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            ) : null}
          </div>
        </div>

        {board.description ? (
          <p className="mt-4 text-sm text-slate-600">{board.description}</p>
        ) : null}

        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="mt-6 flex flex-1 items-start gap-4 overflow-x-auto pb-4">
            <SortableContext
              items={columns.map((c) => c.id)}
              strategy={horizontalListSortingStrategy}
            >
              {columns.map((column) => (
                <Column
                  key={column.id}
                  column={column}
                  editable={editable}
                  onRename={(name) =>
                    updateColumnMutation.mutate({ id: column.id, name })
                  }
                  onDelete={() => deleteColumnMutation.mutate({ id: column.id })}
                  onAddCard={(title) =>
                    createCardMutation.mutate({ columnId: column.id, title })
                  }
                  onOpenCard={setActiveCard}
                />
              ))}
            </SortableContext>

            {editable ? (
              <button
                type="button"
                onClick={addColumn}
                className="flex w-72 shrink-0 items-center gap-1 self-start rounded border border-dashed border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-500 hover:bg-slate-100"
              >
                <Plus className="h-4 w-4" />
                Add column
              </button>
            ) : null}
          </div>
        </DndContext>

      </main>

      {isOwner(board) ? (
        <Modal
          open={showAccess}
          onClose={() => setShowAccess(false)}
          title="Board access"
          widthClassName="max-w-lg"
        >
          <BoardAccessPanel boardId={board.id} />
        </Modal>
      ) : null}

      {activeCard ? (
        <CardEditor
          card={activeCard}
          editable={editable}
          error={updateCardMutation.error ?? deleteCardMutation.error}
          errorMessage={boardErrorMessage}
          onSave={(values) =>
            updateCardMutation.mutate(
              { id: activeCard.id, ...values },
              {
                onSuccess: () => {
                  invalidateData();
                  setActiveCard(null);
                },
              },
            )
          }
          onDelete={() =>
            deleteCardMutation.mutate(
              { id: activeCard.id },
              {
                onSuccess: () => {
                  invalidateData();
                  setActiveCard(null);
                },
              },
            )
          }
          onClose={() => setActiveCard(null)}
        />
      ) : null}

      {confirmDelete ? (
        <Modal
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Delete board"
        >
          <div>
            <p className="text-sm text-slate-600">
              Delete <strong>{board.name}</strong>? This cannot be undone.
            </p>
            {deleteBoardMutation.error ? (
              <p className="mt-2 text-sm text-red-600">
                {boardErrorMessage(deleteBoardMutation.error)}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteBoardMutation.isPending}
                onClick={() => deleteBoardMutation.mutate({ id: board.id })}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
