# Command Palette + Keyboard Shortcuts â€” Frontend Plan

An ACTION launcher (command palette) plus a GLOBAL keyboard-shortcut layer with a
discoverable help overlay. The command palette lists ACTIONS (navigate / create /
board actions / account) â€” distinct from the existing card SEARCH palette
(`SearchPalette.tsx`, opened by `Cmd/Ctrl+K`). Fuzzy-filter the action list, arrow
keys to move, `Enter` to run. Shortcuts are input-guarded and registered once in
`AppLayout`. Press `?` for a help overlay listing every shortcut.

Frontend-only feature. Reuses `useTRPC()` directly (no custom api hooks, per
`frontend.md`), the `Modal` (Radix Dialog) overlay pattern, `react-router`
`useNavigate`, `lucide-react` icons, and a zustand store mirroring `useSearchStore`.

> **Grounding (real files read + verified line numbers):**
> - Existing search palette + its store: `SearchPalette.tsx:20-26`,
>   `useSearchStore.ts:5-13` (`{ open, setOpen }` zustand). Test-mock pattern:
>   `SearchPalette.test.tsx:1-73`.
> - `Cmd/Ctrl+K` is ALREADY bound to SEARCH in `AppLayout.tsx:21-30` (a single
>   `window` keydown effect, `preventDefault`, cleanup). The new palette MUST NOT
>   reuse `Cmd/K`. NOTE: `AppLayout` also uses `useSearchStore.setOpen` for the
>   mobile header Search button (`AppLayout.tsx:15,45`) â€” keep that binding when the
>   `Cmd/K` effect is moved out.
> - Routes (`App.tsx`): `/projects` (`:92`), `/projects/new` (`:93`),
>   `/projects/:id` (`:94`), `/boards/:boardId` redirect (`:95`),
>   `/projects/:id/boards/:boardId` (`:96`),
>   `/projects/:id/boards/:boardId/edit` (`:97`), `/admin` (`:102`). Board params
>   are `:id` (projectId) + `:boardId`. **There is NO board-CREATE route** â€” boards
>   are created via an in-page modal in `ProjectDetailPage`
>   (`setShowCreateBoard(true)`, `ProjectDetailPage.tsx:87`).
> - `Modal` wraps Radix Dialog with Esc + backdrop close + focus trap
>   (`Modal.tsx:2,16-43`); default `max-w-sm`, pass `widthClassName="max-w-xl"`.
>   ONLY `@radix-ui/react-dialog` + `@radix-ui/react-toast` are installed
>   (`package.json:29-30`) â€” no dropdown/popover/select; `Modal` is the overlay.
> - Logout: `useLogout()` returns `{ run, pending }` (`useLogout.ts:31`).
> - Project list: `trpc.projects.list` (`Sidebar.tsx:34-39`,
>   `SearchPalette.tsx:54-56`).
> - Endpoints exist: `trpc.boardViews.set` (`board-view.router.ts:21`),
>   `trpc.cards.create` (`card.router.ts:28`, input `{ columnId, title }`),
>   `trpc.auth.logout` (`auth.router.ts:123`).
> - **Board view + panel actions are LOCAL state in `BoardDetailPage`**:
>   `viewMode`/`setViewMode` (`:76`), `swimlaneBy` (`:77`),
>   `showArchived` (`:68`), `showAccess` (`:69`), `showLabels` (`:70`),
>   `showActivity` (`:71`), filters `labelFilter`/`assigneeFilter`/`assignedToMe`/
>   `dueFilter` (`:72-75`). `ViewSwitcher onModeChange={setViewMode}` (`:372-377`),
>   panel openers History `:399`, Manage labels `:408`, Archived `:418`, Manage
>   access `:428`. A GLOBAL palette has NO access to this local state.
> - **Permission gates in the page**: edit actions use `editable = canEdit(board)`
>   (`:215`; "Manage labels" `:405`, "Archived items" `:415`). ACCESS uses
>   `isOwner(board)` (`:425,529`), NOT `canEdit`. "History" is UNGATED (`:397`).
>   Helpers: `canEdit`/`isOwner` in `features/board/utils.ts:27,31`.
> - **`newCard` has NO board-level affordance**: add-card is fully LOCAL to each
>   `Column` (`Column.tsx:29-30` `adding`/`title`; wired via `onAddCard`,
>   `BoardDetailPage.tsx:481-483`). The page owns `createCardMutation`
>   (`:182-184`) and the sorted `columns` (`:216`). `newCard` must create through
>   `cards.create` directly (see bridge below); "focus the column input" is NOT
>   reachable from outside Column.
> - No fuzzy-match library is a project dep (`frontend.md` lists none) â€” implement a
>   tiny in-repo subsequence matcher; do NOT add a dependency.

