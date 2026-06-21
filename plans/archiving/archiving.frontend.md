# Board Archiving (soft-delete + restore) — Frontend Plan

Depends on the backend archive/restore/list-archived endpoints (typed via tRPC):
`boards.archive` / `boards.restore` / `boards.archived` / `boards.archivedItems`,
`columns.archive` / `columns.restore`, `cards.archive` / `cards.restore`. The
primary destructive action across the UI becomes **Archive**; **Delete
permanently** moves into the archived views and calls the existing
`boards.delete` / `columns.delete` / `cards.delete` mutations.

Use `useTRPC()` directly (no custom api hooks — `frontend.md` rule). Reuse the
existing `Modal` component (`components/Modal.tsx`, Radix Dialog: Esc + backdrop
close, focus trap) for the archived-items drawer and confirm dialogs, mirroring
`BoardAccessPanel` / `LabelManager` / `BoardActivityPanel` modal usage in
`BoardDetailPage` (`BoardDetailPage.tsx:429-458`).

> **Audit-verified source spots:**
> - Project boards grid: `ProjectDetailPage.tsx:23` (`boards.list`), tiles via
>   `BoardCard` (`:95`), `CreateBoardModal` (`:122`).
> - Board header action buttons (Edit/History/Manage labels/Manage access/Delete):
>   `BoardDetailPage.tsx:306-364`; the owner Delete button is `:354-363`.
> - Column header rename/delete buttons: `Column.tsx:91-113` (the `Trash2`
>   delete at `:104-111`).
> - Card delete: `CardEditor` `onDelete` wired in `BoardDetailPage.tsx:482-493`.
> - Card open via local `activeCardId` (`BoardDetailPage.tsx:62`); board data query
>   key `trpc.boards.getData.queryKey` (`:98`) with `invalidateData` helper (`:101`).

## Decisions

### Archive is the default destructive action; permanent delete lives in archived views — DECIDED
- **Board:** the header `Delete` button (`BoardDetailPage.tsx:354-363`) becomes
  **Archive** (calls `boards.archive`; on success navigate back to the project,
  the board now appears in the project's "Archived boards" section). Permanent
  delete is reachable only from the archived-boards section (owner only) behind a
  typed/confirm dialog — the existing `boards.delete` mutation.
- **Column:** the column header `Trash2` (`Column.tsx:104-111`) becomes **Archive**
  (calls `columns.archive`). Permanent delete is reachable from the board's
  "Archived items" drawer.
- **Card:** the `CardEditor` delete action becomes **Archive** (calls
  `cards.archive`, closes the editor). Permanent delete is reachable from the
  "Archived items" drawer.
- Keep one literal "Delete permanently" affordance per archived row, styled red,
  always behind a confirm dialog (mirror the existing board delete confirm,
  `BoardDetailPage.tsx:501-535`).

### Archived items surfaced as a drawer/modal per board + a section per project — DECIDED
- **Per board:** an "Archived items" button in the board header opens a modal
  listing archived columns and archived cards (`boards.archivedItems`), each with
  **Restore** and **Delete permanently**. Reuse `Modal` (`widthClassName="max-w-lg"`),
  mirroring the History/Access/Labels modals.
- **Per project:** an "Archived boards" collapsible section on
  `ProjectDetailPage` below the active boards grid, fed by `boards.archived`, each
  tile with **Restore** (owner) and **Delete permanently** (owner). Active boards
  stay in the main grid (already active-only after the backend filter).

### Archived board is not directly openable — DECIDED (backend audit fix)
- The backend now returns NOT_FOUND from `boards.get` / `boards.getData` for an
  archived board (it is only reachable via the project's archived-boards section +
  restore). So a deep link `/boards/:id` to an archived board, or a stale tab open
  on a board that was just archived, sees the existing board-not-found state.
- FE consequence: `BoardDetailPage`'s existing getData error/not-found branch
  already covers this — no new error UI, just confirm the not-found state renders
  (test below). After the owner archives from the header, navigate to the project
  (`/projects/:projectId`) BEFORE the getData query can refetch-404; do not leave
  the user on the now-404 board route.

### Restore-into-archived-parent UX — DECIDED
- The backend rejects restoring a card whose column/board is archived (and a
  column whose board is archived) with `BoardError.PARENT_ARCHIVED`. The FE maps
  this code via `boardErrorMessage` to "Restore the column/board first." and
  surfaces it inline in the archived-items drawer. The drawer groups archived
  cards under their `columnName` so the user can restore the column first.

## 1. Shared types
- [x] Consume from `shared` (built by the backend plan): `archivedAt` on `Board`,
  `Column`, `Card`; `archivedBoardItemsSchema` output. Prefer typing components
  from tRPC client outputs (`RouterOutputs["boards"]["archivedItems"]`) rather
  than importing schema-inferred types directly (matches the search/activity FE
  plans). No new shared code in this plan.

## 2. Feature helpers (`features/board`)
- [x] `features/board/errors.ts` — extend `boardErrorMessage` to map
  `BoardError.PARENT_ARCHIVED` → "Restore the parent first." (mirror existing
  error mapping).
- [x] `features/board/utils.ts` — no new perm helper needed; reuse `canEdit`
  (column/card archive+restore) and `isOwner` (board archive/restore + permanent
  delete) exactly as the existing gates use them.

## 3. Board header: Archive + Archived items (`BoardDetailPage.tsx`)
- [x] Replace the owner **Delete** button (`BoardDetailPage.tsx:354-363`) with an
  **Archive** button (owner-gated, `isOwner(board)`): opens a confirm modal
  (mirror `:501-535`) → `boards.archive.mutate({ id })`; on success invalidate
  `boards.list` (`:108`) and navigate to `/projects/${projectId}` IMMEDIATELY (do
  NOT invalidate/refetch `boards.getData` for this board first — it now 404s once
  archived; navigate away to avoid flashing the board-not-found state).
- [x] Add an **Archived items** button (editor-gated, `editable`) in the header
  button row that opens the archived-items drawer (new component below). Use a
  lucide `Archive` icon, styled like the existing header buttons (`:307-333`).
- [x] Add a separate owner-only **Delete permanently** path is NOT in the active
  board header — it lives only in the project's archived-boards section. (State
  this: an active board has no permanent-delete button; archive first.)

