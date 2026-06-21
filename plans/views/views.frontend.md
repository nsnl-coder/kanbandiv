# Saved Board Views â€” Frontend Plan

Four ways to view a board's cards â€” KANBAN (existing), TABLE, CALENDAR,
SWIMLANES â€” switchable from the board header, with the chosen mode + active
filters PERSISTED per `(user, board)` and restored on reopen. The shared
filters (label ids, assignee ids, assigned-to-me, due) apply across ALL view
modes; persistence rides on the new backend endpoint (`views.backend.md`).

**No new card-fetch.** TABLE + SWIMLANES render from the SAME `BoardData` the
page already loads via `trpc.boards.getData` (`BoardDetailPage.tsx:75`); its
`columns[].cards[]` are already enriched (labels, assignees, `dueAt`/`isOverdue`,
cover, counts). CALENDAR reuses the existing `trpc.cards.due` query
(`card.router.ts:22`). Reuse the existing badges (`DueDateBadge`, `LabelBadge`,
`AssigneeStack`) in table/calendar/swimlane cells.

**tRPC key (sync with backend):** `trpc.boardViews.get` / `trpc.boardViews.set`.
Use `useTRPC()` directly (no custom api hooks, per `frontend.md`).

All new components live under `features/board/components/`; the page is
`pages/user/projects/BoardDetailPage.tsx`.

## Key decisions (decided)

### One filter source, applied everywhere â€” DECIDED
- The page ALREADY owns the filter state: `labelFilter`, `assigneeFilter`,
  `assignedToMe` (`BoardDetailPage.tsx:61-63`) and the matching helpers
  `cardMatchesLabels` / `cardMatchesAssignees` / `cardAssignedToUser`
  (`utils.ts:62,110,100`). Add ONE more piece of filter state, `dueFilter`
  (`"overdue" | "due_soon" | "has_due" | null`), and ONE derived helper
  `cardMatchesDue(card, dueFilter)` built on the existing `dueState` helper
  (`utils.ts:125`). A single pure function `filterCards(cards, f)` applies ALL
  four predicates and is reused by EVERY view (kanban / table / calendar /
  swimlanes) â€” no per-view filter logic. This guarantees "filters apply across
  all modes".
- KANBAN keeps its current inline filter (`BoardDetailPage.tsx:408-413`) but
  refactored to call the shared `filterCards` so it stays in lockstep.

### View mode state + persistence â€” DECIDED
- Add `viewMode` state (`BoardViewModeValue`, default from the loaded saved view)
  and `swimlaneBy` state (`"label" | "assignee" | null`).
- HYDRATE on load: `trpc.boardViews.get.queryOptions({ boardId })` runs alongside
  `boards.getData`. When it resolves, seed `viewMode` + all filter state from
  `data.config` ONCE (an effect guarded by a "hydrated" ref so later user edits
  are not clobbered by a refetch). Until it resolves, render kanban with empty
  filters (the default the endpoint also returns) â€” no flicker because `get`
  never 404s and returns the default fast.
- PERSIST on change: a single `debouncedSave` (â‰ˆ500 ms) calls
  `trpc.boardViews.set.mutationOptions()` with the CURRENT `{ mode, config }`
  whenever `viewMode`, `swimlaneBy`, `labelFilter`, `assigneeFilter`,
  `assignedToMe`, or `dueFilter` changes (a `useEffect` on those deps, skipped
  until hydrated). Debounce so dragging a multi-select filter does not spam the
  API. No optimistic cache write needed â€” the saved view is only read on mount.
  - Build `config` from state with the SAME shape as `boardViewConfigSchema`
    (`labelIds`, `assigneeIds`, `assignedToMe`, `due`, `swimlaneBy`). A tiny
    `toConfig(state)` / `fromConfig(config)` pair in `features/board/boardView.ts`
    keeps the mapping in one place.
- Decided: persist via the endpoint, NOT localStorage â€” the requirement is
  per-(user, board) server persistence so it follows the user across devices.
  (`boardWide` stays localStorage; it is a device preference, not per-board.)

### View switcher placement â€” DECIDED
- A segmented control (Kanban / Table / Calendar / Swimlanes) in the board header
  button row (`BoardDetailPage.tsx:310`), left of the existing
  Fit/Edit/History/â€¦ buttons. Render it for ANY viewer (read needs only board
  `view`; the page only loads for users who can view). Use `lucide-react` icons
  (e.g. `Columns3`, `Table`, `Calendar`, `Rows3`) + text, matching the existing
  header button styling.