## Decisions

### NEW `CommandPalette`, NOT an extended `SearchPalette` â€” DECIDED
- Add a SEPARATE `CommandPalette` component + `useCommandStore`, not a mode toggle
  inside `SearchPalette`. Rationale:
  - The two have DIFFERENT data shapes and lifecycles. Search is async, debounced,
    paginated, backed by `trpc.search.cards` (`SearchPalette.tsx:59-73`). The
    command palette is SYNCHRONOUS over a small in-memory action registry with
    fuzzy keyboard nav â€” a mode switch would fork nearly every branch.
  - They own different shortcuts: `Cmd/K` = search (taken, `AppLayout.tsx:23`). The
    command palette gets its OWN shortcut (`Cmd/Ctrl+P`) and its OWN store.
  - Mirrors the established one-store-per-overlay pattern (`useSearchStore`).
- **Shortcut for the command palette: `Cmd/Ctrl+P`.** The browser default is Print;
  we `preventDefault()` it. Requirements: match
  `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p"`, call `preventDefault()`
  FIRST and synchronously, then open. Modifier combos bypass the typing guard (they
  are not text the user is typing), exactly like `Cmd/K`. Best-effort: very old
  Safari may still print; documented in the help overlay.

### Board-context actions: a tiny `useBoardActionsStore` bridge â€” DECIDED
Board actions only make sense on a board and live in `BoardDetailPage` LOCAL state
(`BoardDetailPage.tsx:67-78`). A global palette cannot call `setViewMode` etc.
directly. Options weighed:

1. Navigate with a query param. Rejected: pollutes URLs; panel toggles are ephemeral
   UI, not URL-worthy.
2. Lift all board view/panel state into a store. Rejected: large refactor of a
   working page (`views` feature just landed); out of scope and risky.
3. **A tiny `useBoardActionsStore` of CALLBACKS registered by the active board
   page.** DECIDED. `BoardDetailPage`, on mount, registers handlers + a `ctx`; it
   clears them on unmount (guarded â€” see below). The palette reads `ctx` to decide
   WHICH board actions to show and calls a registered callback to RUN them.

- The store shape (note `isOwner` added â€” access is owner-gated, not edit-gated):
  ```
  interface BoardActions {
    ctx: {
      projectId: string; boardId: string; boardName: string;
      canEdit: boolean; isOwner: boolean;
    } | null;
    handlers: {
      setView: (mode: BoardViewModeValue) => void;
      openArchived: () => void; openHistory: () => void;
      openLabels: () => void; openAccess: () => void;
      clearFilters: () => void; newCard: () => void;
    } | null;
    register: (ctx, handlers) => void;
    clear: (boardId: string) => void; // no-op if ctx.boardId !== boardId
  }
  ```
- **Stale-callback safety (race fix):** `register` stamps `ctx.boardId`. Cleanup
  calls `clear(boardId)`, which clears ONLY when the store still holds THAT boardId.
  This prevents a late-unmounting page (StrictMode double-invoke, or A->B nav) from
  wiping a freshly-mounted board's registration. The palette and
  `useGlobalShortcuts` MUST guard `ctx === null` / `handlers === null` before
  reading or calling (board commands are built only when `ctx !== null`; `c`/`b`
  are no-ops when `ctx` is null), so a palette opened after unmount simply shows no
  board actions.