## 4. Archived items drawer (`features/board/components/ArchivedItemsPanel.tsx`)
- [x] New component. Props `{ boardId: string; editable: boolean }`. Query
  `trpc.boards.archivedItems.queryOptions({ id: boardId })`.
- [x] Render two sections: **Archived columns** and **Archived cards** (cards
  grouped under `columnName`). Each row: name/title + `Restore` +
  `Delete permanently` buttons.
- [x] `Restore` → `columns.restore` / `cards.restore` mutation; `onSettled`
  invalidate both `boards.getData` (so it reappears on the kanban) and
  `boards.archivedItems`. On `PARENT_ARCHIVED` error, render the mapped message
  inline next to the row.
- [x] `Delete permanently` → confirm dialog → `columns.delete` / `cards.delete`;
  `onSettled` invalidate `boards.archivedItems` (and `boards.getData` for safety).
- [x] States: loading spinner, empty ("No archived items"), error message
  (mirror `BoardActivityPanel.tsx` structure).
- [x] Mount inside `BoardDetailPage` in a `Modal` (editor-gated), alongside the
  existing History/Access/Labels modals (`BoardDetailPage.tsx:451-458`).

## 5. Column header: Archive (`Column.tsx`)
- [x] Replace the column `Trash2` delete (`Column.tsx:104-111`) with an **Archive**
  action (lucide `Archive` icon, `aria-label={`archive ${column.name}`}`). Add an
  `onArchive` prop to `Column` `Props` (`Column.tsx:10-17`); wire it in
  `BoardDetailPage` (`:402-410`) to `columns.archive.mutate({ id: column.id })`
  with `onSettled: invalidateData`. Drop the `onDelete` wiring from the active
  board (permanent delete now only in the drawer) OR keep `onDelete` unused —
  DECIDED: remove `onDelete` from the active column header to avoid two destructive
  buttons; permanent delete is drawer-only.

## 6. Card editor: Archive (`CardEditor.tsx` + `BoardDetailPage.tsx`)
- [x] Change the `CardEditor` destructive action label from "Delete" to "Archive"
  and rename the prop/handler accordingly (or keep `onDelete` name but point it at
  archive). Wire `BoardDetailPage`'s handler (`:482-493`) to
  `cards.archive.mutate({ id: activeCard.id })`; on success `invalidateData()`,
  `setActiveCardId(null)`, `clearCardParam()`. The card disappears from the kanban
  and shows in the archived-items drawer.
- [x] No permanent-delete button inside `CardEditor` on the active board (drawer
  only).

## 7. Project page: Archived boards section (`ProjectDetailPage.tsx`)
- [x] Below the active boards grid (`ProjectDetailPage.tsx:95`), add a collapsible
  **Archived boards** section fed by
  `trpc.boards.archived.queryOptions({ projectId: id })`. Hidden/empty-stated when
  there are none.
- [x] Each archived tile (reuse `BoardCard` visual or a lean variant) shows
  **Restore** (owner) → `boards.restore.mutate({ id })` and **Delete permanently**
  (owner) → confirm dialog → `boards.delete.mutate({ id })`. `onSettled`
  invalidate BOTH `boards.list` and `boards.archived`.
- [x] Gate Restore/Delete on `board.myPermission === "owner"` (the backend returns
  `myPermission` per archived board).

## 8. Tests (vitest, mock trpc — mirror existing `*.test.tsx`)
- [x] `BoardDetailPage.test.tsx` — header **Archive** (owner) calls
  `boards.archive` and navigates to the project; the active header has NO
  permanent-delete button; **Archived items** button (editor) opens the drawer;
  view-only sees neither archive controls; opening a board whose `getData` returns
  NOT_FOUND (archived board deep-link) renders the existing not-found state.
- [x] `ArchivedItemsPanel.test.tsx` — renders archived columns + cards (cards
  grouped by `columnName`); Restore calls the right mutation and invalidates
  getData; Delete permanently confirms then calls `columns.delete`/`cards.delete`;
  a `PARENT_ARCHIVED` restore error renders "Restore the parent first." inline;
  empty + loading + error states.
- [x] `Column.test.tsx` — column header shows **Archive** (not Delete) for editors;
  clicking calls `onArchive`; view-only hides it.
- [x] `CardEditor` / `BoardDetailPage` — the card destructive action is **Archive**
  and calls `cards.archive`, closing the editor.
- [x] `ProjectDetailPage.test.tsx` — archived-boards section renders archived
  boards; Restore calls `boards.restore` and invalidates both lists; Delete
  permanently (owner) confirms then calls `boards.delete`; non-owner sees neither.
- [x] error mapping: `boardErrorMessage` covers `PARENT_ARCHIVED`.

## 9. Verify
- [x] `pnpm --filter shared build` (types available to FE).
- [x] `pnpm --filter frontend test` green.
- [x] `pnpm --filter frontend build` (typecheck) clean.
- [x] manual: archive a card/column/board → each drops from the kanban/grid →
  appears in the archived view → restore brings it back → restore a card under an
  archived column shows the "restore parent first" message → permanent delete
  removes it for good. e2e runs only on dev/prod per `CLAUDE.md` (follow-up).