- When `viewMode === "swimlanes"`, show a small grouping toggle ("by label" /
  "by assignee") next to the switcher, bound to `swimlaneBy` (default `"label"`
  when entering swimlanes with `swimlaneBy === null`).
- The filter bars (`LabelFilterBar`, `AssigneeFilterBar`, `BoardDetailPage.tsx:386`)
  stay visible in ALL modes (filters are cross-mode). Add a small DUE filter
  control (a `<select>` or segmented: Any / Overdue / Due soon / Has due) in the
  same filter row, bound to `dueFilter`.

### Each non-kanban view is a self-contained component â€” DECIDED
- `BoardTableView`, `BoardCalendarView`, `BoardSwimlanesView` each take the
  already-FILTERED, already-loaded data and render. The page computes the filtered
  card set once and routes to the active view. KANBAN keeps its existing inline
  DnD rendering (DnD is kanban/swimlane only).

## 1. Shared types (already from backend build)
- [x] After `pnpm --filter shared build`, the FE imports `BoardViewMode`,
  `BoardViewModeValue`, `BoardView`, `BoardViewConfig`, `defaultBoardView` from
  `shared`. No FE-local re-declaration of the enum.

## 2. Filter plumbing (`features/board/utils.ts` + page)
- [x] `utils.ts` â€” add `cardMatchesDue(card: Pick<Card,"dueAt"|"isOverdue">, due:
  DueViewFilter | null): boolean`. Map: `null` â†’ true; `"has_due"` â†’
  `!!card.dueAt`; `"overdue"` â†’ `dueState(card) === "overdue"`; `"due_soon"` â†’
  `dueState(card) === "soon"` (reuse the existing `dueState`, `utils.ts:125`, so
  the 24h "soon" window matches the badge). `DueViewFilter` =
  `"overdue" | "due_soon" | "has_due"` (import from `shared` if exported there).
- [x] `utils.ts` â€” add `filterCards(cards: Card[], f: { labelIds: string[];
  assigneeIds: string[]; assignedToMe: boolean; due: DueViewFilter | null;
  currentUserId: string }): Card[]` that ANDs `cardMatchesLabels`,
  `cardMatchesAssignees`, `cardAssignedToUser` (when `assignedToMe`) and
  `cardMatchesDue`. Pure + unit-testable. (Keeps the page logic thin.)
- [x] `features/board/boardView.ts` (new) â€” `toConfig(state)` and
  `fromConfig(config)` mapping between page state and `BoardViewConfig`; export
  `VIEW_MODES` (the 4 modes for the switcher) and `SWIMLANE_GROUPINGS`.
- [x] `BoardDetailPage.tsx` â€” add state: `viewMode`, `swimlaneBy`, `dueFilter`,
  and a `hydrated` ref. Replace the inline kanban filter
  (`BoardDetailPage.tsx:408-413`) with `filterCards(column.cards, {...})`.

## 3. Persistence wiring (`BoardDetailPage.tsx`)
- [x] Add `const viewQuery = useQuery(trpc.boardViews.get.queryOptions({ boardId:
  boardId! }))`. On first successful resolve (guarded by `hydrated`), set
  `viewMode` + all filter state from `viewQuery.data.config` / `.mode`, then mark
  hydrated.
- [x] Add `const saveView = useMutation(trpc.boardViews.set.mutationOptions())`.
  A `useEffect` on `[viewMode, swimlaneBy, labelFilter, assigneeFilter,
  assignedToMe, dueFilter]` (skipped until `hydrated`) calls a debounced fn that
  `saveView.mutate({ boardId, mode: viewMode, config: toConfig(state) })`.
  Implement the debounce with a `useRef<ReturnType<typeof setTimeout>>` cleared
  on each change and on unmount (no new dep; matches the codebase's no-extra-lib
  preference). 500 ms.

## 4. View switcher (`features/board/components/ViewSwitcher.tsx`)
- [x] Segmented control: props `{ mode, onModeChange, swimlaneBy,
  onSwimlaneByChange }`. Renders 4 buttons (Kanban/Table/Calendar/Swimlanes) with
  `aria-pressed`; when `mode === "swimlanes"` also renders the by-label/by-assignee
  toggle. Header styling mirrors the existing buttons (`BoardDetailPage.tsx:316`).
