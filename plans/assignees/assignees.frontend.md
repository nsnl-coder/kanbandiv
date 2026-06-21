# Card Assignees / Members — Frontend Plan

Depends on backend `assignees` router (`listForCard`, `boardMembers`, `assign`,
`unassign`) + card payload `assignees: {id,email}[]`. Mirror `features/board`
patterns; `useTRPC()` `queryOptions` / `mutationOptions` directly (no API hooks).
Assignee filter + "my cards" toggle run client-side over `boards.getData`,
mirroring `LabelFilterBar` / `cardMatchesLabels`.

> DISPLAY NOTE (verified): `shared` `PublicUser` (`auth.schema.ts:90`) has NO
> `name` / `avatar` — only `id, email` (+ flags). Assignees come back as
> `{ id, email }`. Derive the display name from the email local-part and the
> initials from that, exactly like the comments feature does server-side
> (`email.split("@")[0]`). The avatar is a generated initials chip; key the
> deterministic color off the immutable `id` (NOT email, which could change). Do
> not reference a `name` or `avatar` field that does not exist.

## 1. Feature scaffold (`features/board`)
- [x] `types.ts` — re-export `Assignee` (`{id,email}`) from `shared` (mirror how
  other shared types are surfaced in `features/board/types.ts`).
- [x] `assigneeErrors.ts` — NOT `errors.ts`. Mirror `commentErrors.ts` /
  `labelErrors.ts` naming + shape: `assigneeErrorMessage(err: unknown): string`
  that narrows `TRPCClientError`, reads `err.message` (the backend sends the error
  CODE as the TRPC message), and maps every `AssigneeError` code (`FORBIDDEN`,
  `CARD_NOT_FOUND`, `BOARD_NOT_FOUND`, `USER_NOT_FOUND`, `NOT_BOARD_MEMBER`) to a
  friendly string, with a generic fallback. See `commentErrors.ts:13`.
- [x] `utils.ts` (ADD to the existing `features/board/utils.ts`, do not create a
  new file) —
  `assigneeDisplayName(email)` (local-part),
  `assigneeInitials(email)` (1-2 letters from local-part),
  `assigneeColor(id)` (deterministic palette pick from a hash of the user `id`),
  `cardAssignedToUser(card, userId)` (for the "my cards" filter; false when
  `userId` is empty),
  `cardMatchesAssignees(card, userIds[])` — OR-match using `.some` (an empty
  `userIds` returns true). NOTE: this is intentionally OR, UNLIKE
  `cardMatchesLabels` which is AND (`.every`, `utils.ts:62`). Do not copy
  `cardMatchesLabels`'s `.every`.

## 2. Components (`features/board/components`)
- [x] `AssigneeAvatar.tsx` — single initials chip from an `{id,email}`:
  background `assigneeColor(id)`, `aria-label` + `title` = `assigneeDisplayName`.
  Size variant (sm for `CardTile`, md for `CardEditor`).
- [x] `AssigneeStack.tsx` — overlapping row of `AssigneeAvatar` for a card's
  `assignees`; collapse to `+N` past a cap (e.g. 3 shown). Used on `CardTile`.
- [x] `AssigneePicker.tsx` — inside `CardEditor`: lists board members from a
  `useQuery(trpc.assignees.boardMembers.queryOptions({ boardId }))`, shows a
  checked state per member that is currently assigned (from `card.assignees`),
  toggles call `assignees.assign` / `assignees.unassign` (optimistic), gated
  behind `canEdit(board)` (`utils.ts:27`) — render read-only / hide the toggles
  when not editable. Each row shows `AssigneeAvatar` + `assigneeDisplayName`.
  Surface `NOT_BOARD_MEMBER` / `FORBIDDEN` via `assigneeErrorMessage` (the members
  list should already exclude non-members, so this is a safety net).
- [x] `AssigneeFilterBar.tsx` — board header control mirroring `LabelFilterBar`
  (`LabelFilterBar.tsx`): multi-select board members (from
  `trpc.assignees.boardMembers`) to filter visible cards + an "Assigned to me"
  toggle. The current user id comes from `useAuthStore((s) => s.user)?.id`
  (`BoardDetailPage.tsx:49` already uses this). Disable / hide the "Assigned to
  me" toggle when there is no current user id. Returns null when there are no
  board members (mirror `LabelFilterBar` returning null on empty).
- [x] `CardTile.tsx` — render `AssigneeStack` from `card.assignees` (additive,
  next to the existing label badges / counts row).
- [x] `CardEditor.tsx` — embed `AssigneePicker` (additive section), passing
  `boardId`, the card's current `assignees`, and `canEdit(board)`.

## 3. Board page wiring (`pages/user/projects/BoardDetailPage.tsx`)
- [x] add `AssigneeFilterBar` to the board header alongside `LabelFilterBar`
  (currently rendered at `BoardDetailPage.tsx:333`); keep selected assignee ids +
  the "assigned to me" boolean in `useState` (mirror `labelFilter` state, line 47).
- [x] filter columns' cards through `cardMatchesAssignees` (and
  `cardAssignedToUser` for the "my cards" toggle) before render, composed with the
  existing `cardMatchesLabels` filter (line 347) as AND across filter types.
- [x] assign/unassign optimistic update of the cached `boards.getData` (mutate the
  matching card's `assignees` array), rollback on error; mirror the label
  attach/detach optimistic pattern already in this page. On settle, invalidate
  `boards.getData` (and `assignees.listForCard` if used standalone in the editor).
- [x] use `currentUser?.id ?? ""` (from `useAuthStore`, line 49) for the
  "assigned to me" filter; do not refetch the session.

## 4. Tests (vitest, mock trpc — mirror `LabelPicker.test.tsx` /
`LabelFilterBar.test.tsx` / `CardTile.test.tsx`)
- [x] `AssigneePicker.test.tsx` — renders board members; toggling an unassigned
  member calls `assignees.assign` with `{cardId,userId}`; toggling an assigned
  member calls `assignees.unassign`; hidden / read-only when `canEdit` is false
  (view-only board).
- [x] `AssigneeStack` / `AssigneeAvatar` — renders one chip per assignee with
  correct initials; collapses to `+N` past the cap.
- [x] `AssigneeFilterBar` — selecting members filters visible cards (OR-match);
  "Assigned to me" shows only the current user's cards; the toggle is
  disabled/absent when there is no current user id; clear resets; composes (AND)
  with the label filter.
- [x] `assigneeDisplayName` / `assigneeInitials` derive correctly from the email
  local-part (incl. dotted local-parts, single-char) — add to
  `boardUtils.test.ts` (existing util test file).
- [x] `assigneeErrors.test.ts` — `assigneeErrorMessage` covers every
  `AssigneeError` code + the generic fallback (mirror `commentErrors.test.ts`).
- [x] optimistic assign rolls back on server error (e.g. `FORBIDDEN`).

## 5. Verify
- [x] `pnpm --filter shared build` first (FE needs the new `Assignee` /
  `AssigneeError` types)
- [x] `pnpm --filter frontend test` green
- [x] `pnpm --filter frontend build` clean
- [x] manual: assign members in the card editor, see avatars on the tile, filter
  by assignee + "assigned to me", confirm a newly-assigned user gets one email
  (Mailtrap), confirm view-only users cannot change assignees.
</content>
