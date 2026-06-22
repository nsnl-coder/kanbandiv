import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, useLocation } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Board } from "shared";
import {
  LayoutDashboard,
  Plus,
  ChevronDown,
  KanbanSquare,
  Settings,
  Shield,
  LogOut,
  Search,
  PanelLeftClose,
  PanelLeft,
  X,
} from "lucide-react";
import { useTRPC } from "../lib/trpc";
import { useAuthStore } from "../hooks/useAuthStore";
import { useSearchStore } from "../hooks/useSearchStore";
import { useSidebarStore } from "../hooks/useSidebarStore";
import { useUiStore } from "../hooks/useUiStore";
import { useLogout } from "../hooks/useLogout";
import { useCanAny } from "../features/rbac/hooks/useCan";
import { ADMIN_READ_PERMS } from "../features/rbac/constants";
import { NotificationBell } from "../features/notification/components/NotificationBell";
import { ReportBugButton } from "../features/bug-report/components/ReportBugButton";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu } from "./AccountMenu";
import { SidebarProject } from "./SidebarProject";
import { CreateProjectModal } from "../features/project/components/CreateProjectModal";
import {
  SidebarDndContext,
  dndId,
  neighboursOf,
  parseDndId,
} from "./sidebarDnd";
import { useToastStore } from "../hooks/useToastStore";

const itemBase = "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition";