- `BoardDetailPage` registers in a `useEffect` keyed on
  `[boardId, board, editable]`; cleanup `clear(boardId)`. Handler mapping:
  - `setView` -> `setViewMode`
  - `openArchived` -> `setShowArchived(true)` (only registered when `editable`)
  - `openHistory` -> `setShowActivity(true)` (always)
  - `openLabels` -> `setShowLabels(true)` (only when `editable`)
  - `openAccess` -> `setShowAccess(true)` (only when `isOwner`)
  - `clearFilters` -> reset `labelFilter`/`assigneeFilter`/`assignedToMe`/`dueFilter`
  - `newCard` -> see below
- **`newCard` concrete flow (no Column refactor, no new mutation):** guard
  `columns.length > 0`; call
  `createCardMutation.mutate({ columnId: columns[0].id, title: "New card" },
  { onSuccess: (created) => setActiveCardId(created.id) })` so the new card opens in
  the existing `CardEditor` for immediate rename. Uses the page's existing
  `createCardMutation` (`:182`) + `columns` (`:216`). If `columns.length === 0` the
  handler is a no-op (and the "New card" command is hidden).
- Keep "switch view" and board panel actions ONLY when `ctx !== null`. Navigation +
  create-project actions are always available.

### Action registry built from context â€” DECIDED
- A pure builder `buildCommands({ navigate, ctx, handlers, logout, projects,
  openSearch, openHelp, setOpen, canAdmin })` returns `Command[]`. Plain function
  (unit-testable without React).
- `Command` shape:
  ```
  interface Command {
    id: string;
    label: string;
    group: "Navigate" | "Create" | "Board" | "Account";
    keywords?: string[];
    icon?: LucideIcon;
    shortcut?: string;   // display hint e.g. "g p" (NOT bound here)
    run: () => void;     // closes palette then performs the action
  }
  ```
- Groups + contents:
  - **Navigate**: "Go to Projects" (`/projects`), "Admin" (`/admin`, only when
    `canAdmin` via `useCanAny(ADMIN_READ_PERMS)`, `Sidebar.tsx:28`,
    `constants.ts:4`), and "Go to project: <name>" per project from
    `trpc.projects.list`. Board navigation is OUT OF SCOPE for v1 (needs a
    boards-per-project fetch); noted as a follow-up.
  - **Create**: "New project" (navigate `/projects/new`). **"New board"**: there is
    NO board-create route; the create UI is a modal on the project page. So this
    command is included ONLY when a project ctx exists and it NAVIGATES to
    `/projects/${ctx.projectId}` (where the New-board modal lives). If no project
    ctx, the command is omitted. (Do NOT invent a `/boards/new` route.) "New card on
    current board" only when `ctx` set + `ctx.canEdit` + (page has >=1 column);
    calls `handlers.newCard()`.
  - **Board** (only when `ctx` set): "Switch to Kanban / Table / Calendar /
    Swimlanes view" (`setView(mode)` using `BoardViewMode` from `shared`), "Open
    History" (`openHistory`, always), "Open Archived items" (`openArchived`, edit
    only), "Manage labels" (`openLabels`, edit only), "Board members / access"
    (`openAccess`, **owner only** â€” `ctx.isOwner`), "Clear filters"
    (`clearFilters`).
  - **Account**: "Log out" (`logout.run()`), "Keyboard shortcuts" (`openHelp()`),
    "Search cards" (`openSearch(true)` â€” opens the existing `SearchPalette`).
- Context-excluded commands are filtered OUT before render (not greyed).

### Fuzzy filter â€” in-repo subsequence matcher â€” DECIDED
- Implement `fuzzyScore(query, target): number | null` in
  `features/command/fuzzy.ts`: case-insensitive subsequence over
  `label + " " + (keywords ?? []).join(" ")`; `null` when not all query chars appear
  in order, else a score (consecutive-run + word-boundary bonus). Empty query -> all
  commands, original order. Pure + unit-testable.
- `filterCommands(commands, query)`: map to `{ cmd, score }`, drop `null`, stable
  sort by score desc. Group headers render only for groups with >=1 survivor.

### Global shortcut handler â€” single source, input-guarded â€” DECIDED
- A `useGlobalShortcuts()` hook registered ONCE in `AppLayout`. One `window` keydown
  listener with cleanup (same shape as `AppLayout.tsx:21-30`).
