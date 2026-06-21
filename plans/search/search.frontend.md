# Global Search & Filters — Frontend Plan

A global search launched from the app header (the "Trello Clone" brand bar in
`Sidebar.tsx` / the mobile `AppLayout.tsx` header). Typing a query searches CARDS
across every board the user can view (backend `trpc.search.cards`), shows a result
list with card title, its board/column, and a snippet, plus filters (label,
assignee, due, project/board scope). Clicking a result navigates to the board and
opens the card.

Use `useTRPC()` directly (no custom API hooks — `frontend.md` rule). Read-only: a
single `useQuery` against `trpc.search.cards`, no mutations.

> **Audit-verified (see `search.audit.md`):** trigger spots `Sidebar.tsx:63-73`
> + `AppLayout.tsx:15-29`; zustand `create` pattern `useAuthStore.ts:12`;
> `BoardDetailPage` uses local `activeCardId` (`:61`) with NO `useSearchParams`
> today (deep-link is genuinely additive); `Cmd/Ctrl+K` is NOT bound anywhere;
> route `/projects/:id/boards/:boardId` (`App.tsx:94`); `Modal.tsx` wraps Radix
> Dialog (Esc+backdrop close, focus trap) — reuse it but pass a wider
> `widthClassName` (e.g. `max-w-2xl`) since its default is `max-w-sm`.

## Decisions

### Header command-palette overlay, NOT a /search route — DECIDED
- A **modal overlay** (command-palette style, like the `Cmd/Ctrl+K` pattern)
  opened from a search button in the header, NOT a dedicated `/search` page.
  Rationale:
  - Global search is an action launched from anywhere; a route would lose the
    user's current board/project context and require back-navigation. The app
    already prefers modals over routes (`frontend.md`: "prefer to use modal over
    new route") and existing board panels (`LabelManager`, `BoardAccessPanel`,
    `BoardActivityPanel`) are modals opened from a header button — this is the
    established pattern.
  - A dropdown anchored to a tiny header input is too cramped for filters + a
    scrollable result list; a centered overlay (Radix Dialog) gives room for the
    query field, the filter row, and results, and is reachable on mobile.
- Trigger: a search button/input in BOTH `Sidebar.tsx` (desktop brand block,
  `Sidebar.tsx:65-73`) and the mobile header in `AppLayout.tsx:15-29`. Also bind a
  global `Cmd/Ctrl+K` keyboard shortcut to open it (nice-to-have; behind a single
  `useEffect` keydown listener — keep minimal).
- The overlay lives in a shared component (`components/SearchPalette.tsx`) mounted
  ONCE near the app shell (e.g. inside `AppLayout`) so it is available on every
  signed-in page, with open state in a tiny zustand store or local state lifted to
  `AppLayout`. **Decided:** a small zustand store `useSearchStore` (`open`,
  `setOpen`) mirroring `useAuthStore` — so the `Cmd/Ctrl+K` handler and both
  triggers (sidebar + mobile header) toggle the same instance without prop
  drilling.

### Debounced query, paginated results — DECIDED
- Debounce the text input ~250ms before issuing the query (avoid a request per
  keystroke; tsvector is whole-word so partial typing is noisy anyway). Simple
  `useEffect` + `setTimeout` or a tiny `useDebounced` helper.