// Expanded sidebar body, shared by the desktop rail and the mobile drawer.
// `headerAction` is the top-right control (collapse on desktop, close on mobile).
function SidebarContent({ headerAction }: { headerAction?: ReactNode }) {
  const trpc = useTRPC();
  const openSearch = useSearchStore((s) => s.setOpen);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [sharedOpen, setSharedOpen] = useState(false);
  const sharedHeight = useSidebarStore((s) => s.sharedHeight);
  const setSharedHeight = useSidebarStore((s) => s.setSharedHeight);
  const middleRef = useRef<HTMLDivElement>(null);
  const sharedRef = useRef<HTMLDivElement>(null);

  // Drag the divider above "Shared with me" to resize it; result is persisted.
  const startSharedResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = sharedRef.current?.offsetHeight ?? 200;
    const containerH = middleRef.current?.clientHeight ?? 600;
    const max = Math.max(140, containerH - 140);
    const onMove = (ev: PointerEvent) => {
      setSharedHeight(Math.min(max, Math.max(96, startH + (startY - ev.clientY))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const ownedQuery = useQuery(
    trpc.projects.list.queryOptions({ filter: "owned", limit: 100, offset: 0 }),
  );
  const sharedQuery = useQuery(
    trpc.projects.list.queryOptions({ filter: "shared", limit: 100, offset: 0 }),
  );
  const owned = ownedQuery.data ?? [];
  const shared = sharedQuery.data ?? [];

  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.add);
  // projectId -> currently loaded boards, populated by open SidebarProjects.
  const boardsRef = useRef(new Map<string, Board[]>());
  // The item currently being dragged, rendered as a floating DragOverlay.
  const [dragging, setDragging] = useState<
    { kind: "project" | "board"; name: string; color: string } | null
  >(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const invalidateBoards = () =>
    queryClient.invalidateQueries({ queryKey: trpc.boards.list.queryKey() });

  const ownedKey = trpc.projects.list.queryKey({ filter: "owned", limit: 100, offset: 0 });
  const sharedKey = trpc.projects.list.queryKey({ filter: "shared", limit: 100, offset: 0 });

  const moveProject = useMutation(
    trpc.projects.move.mutationOptions({
      onError: (err) => addToast(err.message),
      onSettled: () => queryClient.invalidateQueries({ queryKey: ownedKey }),
    }),
  );
  const moveShared = useMutation(
    trpc.projects.moveShared.mutationOptions({
      onError: (err) => addToast(err.message),
      onSettled: () => queryClient.invalidateQueries({ queryKey: sharedKey }),
    }),
  );
  const moveBoard = useMutation(
    trpc.boards.move.mutationOptions({
      onError: (err) => addToast(err.message),
      onSettled: invalidateBoards,
    }),
  );

  // Live cross-container arrangement during a board drag. Mirrored in a ref for
  // synchronous reads inside drag handlers; the state copy drives rendering.
  const [dragBoards, setDragBoardsState] = useState<Map<string, Board[]> | null>(null);
  const arrangementRef = useRef<Map<string, Board[]> | null>(null);
  const setArrangement = (m: Map<string, Board[]> | null) => {
    arrangementRef.current = m;
    setDragBoardsState(m);
  };
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const dragOriginRef = useRef<string | null>(null);

  const boardsKey = (projectId: string) => trpc.boards.list.queryKey({ projectId });

  // Boards for a project, preferring the live arrangement over the query cache.
  const listFor = (pid: string): Board[] =>
    arrangementRef.current?.get(pid) ?? boardsRef.current.get(pid) ?? [];

  const containerOf = (boardId: string): string | undefined => {
    const arr = arrangementRef.current;
    if (arr) {
      for (const [pid, list] of arr) if (list.some((b) => b.id === boardId)) return pid;
    }
    for (const [pid, list] of boardsRef.current) {
      if (list.some((b) => b.id === boardId)) return pid;
    }
    return undefined;
  };

  const findBoard = (boardId: string): Board | undefined => {
    const arr = arrangementRef.current;
    if (arr) {
      for (const list of arr.values()) {
        const hit = list.find((b) => b.id === boardId);
        if (hit) return hit;
      }
    }
    for (const list of boardsRef.current.values()) {
      const hit = list.find((b) => b.id === boardId);
      if (hit) return hit;
    }
    return undefined;
  };

  const eqIds = (a: Board[], b: Board[]) =>
    a.length === b.length && a.every((x, i) => x.id === b[i].id);

  const onDragStart = ({ active }: DragStartEvent) => {
    const a = parseDndId(String(active.id));
    if (a.kind === "project") {
      const p = owned.find((x) => x.id === a.id) ?? shared.find((x) => x.id === a.id);
      if (p) setDragging({ kind: "project", name: p.name, color: p.color });
      return;
    }
    const b = findBoard(a.id);
    if (b) setDragging({ kind: "board", name: b.name, color: b.color });
    dragOriginRef.current = containerOf(a.id) ?? null;
  };

  // Relocate the dragged board between projects live as the pointer hovers.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const a = parseDndId(String(active.id));
    if (a.kind !== "board") return;
    const o = parseDndId(String(over.id));
    const activeId = a.id;
    const currentPid = containerOf(activeId);
    if (!currentPid) return;

    const targetPid = o.kind === "project" ? o.id : containerOf(o.id);
    if (!targetPid) return;

    if (targetPid !== currentPid) setOpenProjectId(targetPid);

    // Into another project whose boards aren't loaded yet: let the auto-expand
    // fetch them first; the next hover will preview the precise slot.
    if (
      targetPid !== currentPid &&
      !arrangementRef.current?.has(targetPid) &&
      !boardsRef.current.has(targetPid)
    ) {
      return;
    }

    const base = arrangementRef.current ?? new Map<string, Board[]>();
    const curList = [...listFor(currentPid)];
    const moving = curList.find((b) => b.id === activeId) ?? findBoard(activeId);
    if (!moving) return;

    if (targetPid === currentPid) {
      if (o.kind !== "board") return; // hovering own header keeps current order
      const from = curList.findIndex((b) => b.id === activeId);
      const to = curList.findIndex((b) => b.id === o.id);
      if (from === -1 || to === -1 || from === to) return;
      const reordered = arrayMove(curList, from, to);
      if (eqIds(reordered, listFor(currentPid))) return;
      const next = new Map(base);
      next.set(currentPid, reordered);
      setArrangement(next);
      return;
    }

    // Cross-container: drop active out of its current list into the target.
    const tgtList = [...listFor(targetPid)].filter((b) => b.id !== activeId);
    const insertAt =
      o.kind === "board"
        ? Math.max(0, tgtList.findIndex((b) => b.id === o.id))
        : tgtList.length;
    tgtList.splice(insertAt, 0, { ...moving, projectId: targetPid });
    const newCur = curList.filter((b) => b.id !== activeId);
    if (eqIds(tgtList, listFor(targetPid)) && eqIds(newCur, listFor(currentPid))) return;
    const next = new Map(base);
    next.set(currentPid, newCur);
    next.set(targetPid, tgtList);
    setArrangement(next);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const a = parseDndId(String(active.id));

    if (a.kind === "project") {
      setArrangement(null);
      setOpenProjectId(null);
      if (!over || active.id === over.id) return;
      const o = parseDndId(String(over.id));
      if (o.kind !== "project") return;
      // Reorder within whichever list holds the dragged project. Owned uses the
      // project's global position; shared uses the caller's per-user order.
      const inOwned = owned.some((p) => p.id === a.id);
      const list = inOwned ? owned : shared;
      const from = list.findIndex((p) => p.id === a.id);
      const to = list.findIndex((p) => p.id === o.id);
      if (from === -1 || to === -1) return; // ignore drags across the two lists
      const next = arrayMove(list, from, to);
      const move = { id: a.id, ...neighboursOf(next.map((p) => p.id), a.id) };
      if (inOwned) {
        queryClient.setQueryData(ownedKey, next); // optimistic preview
        moveProject.mutate(move);
      } else {
        queryClient.setQueryData(sharedKey, next);
        moveShared.mutate(move);
      }
      return;
    }

    // a.kind === "board": commit whatever the live arrangement settled on.
    const arr = arrangementRef.current;
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;

    if (arr) {
      const finalPid = containerOf(a.id) ?? origin ?? "";
      const finalList = arr.get(finalPid) ?? [];
      const neighbours = neighboursOf(finalList.map((b) => b.id), a.id);
      // Persist the preview into the caches, then drop the overlay (no flicker).
      for (const [pid, list] of arr) queryClient.setQueryData(boardsKey(pid), list);
      setArrangement(null);
      setOpenProjectId(null);
      if (!origin || !finalPid) return;
      if (finalPid === origin) moveBoard.mutate({ id: a.id, ...neighbours });
      else moveBoard.mutate({ id: a.id, toProjectId: finalPid, ...neighbours });
      return;
    }

    // Fallback: a quick drop before the live arrangement seeded (e.g. onto a
    // still-collapsed project). Resolve the move directly from `over`.
    setOpenProjectId(null);
    if (!over || !origin) return;
    const o = parseDndId(String(over.id));
    const targetPid = o.kind === "project" ? o.id : containerOf(o.id);
    if (!targetPid) return;
    const sourceList = boardsRef.current.get(origin) ?? [];
    const moving = sourceList.find((b) => b.id === a.id);

    if (targetPid === origin) {
      if (o.kind !== "board") return;
      const from = sourceList.findIndex((b) => b.id === a.id);
      const to = sourceList.findIndex((b) => b.id === o.id);
      if (from === -1 || to === -1) return;
      const next = arrayMove(sourceList, from, to);
      queryClient.setQueryData(boardsKey(origin), next);
      moveBoard.mutate({ id: a.id, ...neighboursOf(next.map((b) => b.id), a.id) });
      return;
    }

    if (!moving) return;
    const targetList = boardsRef.current.get(targetPid) ?? [];
    const without = targetList.filter((b) => b.id !== a.id);
    const at = o.kind === "board" ? without.findIndex((b) => b.id === o.id) : -1;
    const insertIdx = at === -1 ? without.length : at;
    const nextTarget = [
      ...without.slice(0, insertIdx),
      { ...moving, projectId: targetPid },
      ...without.slice(insertIdx),
    ];
    queryClient.setQueryData(boardsKey(origin), sourceList.filter((b) => b.id !== a.id));
    queryClient.setQueryData(boardsKey(targetPid), nextTarget);
    moveBoard.mutate({
      id: a.id,
      toProjectId: targetPid,
      ...neighboursOf(nextTarget.map((b) => b.id), a.id),
    });
  };

  const onDragCancel = () => {
    setDragging(null);
    setArrangement(null);
    setOpenProjectId(null);
    dragOriginRef.current = null;
  };

  const registerBoards = (projectId: string, list: Board[]) => {
    boardsRef.current.set(projectId, list);
  };

  return (
    <>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1.5 font-semibold text-foreground">
            <LayoutDashboard className="h-5 w-5 text-indigo-600" />
            Trello Clone
          </Link>
          <div className="flex items-center gap-1">
            <NotificationBell />
            {headerAction}
          </div>
        </div>
      </div>

      <SidebarDndContext.Provider value={{ registerBoards, dragBoards, openProjectId }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
      <div ref={middleRef} className="flex min-h-0 flex-1 flex-col gap-1 p-3">
        <div className="flex shrink-0 items-center justify-between px-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Projects
          </span>
          <button
            type="button"
            onClick={() => setShowCreateProject(true)}
            aria-label="New project"
            className="rounded p-1 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <nav className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {ownedQuery.isLoading ? (
            <p className="px-3 py-2 text-sm text-muted">Loading...</p>
          ) : owned.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">No projects yet</p>
          ) : (
            <SortableContext
              items={owned.map((p) => dndId("project", p.id))}
              strategy={verticalListSortingStrategy}
            >
              {owned.map((p) => (
                <SidebarProject key={p.id} project={p} />
              ))}
            </SortableContext>
          )}
        </nav>

        {/* Drag handle to resize the section below. Only useful while open. */}
        {sharedOpen ? (
          <div
            onPointerDown={startSharedResize}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize shared projects"
            className="group mt-1 flex h-2 shrink-0 cursor-row-resize items-center justify-center"
          >
            <span className="h-0.5 w-8 rounded-full bg-border transition group-hover:bg-indigo-400" />
          </div>
        ) : null}
        {/* Pinned to the bottom of the scroll area. Defaults to a cap so the
            project list stays taller; the user can resize it (persisted). */}
        <div
          ref={sharedRef}
          style={sharedOpen && sharedHeight != null ? { height: sharedHeight } : undefined}
          className={`flex shrink-0 flex-col ${
            sharedOpen && sharedHeight != null ? "" : "mt-2 max-h-[40%]"
          }`}
        >
          <button
            type="button"
            onClick={() => setSharedOpen((o) => !o)}
            aria-expanded={sharedOpen}
            className={`${itemBase} w-full shrink-0 justify-between text-muted hover:bg-surface-muted`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide">
              Shared with me
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${sharedOpen ? "rotate-180" : ""}`}
            />
          </button>
          {sharedOpen ? (
            <nav className="mt-0.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {shared.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted">No shared projects</p>
              ) : (
                <SortableContext
                  items={shared.map((p) => dndId("project", p.id))}
                  strategy={verticalListSortingStrategy}
                >
                  {shared.map((p) => (
                    <SidebarProject key={p.id} project={p} />
                  ))}
                </SortableContext>
              )}
            </nav>
          ) : null}
        </div>
      </div>
      <DragOverlay>
        {dragging ? (
          <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-lg ring-1 ring-border">
            {dragging.kind === "board" ? (
              <KanbanSquare className="h-3.5 w-3.5 shrink-0" style={{ color: dragging.color }} />
            ) : (
              <span
                aria-hidden
                style={{ backgroundColor: dragging.color }}
                className="h-3 w-3 shrink-0 rounded-full"
              />
            )}
            <span className="truncate">{dragging.name}</span>
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>
      </SidebarDndContext.Provider>

      <div className="flex items-center gap-1 border-t border-border p-3">
        <div className="min-w-0 flex-1">
          <AccountMenu />
        </div>
        <button
          type="button"
          onClick={() => openSearch(true)}
          aria-label="Search"
          title="Search"
          className="shrink-0 rounded-lg p-2 text-muted transition hover:bg-surface-muted hover:text-foreground"
        >
          <Search className="h-4 w-4" />
        </button>
        <ReportBugButton />
      </div>

      <CreateProjectModal
        open={showCreateProject}
        onClose={() => setShowCreateProject(false)}
      />
    </>
  );
}

// Persistent left rail (desktop only). Hidden below md; the mobile drawer
// (MobileNav) renders the same content from the AppLayout top bar.
export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const canAdmin = useCanAny(ADMIN_READ_PERMS);
  const openSearch = useSearchStore((s) => s.setOpen);
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggle);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const logout = useLogout();

  if (collapsed) {
    return (
      <aside className="hidden w-14 shrink-0 flex-col items-center border-r border-border bg-surface py-3 md:flex">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <Link
          to="/"
          aria-label="Home"
          className="mt-1 rounded-lg p-2 text-indigo-600 hover:bg-surface-muted"
        >
          <LayoutDashboard className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={() => openSearch(true)}
          aria-label="Search"
          className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setShowCreateProject(true)}
          aria-label="New project"
          className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>

        <div className="mt-auto flex flex-col items-center gap-1">
          <ThemeToggle compact />
          <NavLink
            to="/settings"
            aria-label="Settings"
            className={({ isActive }) =>
              `rounded-lg p-2 ${
                isActive
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                  : "text-muted hover:bg-surface-muted hover:text-foreground"
              }`
            }
          >
            <Settings className="h-4 w-4" />
          </NavLink>
          {canAdmin ? (
            <NavLink
              to="/admin"
              aria-label="Admin"
              className={({ isActive }) =>
                `rounded-lg p-2 ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                    : "text-muted hover:bg-surface-muted hover:text-foreground"
                }`
              }
            >
              <Shield className="h-4 w-4" />
            </NavLink>
          ) : null}
          <button
            type="button"
            onClick={logout.run}
            disabled={logout.pending}
            aria-label="Log out"
            className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        <CreateProjectModal
          open={showCreateProject}
          onClose={() => setShowCreateProject(false)}
        />
      </aside>
    );
  }

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <SidebarContent
        headerAction={
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        }
      />
    </aside>
  );
}

// Mobile slide-over drawer with the full sidebar content. Closes on navigation.
export function MobileNav() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, setOpen]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl focus:outline-none md:hidden"
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <SidebarContent
            headerAction={
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            }
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
