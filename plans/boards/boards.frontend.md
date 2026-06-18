# Boards + Columns + Cards — Frontend Plan

Depends on the backend routers `boards`, `columns`, `cards` (typed via tRPC).
Mirror existing `features/project` + `pages/user/projects` patterns. Use
`useTRPC()` `queryOptions`/`mutationOptions` directly in components (no api
hooks). Kanban drag uses `@dnd-kit/core` (install).

## 1. Feature scaffold (`features/board`)

- [x] `features/board/types.ts` — re-export `Board`, `Column`, `Card`,
  `BoardData`, `MyPermission` from `shared`.
- [x] `features/board/utils.ts` — `canEdit`, `isOwner`, `PERMISSION_LABELS`
  (mirror `features/project/utils.ts`); `sortByPosition` helper.
- [x] `features/board/errors.ts` — `boardErrorMessage(code)` mapping
  `BoardError` to UI text (mirror project `errors.ts`).
- [x] install `@dnd-kit/core` (+ `@dnd-kit/sortable`, `@dnd-kit/utilities`).

## 2. Components (`features/board/components`)

- [x] `BoardCard.tsx` — board tile in the project's boards list (name, color,
  permission badge); links to `/projects/:id/boards/:boardId`.
- [x] `BoardFormFields.tsx` — name, description, color (reuse project form
  field patterns); used by create/edit.
- [x] `Column.tsx` — column header (name, edit/delete for editors) + droppable
  card list + "add card" affordance.
- [x] `CardTile.tsx` — draggable card (title); opens card editor.
- [x] `CardEditor.tsx` — modal/panel to edit title+description, delete.
- [x] `BoardAccessPanel.tsx` — board's own access mgmt (mirror project
  `AccessPanel.tsx`): list grants, grant by email+permission, revoke.

## 3. Pages (`pages/user/projects`)

- [x] `BoardsListPage.tsx` — `/projects/:id/boards`. Query
  `boards.list({projectId})`; grid of `BoardCard`; "New board" (editors only).
- [x] `BoardFormPage.tsx` — `/projects/:id/boards/new` and
  `.../boards/:boardId/edit`. `react-hook-form` + zod from shared; create/update
  mutations; on success navigate back.
- [x] `BoardDetailPage.tsx` — `/projects/:id/boards/:boardId`. Query
  `boards.getData`; render columns+cards kanban; add column; access panel
  (owner); delete board (owner); edit link.

## 4. Kanban interactions (BoardDetailPage)

- [x] DndContext wrapping columns; `@dnd-kit/sortable` for cards within and
  across columns.
- [x] on card drop -> `cards.move({id, toColumnId, beforeId/afterId})`;
  optimistic update of the cached `boards.getData`, rollback on error.
- [x] on column drop -> `columns.move(...)` with same optimistic pattern.
- [x] add column -> `columns.create`; rename/delete -> `columns.update/delete`.
- [x] add card -> `cards.create`; edit/delete via `CardEditor`.
- [x] gate all mutating UI behind `canEdit(myPermission)`; view-only is
  read-only (no drag handles, no add buttons).

## 5. Routing (`App.tsx`, inside `ProtectedRoute`)

- [x] `/projects/:id/boards` -> `BoardsListPage`
- [x] `/projects/:id/boards/new` -> `BoardFormPage`
- [x] `/projects/:id/boards/:boardId` -> `BoardDetailPage`
- [x] `/projects/:id/boards/:boardId/edit` -> `BoardFormPage`
- [x] replace the "Boards and cards coming soon" placeholder in
  `ProjectDetailPage` with a link/section into the boards list.

## 6. Tests (vitest, mock db/trpc — mirror existing `*.test.tsx`)

- [x] `BoardsListPage.test.tsx` — renders boards; "New board" hidden for
  view-only; empty state.
- [x] `BoardFormPage.test.tsx` — validation (name required/length); create and
  edit submit call the right mutation; error message rendered.
- [x] `BoardDetailPage.test.tsx` — renders columns+cards from `getData`;
  view-only hides add/drag controls; owner sees access panel + delete.
- [x] card move: simulate drag end -> asserts `cards.move` called with correct
  args + optimistic reorder; rollback on mutation error.
- [x] column move: simulate drag end -> asserts `columns.move` called.
- [x] add/edit/delete card and column call correct mutations.
- [x] `boards.routing.test.tsx` — each route renders the right page; unknown
  board id surfaces NOT_FOUND message.
- [x] error mapping: `boardErrorMessage` covers every `BoardError` code.

## 7. Verify
- [x] `pnpm --filter frontend test` green
- [x] `pnpm --filter frontend build` (typecheck) clean
- [ ] manual: create board -> add columns -> add cards -> drag reorder -> share
  board with another user (edit) -> confirm they can edit, view-only cannot.
