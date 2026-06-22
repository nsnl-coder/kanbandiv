import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import {
  COLUMN_NAME_MAX,
  BoardViewMode,
  type BoardData,
  type BoardViewModeValue,
  type Card,
  type Column as ColumnData,
  type DueViewFilter,
  type SwimlaneGrouping,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import { useAuthStore } from "../../../hooks/useAuthStore";
import { Modal } from "../../../components/Modal";
import { Column } from "../../../features/board/components/Column";
import { BoardMenu } from "../../../features/board/components/BoardMenu";
import { EditBoardModal } from "../../../features/board/components/EditBoardModal";
import { CardEditor } from "../../../features/board/components/CardEditor";
import { BoardAccessPanel } from "../../../features/board/components/BoardAccessPanel";
import { LabelManager } from "../../../features/board/components/LabelManager";
import { TemplatesManager } from "../../../features/board/components/TemplatesManager";
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

// Optimistic placeholders: rendered instantly on create, reconciled (replaced by
// the server row) in onSuccess and finally re-fetched in onSettled. The `tmp_`
// id prefix marks them so nothing mistakes a placeholder for a persisted row.
function tempCard(id: string, columnId: string, title: string, siblings: Card[]): Card {
  const now = new Date();
  const maxPos = siblings.reduce((m, c) => Math.max(m, c.position), 0);
  return {
    id,
    columnId,
    title,
    description: null,
    position: maxPos + 1,
    dueAt: null,
    reminderMinutes: null,
    isOverdue: false,
    cover: null,
    labels: [],
    assignees: [],
    checklistProgress: { done: 0, total: 0 },
    commentCount: 0,
    attachmentCount: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function tempColumn(id: string, boardId: string, name: string, siblings: ColumnData[]): ColumnData {
  const now = new Date();
  const maxPos = siblings.reduce((m, c) => Math.max(m, c.position), 0);
  return {
    id,
    boardId,
    name,
    position: maxPos + 1,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    cards: [],
  };
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
  const [showTemplates, setShowTemplates] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
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
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumn, setNewColumn] = useState("");

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
  // home immediately to avoid flashing the not-found state.
  const archiveBoardMutation = useMutation(
    trpc.boards.archive.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.boards.list.queryKey({ projectId: id }) });
        navigate("/projects");
      },
    }),
  );

  const createColumnMutation = useMutation(
    trpc.columns.create.mutationOptions({
      onMutate: (input) => {
        const snapshot = queryClient.getQueryData<BoardData>(dataKey);
        const tempId = `tmp_${crypto.randomUUID()}`;
        setData((d) => ({
          ...d,
          columns: [...d.columns, tempColumn(tempId, input.boardId, input.name, d.columns)],
        }));
        return { snapshot, tempId };
      },
      onSuccess: (created, _input, ctx) =>
        setData((d) => ({
          ...d,
          columns: d.columns.map((c) => (c.id === ctx?.tempId ? created : c)),
        })),
      onError: (_e, _v, ctx) => {
        if (ctx?.snapshot) queryClient.setQueryData(dataKey, ctx.snapshot);
      },
      onSettled: invalidateData,
    }),
  );
  const updateColumnMutation = useMutation(
    trpc.columns.update.mutationOptions({ onSettled: invalidateData }),
  );
  const archiveColumnMutation = useMutation(
    trpc.columns.archive.mutationOptions({ onSettled: invalidateData }),
  );
  const moveColumnMutation = useMutation(trpc.columns.move.mutationOptions());

  const createCardMutation = useMutation(
    trpc.cards.create.mutationOptions({
      onMutate: (input) => {
        const snapshot = queryClient.getQueryData<BoardData>(dataKey);
        const tempId = `tmp_${crypto.randomUUID()}`;
        setData((d) => ({
          ...d,
          columns: d.columns.map((c) =>
            c.id === input.columnId
              ? { ...c, cards: [...c.cards, tempCard(tempId, input.columnId, input.title, c.cards)] }
              : c,
          ),
        }));
        return { snapshot, tempId };
      },
      onSuccess: (created, _input, ctx) =>
        setData((d) => ({
          ...d,
          columns: d.columns.map((c) => ({
            ...c,
            cards: c.cards.map((card) => (card.id === ctx?.tempId ? created : card)),
          })),
        })),
      onError: (_e, _v, ctx) => {
        if (ctx?.snapshot) queryClient.setQueryData(dataKey, ctx.snapshot);
      },
      onSettled: invalidateData,
    }),
  );
  const instantiateMutation = useMutation(
    trpc.cardTemplates.instantiate.mutationOptions({ onSettled: invalidateData }),
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
        openTemplates: () => setShowTemplates(true),
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
      <div className="board-surface min-h-screen">
        <main className="max-w-3xl p-6">
          <p className="text-sm text-foreground/70">Board not found or no access.</p>
        </main>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="board-surface min-h-screen">
        <main className="max-w-3xl space-y-3 p-6">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-muted/70" />
          <div className="flex gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-64 w-72 animate-pulse rounded-2xl bg-surface-muted/50" />
            ))}
          </div>
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

  const submitColumn = () => {
    const name = newColumn.trim();
    if (name && name.length <= COLUMN_NAME_MAX) {
      createColumnMutation.mutate({ boardId: board.id, name });
    }
    setNewColumn("");
    setAddingColumn(false);
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
    <div className="board-surface board-grain relative flex min-h-screen flex-col">
      <main className={`relative z-[1] flex flex-1 flex-col overflow-hidden ${wide ? "w-full" : "w-full max-w-6xl"} px-6 pt-6`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              style={{ backgroundColor: board.color, boxShadow: `0 4px 14px -2px ${board.color}80` }}
              className="h-7 w-7 shrink-0 rounded-full ring-2 ring-white/80"
            />
            <h1 className="text-[1.75rem] font-bold leading-none tracking-tight text-foreground text-balance">
              {board.name}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ViewSwitcher
              mode={viewMode}
              onModeChange={setViewMode}
              swimlaneBy={swimlaneBy}
              onSwimlaneByChange={setSwimlaneBy}
            />
            <BoardMenu
              editable={editable}
              owner={isOwner(board)}
              wide={wide}
              onToggleWide={toggleWide}
              onEdit={() => setShowEdit(true)}
              onHistory={() => setShowActivity(true)}
              onLabels={() => setShowLabels(true)}
              onTemplates={() => setShowTemplates(true)}
              onArchived={() => setShowArchived(true)}
              onAccess={() => setShowAccess(true)}
              onArchive={() => setConfirmArchive(true)}
            />
          </div>
        </div>

        {board.description ? (
          <p className="mt-4 max-w-prose text-sm leading-relaxed text-foreground/70">{board.description}</p>
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
          <div className="mt-6 flex flex-1 snap-x snap-mandatory items-start gap-4 overflow-x-auto pb-4 sm:snap-none">
            <SortableContext
              items={columns.map((c) => c.id)}
              strategy={horizontalListSortingStrategy}
            >
              {filteredColumns.map((column) => (
                <Column
                  key={column.id}
                  column={column}
                  boardId={board.id}
                  editable={editable}
                  onRename={(name) =>
                    updateColumnMutation.mutate({ id: column.id, name })
                  }
                  onArchive={() => archiveColumnMutation.mutate({ id: column.id })}
                  onAddCard={(title) =>
                    createCardMutation.mutate({ columnId: column.id, title })
                  }
                  onAddFromTemplate={(templateId) =>
                    instantiateMutation.mutate(
                      { id: templateId, columnId: column.id },
                      { onSuccess: (created) => created && setActiveCardId(created.id) },
                    )
                  }
                  onOpenCard={(card) => setActiveCardId(card.id)}
                />
              ))}
            </SortableContext>

            {editable ? (
              addingColumn ? (
                <div className="flex w-72 shrink-0 flex-col gap-2 self-start rounded-2xl border border-border/70 bg-surface/70 p-3 shadow-[0_2px_10px_-4px_rgb(30_41_59/0.12)] backdrop-blur-sm">
                  <input
                    autoFocus
                    aria-label="new column name"
                    value={newColumn}
                    maxLength={COLUMN_NAME_MAX}
                    onChange={(e) => setNewColumn(e.target.value)}
                    onBlur={submitColumn}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitColumn();
                      if (e.key === "Escape") {
                        setNewColumn("");
                        setAddingColumn(false);
                      }
                    }}
                    placeholder="List name, e.g. To do"
                    className="rounded-lg border border-border px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={submitColumn}
                    className="self-start rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                  >
                    Add list
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingColumn(true)}
                  className="flex w-72 shrink-0 items-center gap-1.5 self-start rounded-2xl border border-dashed border-border px-3 py-3 text-left text-sm font-semibold text-muted transition-all duration-200 hover:border-indigo-300 hover:bg-surface/60 hover:text-indigo-600 active:scale-[0.99]"
                >
                  <Plus className="h-4 w-4" />
                  Add another list
                </button>
              )
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

      {editable ? (
        <Modal
          open={showTemplates}
          onClose={() => setShowTemplates(false)}
          title="Card templates"
          widthClassName="max-w-lg"
        >
          <TemplatesManager boardId={board.id} editable={editable} />
        </Modal>
      ) : null}

      {editable ? (
        <EditBoardModal
          projectId={id!}
          board={{ id: board.id, name: board.name, description: board.description ?? null, color: board.color }}
          open={showEdit}
          onClose={() => setShowEdit(false)}
        />
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
            <p className="text-sm text-foreground/70">
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
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface-muted"
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