- [x] Mount in the header button row (`BoardDetailPage.tsx:310`), first item.

## 5. Due filter control
- [x] A small control (segmented or `<select>`: Any / Overdue / Due soon / Has
  due) bound to `dueFilter`, placed in the filter row
  (`BoardDetailPage.tsx:385`). Decided: reuse the existing filter-bar visual
  language (chips/segmented) for consistency.

## 6. TABLE view (`features/board/components/BoardTableView.tsx`)
- [x] Props: `{ columns: BoardData["columns"]; onOpenCard(card) }`. Flatten all
  (already-filtered, ACTIVE) cards into one array tagged with their column name.
  Render `@tanstack/react-table` (already a dep, `frontend.md`) or a plain
  sortable `<table>` â€” DECIDED: plain `<table>` with local sort state (no new
  table feature needed; keep it simple) with columns:
  - Title (click â†’ `onOpenCard(card)`, opening the existing `CardEditor`).
  - Column (the card's column name).
  - Assignees â€” reuse `AssigneeStack` (`AssigneeStack.tsx`).
  - Labels â€” reuse `LabelBadge` (compact) per label (`LabelBadge.tsx`).
  - Due â€” reuse `DueDateBadge` (`DueDateBadge.tsx`).
- [x] Sortable by DUE, TITLE, COLUMN (click a header to toggle asc/desc). Sort
  is client-side over the flattened array. Due sort puts `null` due last. Use the
  shared `sortByPosition` ONLY for tie-breaks if needed; sorting is local state.
- [x] Empty state when no cards match the filters.

## 7. CALENDAR view (`features/board/components/BoardCalendarView.tsx`)
- [x] Props: `{ boardId }`. Month grid (current month, prev/next nav via local
  `monthCursor` state). Fetch cards with due dates via
  `trpc.cards.due.queryOptions({ boardId, from: monthStart, to: monthEnd })`
  (the EXISTING `cards.due` endpoint â€” `card.router.ts:22`, backed by
  `listDueCards` `card.service.ts:245`). Do NOT add a new endpoint.
- [x] Apply label/assignee/assigned-to-me filtering to the returned cards. **AUDIT
  FIX (L3): SKIP the `due` predicate in calendar.** All `cards.due` results have a
  due date, and the calendar's axis IS the due date; re-applying a `due` filter
  (e.g. user left it on "overdue") would hide cards the month grid is meant to
  show. Call `filterCards(cards, { ...f, due: null })` so the due predicate is a
  no-op while label/assignee/assigned-to-me still apply. Pass `currentUserId` for
  assigned-to-me.
- [x] Place each card on its `dueAt` day cell; click â†’ `onOpenCard`. Reuse
  `DueDateBadge`/`LabelBadge`/`AssigneeStack` in the cell. Build the month grid
  in plain JS (weeks Ã— 7), no new date lib.
- [x] Loading + empty (no due cards this month) states.

## 8. SWIMLANES view (`features/board/components/BoardSwimlanesView.tsx`)
- [x] Props: `{ columns; swimlaneBy; labels; onOpenCard; editable; â€¦DnD
  handlers }`. Render the SAME kanban columns, but the card area is split into
  horizontal LANES grouped by `swimlaneBy`:
  - `"label"`: one lane per board label (+ a "No label" lane). A card appears in
    each lane for each of its labels (a card with 2 labels shows in 2 lanes) â€”
    DECIDED: duplicate across its label lanes (Trello-like); state it. Cards with
    no labels go to "No label". Label lanes come from the `labels` prop.
  - `"assignee"`: one lane per assignee PRESENT ON THE FILTERED CARDS (+ an
    "Unassigned" lane). A card with multiple assignees appears in each.
  - **AUDIT FIX (H1) â€” no `members` prop.** The page's `members`
    (`BoardDetailPage.tsx:96-98`) is `MentionMember[] = {name}[]` from
    `accessList` and has NO user id, so it CANNOT key assignee lanes. DERIVE
    assignee lanes from the (already filtered) cards' own
    `assignees: { id, email }[]` (enriched card carries them, `card.enrich.ts:94`;
    `assigneeSchema = { id, email }`). Lane key = assignee `id`; lane label =
    email local-part (reuse `assigneeDisplayName`, `utils.ts:70`). A member with
    zero cards correctly gets no lane.
- [x] Within each lane, lay out the existing columns horizontally and place the
  (filtered) cards under their column â€” reuse the existing `Column`/`CardTile`
  rendering where practical, or a lighter read-only card cell. DnD across lanes is
  OUT OF SCOPE for v1 (lanes are derived from labels/assignees, not a stored
  position) â€” keep swimlanes read-only-reorder: clicking a card opens the editor;
  moving cards stays a kanban-mode action. State this scope limit.
- [x] Use `filterCards` first, then group. Lane order: labels by their order,
  assignees alphabetical by handle, with the "none" lane last.

## 9. Page routing between views (`BoardDetailPage.tsx`)
- [x] Compute `const filteredColumns = columns.map((c) => ({ ...c, cards:
  filterCards(c.cards, {...}) }))` once.
- [x] Render by `viewMode`:
  - `"kanban"` â†’ the existing DnD board (refactored to use `filteredColumns`).
  - `"table"` â†’ `<BoardTableView columns={filteredColumns} onOpenCard=â€¦ />`.
  - `"calendar"` â†’ `<BoardCalendarView boardId={board.id} onOpenCard=â€¦ />`
    (calendar does its own `cards.due` fetch + filter).
  - `"swimlanes"` â†’ `<BoardSwimlanesView columns={filteredColumns}
    swimlaneBy={swimlaneBy ?? "label"} â€¦ />`.
- [x] `CardEditor` (`BoardDetailPage.tsx:485`) is shared by ALL views â€” opening a
  card from table/calendar/swimlane uses the SAME `activeCardId` flow. No change
  to the editor.

## 10. Tests (vitest, mirror existing `features/board` component tests)
### filter helpers (pure, unit)
- [x] `cardMatchesDue`: null â†’ all; `has_due` â†’ only carded-due; `overdue`/
  `due_soon` align with `dueState`.
- [x] `filterCards`: ANDs label + assignee + assigned-to-me + due; empty filters
  pass everything; combined filters narrow correctly.
- [x] `toConfig`/`fromConfig` round-trip: state â†’ config â†’ state is identity;
  config matches `BoardViewConfig` field names.

### view switcher
- [x] renders 4 modes; clicking a mode calls `onModeChange`; `aria-pressed`
  reflects the active mode; the swimlane grouping toggle shows ONLY in swimlanes
  mode and calls `onSwimlaneByChange`.

### table view
- [x] renders one row per (filtered) card with title/column/assignees/labels/due
  cells (badges present); clicking a title calls `onOpenCard`.
- [x] sorting by due/title/column toggles asc/desc and reorders rows; null-due
  rows sort last.
- [x] empty state when no cards match.

### calendar view
- [x] places a card on its `dueAt` day cell; prev/next month nav re-queries with
  the new `from`/`to`; applies `filterCards`; loading + empty states.
  (Mock `trpc.cards.due` per existing component-test mocking style.)

### swimlanes view
- [x] by-label: a card with 2 labels appears in BOTH label lanes; a card with no
  labels appears in "No label". by-assignee: multi-assignee card in each lane;
  unassigned in "Unassigned". `filterCards` applied before grouping.

### persistence (page-level)
- [x] on mount, hydrates `viewMode` + filters from `boardViews.get` data; until
  resolved, shows kanban with empty filters; hydration does not clobber a user
  edit made after load (hydrated guard).
- [x] changing the view mode / a filter triggers a DEBOUNCED `boardViews.set`
  with the correct `{ mode, config }` (assert the mutation input via the mocked
  trpc client; assert it is debounced, not called per keystroke).
- [x] filters apply ACROSS modes: setting a label filter then switching kanban â†’
  table â†’ swimlanes shows the same filtered set in each.

## 11. Verify
- [x] `pnpm --filter shared build` (types available).
- [x] `pnpm --filter frontend test` green (filter helpers, switcher, table,
  calendar, swimlanes, persistence).
- [x] `pnpm --filter frontend build` (typecheck) clean.
- [ ] Manual: open a board, switch to Table/Calendar/Swimlanes, set filters,
  reload - the mode + filters restore (per-user, per-board). e2e only on dev/prod
  per `CLAUDE.md`.