- `useQuery(trpc.search.cards.queryOptions({ q, ...filters, limit, offset }))`
  with `enabled: q.trim().length > 0 || hasFilter` so the empty/short query never
  hits the backend (mirrors the backend short-circuit). Show a hint ("Type to
  search") when disabled.
- "Load more" appends pages using `nextOffset` from the response (same pattern the
  board activity feed uses — `plans/activity/activity.frontend.md`). Keep it
  simple: a `results: SearchResult[]` accumulator + `offset` state, OR
  `useInfiniteQuery` keyed on `{q, filters}`. **Decided:** plain `useQuery` per
  page + a local accumulator reset whenever `q`/filters change (lower complexity,
  matches the activity feed plan).

### Navigation + open the card — DECIDED
- Routes are nested: `/projects/:id/boards/:boardId` (`App.tsx:94`). A result
  carries `projectId` + `boardId` + `cardId`, so navigate to
  `/projects/${projectId}/boards/${boardId}?card=${cardId}` and close the overlay.
- **BoardDetailPage today opens cards via local `activeCardId` state only**
  (`BoardDetailPage.tsx:61,143`), with NO URL param. To deep-link a card from
  search, add a small change to `BoardDetailPage`: on mount / when
  `searchParams.get("card")` changes, `setActiveCardId(card)` if that id exists in
  the loaded board data; and when the editor closes, clear the `card` param. This
  is the ONLY change outside the search feature and is additive (existing in-board
  click flow still uses local state). Note this dependency in the task list.
  - Fallback if scoping the change is undesired: navigate to the board WITHOUT
    `?card=` (user lands on the board, finds the card visually). Decide: implement
    the `?card=` deep-link (better UX) and flag the `BoardDetailPage` edit.

## 1. Shared types
- [x] Consume from `shared` (built by the backend plan): `SearchResult`,
  `SearchPage`, `SearchCardsInput`, `dueFilterSchema` values. Prefer typing
  components from tRPC client outputs (`RouterOutputs["search"]["cards"]`) rather
  than importing schema-inferred types directly, matching how other features
  consume tRPC outputs (`plans/activity/activity.frontend.md` §1). No new shared
  code in this plan.

## 2. Search store (`hooks/useSearchStore.ts`)
- [x] zustand store `{ open: boolean; setOpen(v: boolean): void }` (mirror
  `useAuthStore` shape). Used by the triggers + the `Cmd/Ctrl+K` handler.

## 3. Search palette (`components/SearchPalette.tsx`)
- [x] Radix `Dialog` overlay (reuse the existing `Modal` component if it wraps
  Radix Dialog — check `components/Modal.tsx`; reuse it for consistent styling).
  Contents:
  - a text input (autofocus on open), debounced into `q`.
  - a filter row: due chips (`overdue` / `due soon` / `has due`) as single-select
    toggles; an optional project scope select; label + assignee filters are
    OPTIONAL for v1 (board-scoped label/assignee ids only make sense once a board
    scope is chosen — see note below). **Decided for v1:** ship due-state +
    project/board scope filters in the palette; expose `labelIds`/`assigneeIds`
    in the query but wire their UI only when a `boardId` scope is selected (a
    global label picker across all boards is out of scope — labels are
    board-local, `LabelsTable.board_id`). Reuse `LabelFilterBar`/`AssigneeFilterBar`
    (`features/board/components/`) scoped to the selected board when present.
  - results list: each row shows the card `title`, a `boardName › columnName`
    breadcrumb, the `snippet`, and a due badge when `dueAt` is set (reuse
    `DueDateBadge` from `features/board/components/`). Highlight the matched term
    client-side if desired (snippet is plain text from the backend).
  - states: disabled hint ("Type to search"), `isLoading` spinner, empty
    ("No cards found"), error message.
  - "Load more" button when `nextOffset != null`.
  - clicking a row → navigate (see Decisions) + `setOpen(false)`.
- [x] Keyboard: `Esc` closes (Radix Dialog default); arrow-up/down to move
  selection + `Enter` to open is a nice-to-have (keep minimal for v1, note it).

## 4. Triggers + global shortcut
- [x] `Sidebar.tsx` — add a "Search" button in the brand block (`Sidebar.tsx:65`)
  that calls `useSearchStore().setOpen(true)`; lucide `Search` icon, styled like
  the existing `itemBase` rows.
- [x] `AppLayout.tsx` — add a search button to the mobile header
  (`AppLayout.tsx:15-29`) calling the same store; mount `<SearchPalette />` once
  inside `AppLayout` so it is global across signed-in pages.
- [x] `Cmd/Ctrl+K` global listener (in `AppLayout` or the palette): `useEffect`
  keydown → `setOpen(true)`, `preventDefault`. Cleanup on unmount.

## 5. Deep-link the card on the board (additive change to BoardDetailPage)
- [x] `BoardDetailPage.tsx` — read `useSearchParams()`; on load and when the
  `card` param changes, if the board data contains a card with that id, call
  `setActiveCardId(cardId)` (it currently only sets via in-board click,
  `BoardDetailPage.tsx:391`). When the `CardEditor` closes
  (`BoardDetailPage.tsx:474`), also remove the `card` search param. Guard against
  setting before `board` data is loaded (`BoardDetailPage.tsx:130`). This makes
  `/projects/:id/boards/:boardId?card=<id>` open the card directly.

## 6. Tests (vitest, mirror existing board component tests)
Component tests render the palette with a mocked tRPC client (mirror
`LabelFilterBar.test.tsx` / `BoardActivityPanel.test.tsx` setup).

- [x] palette opens when the store `open` is true; autofocuses the input.
- [x] typing below the threshold / empty query shows the "Type to search" hint and
  does NOT issue the query (`enabled` false).
- [x] a query with results renders each row: title, `boardName › columnName`
  breadcrumb, snippet, and a due badge when `dueAt` set.
- [x] empty result set shows "No cards found".
- [x] "Load more" appears only when `nextOffset != null` and appends the next page.
- [x] clicking a result navigates to
  `/projects/{projectId}/boards/{boardId}?card={cardId}` and closes the palette
  (assert the navigate spy + `setOpen(false)`).
- [x] due-filter chip toggles the `due` param sent to the query; selecting a
  project scope sends `projectId`.
- [x] `Cmd/Ctrl+K` opens the palette; `Esc` closes it.
- [x] `BoardDetailPage`: visiting `...?card=<existing id>` opens the `CardEditor`
  for that card; closing it removes the `card` param (mirror
  `BoardDetailPage.test.tsx` setup).

## 7. Verify
- [x] `pnpm --filter shared build` (types available to FE).
- [x] `pnpm --filter frontend test` green.
- [x] manual: search finds a card by title and by description; filters narrow
  results; clicking opens the right board + card; a card on a board the user
  cannot view never appears (backend-enforced; spot-check with two accounts).
- [x] e2e (`e2e/frontend/search/`) runs only on dev/prod per `CLAUDE.md` — out of
  scope to run locally; a happy-path e2e (search → open card) is a follow-up.
</content>
