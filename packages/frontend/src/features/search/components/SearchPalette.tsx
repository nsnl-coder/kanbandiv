import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import type { DueFilter, Project, SearchResult } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { useSearchStore } from "../../../hooks/useSearchStore";
import { Modal } from "../../../components/Modal";
import { DueDateBadge } from "../../board/components/DueDateBadge";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 250;

const DUE_CHIPS: { value: DueFilter; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: "Due soon" },
  { value: "has_due", label: "Has due" },
];

export function SearchPalette() {
  const open = useSearchStore((s) => s.open);
  const setOpen = useSearchStore((s) => s.setOpen);

  if (!open) return null;
  return <PaletteBody onClose={() => setOpen(false)} />;
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [due, setDue] = useState<DueFilter | undefined>(undefined);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<SearchResult[]>([]);

  // Debounce the raw text into the query that hits the backend.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  // Reset the page accumulator whenever the query or filters change.
  useEffect(() => {
    setOffset(0);
    setItems([]);
  }, [q, due, projectId]);

  const enabled = q.length > 0 || due !== undefined;

  const projectsQuery = useQuery(
    trpc.projects.list.queryOptions({ filter: "owned", limit: 100, offset: 0 }),
  );
  const projects: Project[] = projectsQuery.data ?? [];

  const searchQuery = useQuery(
    trpc.search.cards.queryOptions(
      { q, due, projectId, limit: PAGE_SIZE, offset },
      { enabled },
    ),
  );

  // Append each loaded page into the accumulator keyed by its offset.
  useEffect(() => {
    const page = searchQuery.data;
    if (!page) return;
    setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
  }, [searchQuery.data, offset]);

  const nextOffset = searchQuery.data?.nextOffset ?? null;

  const toggleDue = (value: DueFilter) =>
    setDue((cur) => (cur === value ? undefined : value));

  const openResult = (r: SearchResult) => {
    navigate(`/projects/${r.projectId}/boards/${r.boardId}?card=${r.cardId}`);
    onClose();
  };

  const showHint = !enabled;
  const showEmpty =
    enabled && !searchQuery.isLoading && items.length === 0 && offset === 0;

  const grouped = useMemo(() => groupByBoard(items), [items]);

  return (
    <Modal open onClose={onClose} title="Search cards" widthClassName="max-w-2xl">
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted" />
        <input
          ref={inputRef}
          autoFocus
          type="text"
          aria-label="search input"
          placeholder="Search cards by title or description..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="filters">
        {DUE_CHIPS.map((chip) => {
          const on = due === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              aria-label={`filter ${chip.label}`}
              aria-pressed={on}
              onClick={() => toggleDue(chip.value)}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                on
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-border bg-surface text-foreground/70 hover:bg-surface-muted"
              }`}
            >
              {chip.label}
            </button>
          );
        })}
        <select
          aria-label="project scope"
          value={projectId ?? ""}
          onChange={(e) => setProjectId(e.target.value || undefined)}
          className="ml-auto rounded-lg border border-border px-2 py-1 text-xs text-foreground/70"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {showHint ? (
          <p className="px-1 py-6 text-center text-sm text-muted">
            Type to search
          </p>
        ) : null}

        {searchQuery.error ? (
          <p className="px-1 py-6 text-center text-sm text-red-600">
            Something went wrong. Try again.
          </p>
        ) : null}

        {showEmpty ? (
          <p className="px-1 py-6 text-center text-sm text-muted">
            No cards found
          </p>
        ) : null}

        {searchQuery.isLoading && offset === 0 && enabled ? (
          <p className="px-1 py-6 text-center text-sm text-muted">
            Searching...
          </p>
        ) : null}

        {grouped.map((group) => (
          <div key={group.boardId} className="mb-3">
            <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {group.boardName}
            </p>
            <ul className="flex flex-col gap-1">
              {group.items.map((r) => (
                <li key={r.cardId}>
                  <button
                    type="button"
                    onClick={() => openResult(r)}
                    className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-surface-muted"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {r.title}
                    </span>
                    <span className="text-xs text-muted">
                      {`${r.boardName} â€º ${r.columnName}`}
                    </span>
                    {r.snippet ? (
                      <span className="text-xs text-muted">{r.snippet}</span>
                    ) : null}
                    <DueDateBadge card={{ dueAt: r.dueAt, isOverdue: r.isOverdue }} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {nextOffset != null ? (
          <button
            type="button"
            onClick={() => setOffset(nextOffset)}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground/70 hover:bg-surface-muted"
          >
            Load more
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

function groupByBoard(items: SearchResult[]) {
  const order: string[] = [];
  const map = new Map<string, { boardId: string; boardName: string; items: SearchResult[] }>();
  for (const r of items) {
    let group = map.get(r.boardId);
    if (!group) {
      group = { boardId: r.boardId, boardName: r.boardName, items: [] };
      map.set(r.boardId, group);
      order.push(r.boardId);
    }
    group.items.push(r);
  }
  return order.map((id) => map.get(id)!);
}
