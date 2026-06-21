# Command Palette + Keyboard Shortcuts — Production-Readiness Audit

Audited the frontend + backend plans against the real codebase. Every referenced
file was opened. Findings below, ordered by severity. The plan files were rewritten
in place with these fixes applied.

## Verified-correct claims (no change needed)
- `Cmd/Ctrl+K` is bound to search in `AppLayout.tsx:21-30` via a single `window`
  keydown effect with `preventDefault()` and cleanup. Exact effect confirmed.
- `Modal` wraps Radix Dialog (`Modal.tsx:2,16-43`); Esc + backdrop close + focus
  trap are the Radix default. `widthClassName` default `max-w-sm`. Confirmed.
- Only `@radix-ui/react-dialog` and `@radix-ui/react-toast` are installed
  (`package.json:29-30`). No dropdown/popover/select Radix packages. The plan's
  "use Modal (Dialog)" choice is the only viable overlay primitive. Confirmed.
- `useSearchStore` is `{ open, setOpen }` zustand (`useSearchStore.ts:5-13`).
- `useLogout()` returns `{ run, pending }` (`useLogout.ts:31`), backed by
  `trpc.auth.logout` (`auth.router.ts:123`). Confirmed.
- `trpc.boardViews.set` (`board-view.router.ts:21`), `trpc.cards.create`
  (`card.router.ts:28`), `trpc.projects.list` (used `Sidebar.tsx:34`,
  `SearchPalette.tsx:54`) all exist with the cited shapes.
- `useCanAny(ADMIN_READ_PERMS)` exists (`useCan.ts:12`, `constants.ts:4`).
- `BoardViewMode` / `BoardViewModeValue` exist in shared
  (`board-view.schema.ts:4,10`) and are imported in `BoardDetailPage.tsx:14-21`.
- Board local state exists: `viewMode/setViewMode` (`BoardDetailPage.tsx:76`),
  `swimlaneBy` (`:77`), `showArchived` (`:68`), `showAccess` (`:69`),
  `showLabels` (`:70`), `showActivity` (`:71`), filters (`:72-75`).
- Routes `/projects`, `/projects/new`, `/projects/:id`,
  `/projects/:id/boards/:boardId`, `/admin` all exist (`App.tsx:92-102`).

## Issues found

### S1 — BLOCKER: "New board" navigates to a route that does NOT exist
The plan (frontend Create group) said "New board navigates to the current
project's board-create page". There is no board-create route. The only board
routes are `/projects/:id/boards/:boardId` (detail) and `.../edit`
(`App.tsx:96-97`). Board creation is an in-page MODAL in `ProjectDetailPage`
(`setShowCreateBoard(true)`, `ProjectDetailPage.tsx:87`), not a navigable URL.
Fix: drop "New board" from v1, OR make it navigate to `/projects/:id` (the project
page that holds the create-board modal). Plan updated to navigate to the project
page only when a project ctx exists, and explicitly note the create UI is a modal
there. Removed the fictional "board-create page".