- **Input guard (critical):** before handling any single-char / chord shortcut, bail
  if the event target is a typing context. `isTypingTarget(el)` is true when the
  target node name is `INPUT`, `TEXTAREA`, or `SELECT`, OR `el.isContentEditable`,
  OR `el.closest('[role="textbox"]') != null`. (`SELECT` matters: real selects exist
  at `SearchPalette.tsx:125` and the board filter bars; the markdown card editor
  uses `TEXTAREA`.) Modifier combos (`Cmd/Ctrl+P`, `Cmd/Ctrl+K`) bypass the guard;
  bare keys (`c`, `b`, `?`, `/`, `g p`) are suppressed in typing context.
- **`g p` chord:** a small state machine â€” bare `g` (outside inputs, no modifier)
  arms a 1s window via a `useRef` (flag + timeout); the next key resolves it
  (`g` then `p` -> `/projects`). Any non-`p` key or timeout disarms WITHOUT
  preventing default, so it cannot swallow typing. Only `g p` is a chord in v1.
- **`?` vs `/`:** `?` is Shift+`/`; `e.key === "?"` already implies Shift and is a
  distinct value from `e.key === "/"`. `?` handler: `e.key === "?"` and no
  meta/ctrl/alt. `/` handler: `e.key === "/"` and no modifiers. Both input-guarded.
  No clash.
- **Esc:** Radix `Modal` already closes overlays on Esc (`Modal.tsx:14-15`) â€” do NOT
  add a global Esc handler. Document Esc in the help overlay as "close overlays".

### Shortcut map (v1) â€” DECIDED
| Keys        | Action                          | Where bound                         |
|-------------|---------------------------------|-------------------------------------|
| `Cmd/Ctrl+K`| Open card search                | moved into `useGlobalShortcuts`     |
| `/`         | Open card search                | new (alias; outside inputs)         |
| `Cmd/Ctrl+P`| Open command palette            | new (`preventDefault` Print)        |
| `?`         | Open keyboard-shortcuts help    | new (outside inputs; = Shift+/)     |
| `c`         | New card on current board       | new (board ctx + canEdit + cols)    |
| `b`         | Go to current project           | new (board ctx only)                |
| `g` then `p`| Go to Projects                  | new (chord, outside inputs)         |
| `Esc`       | Close open overlay              | Radix Dialog default (no new bind)  |

`c` -> `handlers.newCard()` only if `ctx?.canEdit`; `b` -> navigate
`/projects/${ctx.projectId}` when a board ctx is present (else no-op). Both are
no-ops when `ctx` is null (post-unmount safety). Show only the context-valid ones as
"active" in the help overlay.

## 1. Shared types
- [x] No new `shared` code. Reuse `BoardViewMode` / `BoardViewModeValue`
  (`board-view.schema.ts:4,10`; imported `BoardDetailPage.tsx:14-21`) for the
  view-switch commands. Type project items from `trpc.projects.list` output (as
  `SearchPalette.tsx:5,57`).

## 2. Command store (`features/command/useCommandStore.ts`)
- [x] zustand `{ open: boolean; setOpen(v: boolean): void }` mirroring
  `useSearchStore.ts:10-13`.

## 3. Help-overlay store (`features/command/useShortcutHelpStore.ts`)
- [x] zustand `{ open: boolean; setOpen(v: boolean): void }` (same shape).

## 4. Board-actions bridge store (`features/command/useBoardActionsStore.ts`)
- [x] zustand store per the Decisions shape (`ctx` incl. `canEdit` + `isOwner`,
  `handlers`, `register`, `clear(boardId)` guarded). No persistence.
- [x] `BoardDetailPage.tsx` â€” ONE `useEffect` keyed `[boardId, board, editable]`:
  when `board` is loaded, `register(ctx, handlers)`; cleanup `clear(boardId)`.
  `ctx = { projectId: id!, boardId: board.id, boardName: board.name, canEdit:
  editable, isOwner: isOwner(board) }`. Handlers per the mapping above; `newCard`
  via `createCardMutation` + `setActiveCardId(created.id)`; `openArchived`/
  `openLabels` registered only when `editable`, `openAccess` only when
  `isOwner(board)` (or register them but have the registry gate via ctx â€” pick one;
  gating in the registry via `ctx.canEdit`/`ctx.isOwner` is simpler and keeps
  handlers stable). This is the ONLY change to the board page.

