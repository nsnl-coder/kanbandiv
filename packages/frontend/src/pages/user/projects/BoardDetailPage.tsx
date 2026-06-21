import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, Pencil, Archive, Plus, Users, Maximize2, Minimize2, Tag, History } from "lucide-react";
import {
  COLUMN_NAME_MAX,
  BoardViewMode,
  type BoardData,
  type BoardViewModeValue,
  type Card,
  type DueViewFilter,
  type SwimlaneGrouping,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import { useAuthStore } from "../../../hooks/useAuthStore";
import { Modal } from "../../../components/Modal";
import { Column } from "../../../features/board/components/Column";
import { CardEditor } from "../../../features/board/components/CardEditor";
import { BoardAccessPanel } from "../../../features/board/components/BoardAccessPanel";
import { LabelManager } from "../../../features/board/components/LabelManager";
import { BoardActivityPanel } from "../../../features/board/components/BoardActivityPanel";
import { ArchivedItemsPanel } from "../../../features/board/components/ArchivedItemsPanel";
import { LabelFilterBar } from "../../../features/board/components/LabelFilterBar";
import { AssigneeFilterBar } from "../../../features/board/components/AssigneeFilterBar";
import { DueFilterBar } from "../../../features/board/components/DueFilterBar";
import { ViewSwitcher } from "../../../features/board/components/ViewSwitcher";
import { BoardTableView } from "../../../features/board/components/BoardTableView";
import { BoardCalendarView } from "../../../features/board/components/BoardCalendarView";
import { BoardSwimlanesView } from "../../../features/board/components/BoardSwimlanesView";
import { toConfig, fromConfig } from "../../../features/board/boardView";
import {
  canEdit,
  isOwner,
  sortByPosition,
  filterCards,
  type CardFilter,
  type MentionMember,
} from "../../../features/board/utils";
import { boardErrorMessage } from "../../../features/board/errors";
import { useBoardRealtime } from "../../../features/board/hooks/useBoardRealtime";
import { useBoardActionsStore } from "../../../features/command/useBoardActionsStore";

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
  useBoardRealtime(boardId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [dueFilter, setDueFilter] = useState<DueViewFilter | null>(null);
  const [viewMode, setViewMode] = useState<BoardViewModeValue>(BoardViewMode.KANBAN);
  const [swimlaneBy, setSwimlaneBy] = useState<SwimlaneGrouping | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const currentUser = useAuthStore((s) => s.user);
  // Full-width by default; only "fit" is an explicit opt-out stored as "0".
  const [wide, setWide] = useState(() => localStorage.getItem("boardWide") !== "0");

  const toggleWide = () =>
    setWide((w) => {
      localStorage.setItem("boardWide", w ? "0" : "1");
      return !w;
    });

  const dataQuery = useQuery(trpc.boards.getData.queryOptions({ id: boardId! }));
  const board = dataQuery.data;

  // Deep-link: open the card named by ?card= once the board data is loaded and
  // that card exists. Additive to the in-board click flow (local activeCardId).
  const cardParam = searchParams.get("card");
  useEffect(() => {
    if (!cardParam || !board) return;
    const exists = board.columns.some((col) => col.cards.some((c) => c.id === cardParam));
    if (exists) setActiveCardId(cardParam);
  }, [cardParam, board]);

  const clearCardParam = () => {
    if (searchParams.has("card")) {
      const next = new URLSearchParams(searchParams);
      next.delete("card");
      setSearchParams(next, { replace: true });
    }
  };

  const accessQuery = useQuery(trpc.boards.accessList.queryOptions({ id: boardId! }));
  const members: MentionMember[] = (accessQuery.data ?? []).map((a) => ({
    name: a.email.split("@")[0],
  }));

  // Saved view: hydrate ONCE on first resolve (behind a ref so a later refetch
  // never clobbers user edits), then persist changes debounced.
  const hydrated = useRef(false);
  // Snapshot of the last persisted (or hydrated) view; a save is skipped when the
  // current state still matches it, so hydration never triggers a save loop.
  const lastSaved = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewQuery = useQuery(trpc.boardViews.get.queryOptions({ boardId: boardId! }));
  const saveView = useMutation(trpc.boardViews.set.mutationOptions());

  useEffect(() => {
    if (hydrated.current || !viewQuery.data) return;
    const s = fromConfig(viewQuery.data.config);
    setViewMode(viewQuery.data.mode);
    setLabelFilter(s.labelFilter);
    setAssigneeFilter(s.assigneeFilter);
    setAssignedToMe(s.assignedToMe);
    setDueFilter(s.dueFilter);
    setSwimlaneBy(s.swimlaneBy);
    hydrated.current = true;
    lastSaved.current = JSON.stringify({ mode: viewQuery.data.mode, config: viewQuery.data.config });
  }, [viewQuery.data]);

  useEffect(() => {
    if (!hydrated.current || !boardId) return;
    const config = toConfig({ labelFilter, assigneeFilter, assignedToMe, dueFilter, swimlaneBy });
    const snapshot = JSON.stringify({ mode: viewMode, config });
    if (snapshot === lastSaved.current) return; // unchanged (e.g. just hydrated)
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      lastSaved.current = snapshot;
      saveView.mutate({ boardId, mode: viewMode, config });
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, swimlaneBy, labelFilter, assigneeFilter, assignedToMe, dueFilter, boardId]);

  const dataKey = trpc.boards.getData.queryKey({ id: boardId! });
  const setData = (updater: (d: BoardData) => BoardData) =>
    queryClient.setQueryData<BoardData>(dataKey, (prev) => (prev ? updater(prev) : prev));
  const invalidateData = () => queryClient.invalidateQueries({ queryKey: dataKey });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Archive (not getData-invalidate): the board 404s once archived, so navigate
  // to the project immediately to avoid flashing the not-found state.
  const archiveBoardMutation = useMutation(
    trpc.boards.archive.mutationOptions({
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
  const archiveColumnMutation = useMutation(
    trpc.columns.archive.mutationOptions({ onSettled: invalidateData }),
  );
  const moveColumnMutation = useMutation(trpc.columns.move.mutationOptions());

  const createCardMutation = useMutation(
    trpc.cards.create.mutationOptions({ onSettled: invalidateData }),
  );
  const updateCardMutation = useMutation(trpc.cards.update.mutationOptions());
  const archiveCardMutation = useMutation(trpc.cards.archive.mutationOptions());
  const moveCardMutation = useMutation(trpc.cards.move.mutationOptions());

  // Bridge the board's LOCAL view + panel state to the global command palette /
  // shortcut layer. Registry gates actions via ctx (canEdit/isOwner), so the
  // handlers stay stable. clear(boardId) is a no-op if another board registered.
  const registerActions = useBoardActionsStore((s) => s.register);
  const clearActions = useBoardActionsStore((s) => s.clear);
  const editableForBridge = board ? canEdit(board) : false;
  useEffect(() => {
    if (!board || !id) return;
    registerActions(
      {
        projectId: id,
        boardId: board.id,
        boardName: board.name,
        canEdit: editableForBridge,
        isOwner: isOwner(board),
      },
      {
        setView: setViewMode,
        openArchived: () => setShowArchived(true),
        openHistory: () => setShowActivity(true),
        openLabels: () => setShowLabels(true),
        openAccess: () => setShowAccess(true),
        clearFilters: () => {
          setLabelFilter([]);
          setAssigneeFilter([]);
          setAssignedToMe(false);
          setDueFilter(null);
        },
        newCard: () => {
          const cols = sortByPosition(board.columns);
          if (cols.length === 0) return;
          createCardMutation.mutate(
            { columnId: cols[0].id, title: "New card" },
            { onSuccess: (created) => setActiveCardId(created.id) },
          );
        },
      },
    );
    const stamped = board.id;
    return () => clearActions(stamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, board, editableForBridge]);

  if (dataQuery.error) {
    return (
      <div className="min-h-screen bg-slate-50">
        <main className="max-w-3xl p-6">
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
        <main className="max-w-3xl p-6">
          <p className="text-sm text-slate-500">Loading...</p>
        </main>
      </div>
    );
  }

  const editable = canEdit(board);
  const columns = sortByPosition(board.columns);
  const cardFilter: CardFilter = {
    labelIds: labelFilter,
    assigneeIds: assigneeFilter,
    assignedToMe,
    due: dueFilter,
    currentUserId: currentUser?.id ?? "",
  };
  const filteredColumns = columns.map((c) => ({ ...c, cards: filterCards(c.cards, cardFilter) }));
  const activeCard =
    columns.flatMap((c) => c.cards).find((c) => c.id === activeCardId) ?? null;

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
      <main className={`flex flex-1 flex-col overflow-hidden ${wide ? "w-full" : "w-full max-w-6xl"} px-6 pt-6`}>
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
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ViewSwitcher
              mode={viewMode}
              onModeChange={setViewMode}
              swimlaneBy={swimlaneBy}
              onSwimlaneByChange={setSwimlaneBy}
            />
            <button
              type="button"
              onClick={toggleWide}
              aria-label={wide ? "Use fixed width" : "Use full width"}
              title={wide ? "Use fixed width" : "Use full width"}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
            >
              {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              {wide ? "Fit" : "Full width"}
            </button>
            {editable ? (
              <Link
                to={`/projects/${id}/boards/${board.id}/edit`}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setShowActivity(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
            >
              <History className="h-4 w-4" />
              History
            </button>
            {editable ? (
              <button
                type="button"
                onClick={() => setShowLabels(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                <Tag className="h-4 w-4" />
                Manage labels
              </button>
            ) : null}
            {editable ? (
              <button
                type="button"
                onClick={() => setShowArchived(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                <Archive className="h-4 w-4" />
                Archived items
              </button>
            ) : null}
            {isOwner(board) ? (
              <button
                type="button"
                onClick={() => setShowAccess(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                <Users className="h-4 w-4" />
                Manage access
              </button>
            ) : null}
            {isOwner(board) ? (
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                <Archive className="h-4 w-4" />
                Archive
              </button>
            ) : null}
          </div>
        </div>

        {board.description ? (
          <p className="mt-4 text-sm text-slate-600">{board.description}</p>
        ) : null}

        <div className="mt-4 flex flex-col gap-2">
          <LabelFilterBar boardId={board.id} selected={labelFilter} onChange={setLabelFilter} />
          <AssigneeFilterBar
            boardId={board.id}
            selected={assigneeFilter}
            onChange={setAssigneeFilter}
            assignedToMe={assignedToMe}
            onAssignedToMeChange={setAssignedToMe}
            currentUserId={currentUser?.id ?? ""}
          />
          <DueFilterBar value={dueFilter} onChange={setDueFilter} />
        </div>

        {viewMode === BoardViewMode.KANBAN ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="mt-6 flex flex-1 items-start gap-4 overflow-x-auto pb-4">
            <SortableContext
              items={columns.map((c) => c.id)}
              strategy={horizontalListSortingStrategy}
            >
              {filteredColumns.map((column) => (
                <Column
                  key={column.id}
                  column={column}
                  editable={editable}
                  onRename={(name) =>
                    updateColumnMutation.mutate({ id: column.id, name })
                  }
                  onArchive={() => archiveColumnMutation.mutate({ id: column.id })}
                  onAddCard={(title) =>
                    createCardMutation.mutate({ columnId: column.id, title })
                  }
                  onOpenCard={(card) => setActiveCardId(card.id)}
                />
              ))}
            </SortableContext>

            {editable ? (
              <button
                type="button"
                onClick={addColumn}
                className="flex w-72 shrink-0 items-center gap-1 self-start rounded-lg border border-dashed border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-500 hover:bg-slate-100"
              >
                <Plus className="h-4 w-4" />
                Add column
              </button>
            ) : null}
          </div>
        </DndContext>
        ) : null}

        {viewMode === BoardViewMode.TABLE ? (
          <BoardTableView
            columns={filteredColumns}
            onOpenCard={(card) => setActiveCardId(card.id)}
          />
        ) : null}

        {viewMode === BoardViewMode.CALENDAR ? (
          <BoardCalendarView
            boardId={board.id}
            filter={cardFilter}
            onOpenCard={(card) => setActiveCardId(card.id)}
          />
        ) : null}

        {viewMode === BoardViewMode.SWIMLANES ? (
          <BoardSwimlanesView
            boardId={board.id}
            columns={filteredColumns}
            swimlaneBy={swimlaneBy ?? "label"}
            onOpenCard={(card) => setActiveCardId(card.id)}
          />
        ) : null}

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

      {editable ? (
        <Modal
          open={showLabels}
          onClose={() => setShowLabels(false)}
          title="Board labels"
          widthClassName="max-w-md"
        >
          <LabelManager boardId={board.id} editable={editable} />
        </Modal>
      ) : null}

      <Modal
        open={showActivity}
        onClose={() => setShowActivity(false)}
        title="Board activity"
        widthClassName="max-w-lg"
      >
        <BoardActivityPanel boardId={board.id} />
      </Modal>

      {editable ? (
        <Modal
          open={showArchived}
          onClose={() => setShowArchived(false)}
          title="Archived items"
          widthClassName="max-w-lg"
        >
          <ArchivedItemsPanel boardId={board.id} editable={editable} />
        </Modal>
      ) : null}

      {activeCard ? (
        <CardEditor
          card={activeCard}
          boardId={board.id}
          editable={editable}
          isOwner={isOwner(board)}
          currentUserId={currentUser?.id ?? ""}
          members={members}
          error={updateCardMutation.error ?? archiveCardMutation.error}
          errorMessage={boardErrorMessage}
          onSave={(values) =>
            updateCardMutation.mutate(
              { id: activeCard.id, ...values },
              {
                onSuccess: () => {
                  invalidateData();
                  setActiveCardId(null);
                  clearCardParam();
                },
              },
            )
          }
          onArchive={() =>
            archiveCardMutation.mutate(
              { id: activeCard.id },
              {
                onSuccess: () => {
                  invalidateData();
                  setActiveCardId(null);
                  clearCardParam();
                },
              },
            )
          }
          onClose={() => {
            setActiveCardId(null);
            clearCardParam();
          }}
        />
      ) : null}

      {confirmArchive ? (
        <Modal
          open={confirmArchive}
          onClose={() => setConfirmArchive(false)}
          title="Archive board"
        >
          <div>
            <p className="text-sm text-slate-600">
              Archive <strong>{board.name}</strong>? It moves to the project's
              archived boards. You can restore it later.
            </p>
            {archiveBoardMutation.error ? (
              <p className="mt-2 text-sm text-red-600">
                {boardErrorMessage(archiveBoardMutation.error)}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmArchive(false)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiveBoardMutation.isPending}
                onClick={() => archiveBoardMutation.mutate({ id: board.id })}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
              >
                Archive
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