### S2 — BLOCKER: `newCard` has no real target; "focus the add-card input" is impossible
Add-card is fully LOCAL to each `Column` (`adding`/`title` state, `Column.tsx:29-30`,
`onAddCard` prop wired at `BoardDetailPage.tsx:481-483`). There is NO board-level
"new card" affordance and no React-reachable handle to focus a column's input from
outside without lifting Column state. The plan's "focus the add-card input OR open
the first column's affordance" is not implementable as written.
Fix: `newCard` calls the page's existing `createCardMutation.mutate({ columnId:
firstColumn.id, title })` directly (the page owns `createCardMutation`
`:182` and `columns` `:216`), creating a card in the first column, then opens it via
`setActiveCardId(newId)` in the mutation `onSuccess`. Guard `columns.length > 0`.
No new mutation path, no Column refactor. Plan updated with this concrete flow.

### S3 — HIGH: wrong permission gate for board "access" action
The plan listed "Board members / access" under edit-only / `canEdit`. In the page,
the access panel is gated by `isOwner(board)` (`BoardDetailPage.tsx:425,529`), NOT
`canEdit`. Exposing `openAccess` to non-owners would surface an action whose UI the
user cannot reach. Fix: gate `openAccess` on `ctx.isOwner`. Added `isOwner` to the
bridge `ctx` (alongside `canEdit`). "Manage labels" stays `canEdit`-gated
(`:405,540`). "History" is ungated (`:397`) — keep it always-present on a board.

### S4 — HIGH: input guard misses `<select>` and must include the typing surfaces in use
The plan's `isTypingTarget` covered input/textarea/contenteditable/role=textbox but
omitted `<select>`. Real selects exist (`SearchPalette.tsx:125` project scope; board
filter bars). A bare `c`/`b` while a select is focused must not fire. Fix: add
`select` to the guard. Also explicitly include the markdown card editor textareas
(`CardEditor`) — already covered by the `textarea` check, but called out. This is the
highest-risk bug class (shortcuts firing while typing); plan now lists the exact
node-name set: `INPUT`, `TEXTAREA`, `SELECT`, `isContentEditable`,
`closest('[role="textbox"]')`.

### S5 — HIGH: stale board-action callbacks across board switches (race)
The bridge stores callbacks closing over the active board. Risk: when navigating
board A -> board B, A's effect cleanup must not wipe B's just-registered handlers,
and the palette must never call a cleared handler. Under react-router's single
`Outlet` the unmount(A)-then-mount(B) order makes the simple register/clear safe,
but React StrictMode double-invokes effects (mount, cleanup, mount) and a late
cleanup can clobber a live registration. Fix added to plan:
- `register(ctx, handlers)` stamps `ctx.boardId`.
- cleanup calls `clear(boardId)` which ONLY clears if the store still holds THAT
  boardId (guard against a stale page wiping the current one).
- The palette and `useGlobalShortcuts` MUST guard `ctx === null` / `handlers ===
  null` before reading/calling (e.g. `c` is a no-op when `ctx` is null). Board
  commands are built only when `ctx !== null`, so a palette opened after unmount
  shows no board actions.

### S6 — MEDIUM: `Cmd/Ctrl+P` print interception — correct technique, add guards
`preventDefault()` on a `window` keydown handler suppresses the browser Print dialog
in Chrome/Edge/Firefox (same mechanism already proven for `Cmd/K`,
`AppLayout.tsx:24`). Requirements made explicit in the plan: match
`(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p"`, call `preventDefault()`
synchronously and FIRST, and do not also let the browser see it (no `return` before
preventDefault). Note: modifier combos bypass the typing guard (they are not text),
matching `Cmd/K`. Edge case (Safari older versions may still print) accepted as
best-effort; documented in the help overlay.

### S7 — MEDIUM: keep `useSearchStore` import in `AppLayout` after moving `Cmd/K`
The plan moves the `Cmd/K` effect into `useGlobalShortcuts` and deletes the inline
effect. But `AppLayout` ALSO uses `useSearchStore.setOpen` for the mobile header
Search button (`AppLayout.tsx:15,45`). Removing the effect must NOT remove the
import or the `setOpen` binding. Plan updated: delete ONLY the `useEffect`
(`:21-30`); keep `const setOpen = useSearchStore(...)` for the mobile button.

### S8 — LOW: `?` vs `/` — confirmed no clash
`?` is produced by Shift+`/` on US layouts; `e.key === "?"` already implies Shift,
and is a distinct value from `e.key === "/"`. Handlers keyed on the produced char do
not collide. Plan now states: `?` handler matches `e.key === "?"` (no extra Shift
check needed and none of metaKey/ctrlKey/altKey set); `/` handler matches
`e.key === "/"` with no modifiers. Both input-guarded. Non-US-layout AltGr edge
accepted.

### S9 — LOW: `g p` chord cannot swallow normal typing
Chord arms only on bare `g` OUTSIDE a typing target. Since bare keys are
input-guarded, `g` typed in a field never arms. Outside fields there is no text
entry, so there is nothing to swallow. Sound. Plan clarifies: while armed, only `p`
is consumed; any other key (or the 1s timeout) disarms WITHOUT preventing default.

### S10 — INFO: minor line-number drift in the "Grounding" block
Several cited line numbers were slightly off (e.g. board state block is `:67-78`,
real `:67-78` ok; `openLabels` is `:408` not `:418`; `openArchived` `:418`).
Corrected the citations to the verified lines to keep the plan trustworthy.

### S11 — INFO: extra route exists, harmless
`App.tsx:95` has `/boards/:boardId` -> `BoardRedirect` (not mentioned in the plan).
Not needed by this feature; noted so the registry author does not assume board
deep-links are unavailable.

## Summary of plan edits
- Frontend: fixed New-board target (S1), concrete `newCard` via `cards.create`
  (S2), `isOwner` gate for access (S3), expanded input guard incl. `select` (S4),
  boardId-stamped register/`clear(boardId)` + null guards (S5), explicit `Cmd/P`
  preventDefault rules (S6), keep `useSearchStore` in AppLayout (S7), `?`/`/`
  disambiguation (S8), chord no-swallow note (S9), corrected citations (S10/S11).
- Backend: unchanged conclusion (no backend). Tightened wording: New board uses NO
  endpoint (modal navigation only); `newCard` uses the existing `cards.create`.
</content>
</invoke>