## 5. Fuzzy matcher (`features/command/fuzzy.ts`)
- [x] `fuzzyScore(query, target): number | null` (subsequence, case-insensitive,
  consecutive + word-boundary bonus; empty query -> 0 = match-all).
- [x] `filterCommands(commands, query): Command[]` (score, drop nulls, stable sort).

## 6. Command registry (`features/command/commands.ts`)
- [x] `Command` interface + `buildCommands(ctx)` returning Navigate / Create /
  Board / Account commands per the Decisions. Context-excluded commands omitted.
  Each `run` first `setOpen(false)` then performs the action.

## 7. Command palette (`features/command/components/CommandPalette.tsx`)
- [x] Reuse `Modal` (Radix Dialog) `title="Command palette"`,
  `widthClassName="max-w-xl"`; render nothing when closed (mirror
  `SearchPalette.tsx:24`).
- [x] Body: one autofocused input (`aria-label="command input"`) bound to local
  `query` (NO debounce â€” synchronous in-memory filter).
- [x] Build commands via `buildCommands` from: `useNavigate`,
  `useBoardActionsStore` (ctx + handlers), `useLogout`, `useCommandStore.setOpen`,
  `useSearchStore.setOpen`, `useShortcutHelpStore.setOpen`, `trpc.projects.list`
  (`useQuery`, same input as `Sidebar.tsx:34-39`), and `canAdmin` via
  `useCanAny(ADMIN_READ_PERMS)`.
- [x] `filterCommands(commands, query)` -> grouped render (header per non-empty
  group, fixed order Navigate / Create / Board / Account). Row: icon + label +
  optional right-aligned `shortcut`. Empty -> "No commands".
- [x] Keyboard nav: local `activeIndex` over the FLAT filtered list; ArrowDown/Up
  wrap, `Enter` runs `filtered[activeIndex].run()`. Reset `activeIndex` to 0 on
  `query` change. Hover sets `activeIndex`; click runs. `aria-selected` on the
  active row.
- [x] Every `run` `setOpen(false)` first, then performs the action.

## 8. Help overlay (`features/command/components/ShortcutHelp.tsx`)
- [x] Reuse `Modal` (`title="Keyboard shortcuts"`, `max-w-lg`); nothing when closed.
- [x] Static grouped list of the shortcut map: `<kbd>` chips + description. Source
  rows from a single `SHORTCUTS` constant in `features/command/shortcuts.ts` shared
  with the registry's `shortcut` hints (no drift).
- [x] Caption noting context-only shortcuts (`c`/`b` require a board;
  `c` also requires edit + a column; Cmd/P overrides browser Print).

## 9. Global shortcut hook (`features/command/useGlobalShortcuts.ts`)
- [x] One `window` keydown effect (cleanup), mirroring `AppLayout.tsx:21-30`. Reads
  the three stores' `setOpen`, `useBoardActionsStore`, and `useNavigate`.
- [x] `isTypingTarget(target)` guard (INPUT/TEXTAREA/SELECT/contenteditable/
  role=textbox). Modifier combos bypass; bare keys + chords suppressed in inputs.
- [x] Handle: `Cmd/Ctrl+P` -> `preventDefault` + open command palette;
  `Cmd/Ctrl+K` -> open search (MOVED here; preventDefault); `/` -> open search
  (outside inputs); `?` -> open help; `c` -> `handlers?.newCard()` when
  `ctx?.canEdit`; `b` -> navigate `/projects/${ctx.projectId}` when `ctx`; `g` arms
  the chord, `g`->`p` -> `/projects`.
- [x] No global Esc handler (Radix Dialog handles it).

## 10. Wire into `AppLayout` (`components/AppLayout.tsx`)
- [x] Delete ONLY the inline `Cmd/K` `useEffect` (`AppLayout.tsx:21-30`) and call
  `useGlobalShortcuts()` instead. KEEP `const setOpen = useSearchStore(...)`
  (`:15`) â€” the mobile header Search button (`:45`) still needs it.
- [x] Mount `<CommandPalette />` and `<ShortcutHelp />` once next to the existing
  `<SearchPalette />` (`AppLayout.tsx:64`).
- [x] (Optional) "Command" entry-point button â€” SKIP v1 (keyboard-first); follow-up.

## 11. Tests (vitest â€” mirror `SearchPalette.test.tsx` mocking)
Mock `react-router-dom` `useNavigate`, the stores, and `trpc` per
`SearchPalette.test.tsx:13-39`.

### fuzzy (pure)
- [x] `fuzzyScore`: subsequence matches ("gtp" matches "Go to Projects"); non-match
  `null`; empty query matches all; consecutive/word-boundary outrank scattered.
- [x] `filterCommands`: drops non-matches; sorts by score; empty query returns all
  in original order.

### registry (pure)
- [x] no board ctx: includes Navigate (Projects) + Create (New project) + Account
  (Log out, Shortcuts, Search); EXCLUDES Board actions, "New card", and "New board".
- [x] board ctx `canEdit:true, isOwner:true`: includes "Switch to Table view",
  "Open Archived items", "New card on current board", "Clear filters", "Board
  members / access".
- [x] board ctx `canEdit:false`: EXCLUDES "New card", "Manage labels", "Archived
  items"; still includes view switch, "Open History", "Clear filters".
- [x] board ctx `canEdit:true, isOwner:false`: EXCLUDES "Board members / access".
- [x] "New board" present only when a project/board ctx exists and navigates to
  `/projects/<id>` (NOT a `/boards/new` route).
- [x] Admin command present only when `canAdmin` true.

### palette component
- [x] opens when `useCommandStore.open`; autofocuses input; renders nothing closed.
- [x] lists grouped actions (Navigate/Create/Account headers).
- [x] typing "proj" filters to project commands; "zzzz" -> "No commands".
- [x] `Enter` on a NAVIGATE command calls `navigate` with the path + `setOpen(false)`.
- [x] `Enter` on "New card on current board" calls registered `handlers.newCard`.
- [x] ArrowDown/Up move `activeIndex` (aria-selected follows); `Enter` runs it.
- [x] clicking a row runs + closes.

### global shortcuts (hook)
- [x] `Cmd/Ctrl+P` opens command palette and `preventDefault`s; does NOT open search.
- [x] `Cmd/Ctrl+K` still opens search (regression â€” the MOVED handler).
- [x] `?` opens help.
- [x] bare `c`/`b`/`g`/`?`/`/` fired while focus is in `<input>`/`<textarea>`/
  `<select>`/contenteditable do NOTHING; the SAME keys outside inputs fire.
- [x] `c` runs `newCard` only when `ctx.canEdit`; no-op when `ctx` is null
  (post-unmount safety).
- [x] `g` then `p` navigates `/projects`; `g` then unrelated key (or timeout) does
  not navigate and does not preventDefault.
- [x] no clash: `Cmd/P` leaves the search store closed, and vice-versa.

### bridge store
- [x] `clear(boardId)` is a no-op when the store holds a DIFFERENT boardId (stale
  unmount does not wipe a live registration).

### help overlay
- [x] renders rows from `SHORTCUTS`; `?` opens it; Esc closes (Radix default).

## 12. Verify
- [x] `pnpm --filter frontend test` green.
- [x] `pnpm --filter frontend build` (typecheck) clean.
- [x] Manual: `Cmd/P` opens the palette anywhere (no browser Print); arrow + Enter
  run navigate/create; on a board, view-switch + History always, archived/labels
  only when editor, access only when owner; `?` shows help; `Esc` closes; typing in
  a card title/textarea/select does NOT trigger `c`/`b`/`?`/`/`; `Cmd/K` still opens
  search; switching boards does not leak stale board actions. e2e only on dev/prod
  per `CLAUDE.md`.
</content>

