# Card Assignees / Members — Backend Plan

Assign one or more **board members** to a card. The set of assignable users =
exactly what `comment.repo.listBoardMembers(db, boardId)` returns: **board owner +
project owner + `board_access` grantees + `project_access` grantees**. NOTE
(corrected): this set does NOT include anonymous public-project viewers (no DB row
exists to enumerate them) and does NOT include users who are superuser only by the
`is_superuser` flag without a grant. Those users can still *view* the board, but
they are intentionally NOT assignable, because an assignment must point at an
enumerable, notifiable user with an explicit relationship to the board.
Permission to USE the endpoints still resolves through the card chain
(`card.column_id -> column.board_id`) via `board.service.loadBoardFor`: board
`view` to read assignees, board `edit` to assign / unassign. On a NEW assignment
the assignee gets an email (reuse `features/email`, add `sendCardAssigned` in the
same style as `sendCommentMention` / `sendCardDueSoon`).

Mirror `features/comment` patterns most closely (board-member resolution +
email-on-event + card-chain permission): `*.router.ts` / `*.service.ts` /
`*.repo.ts` + `test/<endpoint>.spec.ts`, Kysely, tRPC `protectedProcedure`, Zod
schemas from `shared`, OpenAPI `.meta`, superjson.

> Reuse `loadBoardFor(db, user, id, min)` from `board.service.ts:95` (signature is
> `(db, user, id, min)` — NOT `boardId`; it throws `TRPCError` NOT_FOUND when
> `min==="view"` and perm too low, FORBIDDEN when `min==="edit"/"owner"` and perm
> too low). Map any NOT_FOUND from the board load to `CARD_NOT_FOUND` so a private
> board's existence does not leak (exactly like `comment.service.resolveCardBoard`).
> A FORBIDDEN from an edit-level shortfall must propagate as FORBIDDEN (do NOT
> remap it) — this is what makes view-only callers fail assign/unassign correctly.
> Reuse `comment.repo.listBoardMembers(db, boardId)` DIRECTLY (it already returns
> `{id, email}[]` deduped — see `comment.repo.ts:104`). Do NOT reimplement it in
> `assignee.repo`. Cross-feature repo import is already an accepted pattern
> (`card.enrich.ts:4` imports `commentRepo`).

> DISPLAY NOTE (verified): `shared` `PublicUser` (`auth.schema.ts:90`) has
> `id, email, isSuperuser, roleId?, emailVerified, permissions` — there is NO
> `name` and NO `avatar`. The comments feature derives a handle from the email
> local-part (`comment.service.nameFromEmail = email.split("@")[0]`,
> `comment.service.ts:42`). Assignees follow the same convention: the API returns
> `{ id, email }` per assignee and the FE derives a display name + initials from
> the email local-part (avatar is a generated initials chip, not a stored image).
> Do NOT invent a `name`/`avatar` field that the user table does not have.

## Board-access-revoke decision (DECIDED)

Revoking a user's board access (`boards.accessRevoke`) MUST also unassign that
user from every card on that board. Rationale: an assignee who can no longer
view the board is a dangling reference — their initials would render with no way
to open or be notified about the card, and re-granting would silently restore a
stale assignment. The DB cascade only fires on user/card row deletion, NOT on a
`board_access` row deletion (there is no FK from `card_assignees` to
`board_access`), so this must be done explicitly in
`board.service.revokeBoardAccess`. That function loads the board at `"owner"` min
(`board.service.ts:280`), so the cleanup cannot be reached or bypassed by a
non-owner. Scope of the cleanup = all cards under the board
(`card.column_id -> column.board_id == boardId`). Owners (board owner / project
owner) are never in `board_access`, so revoke never touches them. This is a HARD
delete: a later re-grant starts with NO assignments (there is no soft-delete /
restore path — verified). No email is sent on unassign (mirrors the "email only
on NEW assignment" rule).

## API endpoints
- [x] `GET /cards/{cardId}/assignees` — list a card's assignees `[{id,email}]` (board `view`)
- [x] `GET /boards/{boardId}/members` — list assignable board members `[{id,email}]` for the picker (board `view`)
- [x] `PUT /cards/{cardId}/assignees/{userId}` — assign a board member to the card; idempotent; email on NEW assignment only (board `edit`)
- [x] `DELETE /cards/{cardId}/assignees/{userId}` — unassign a member from the card; idempotent (board `edit`)

## 1. Database (migration + db types)
- [x] `migrations/014.assignee.ts` (next free number is 014; highest existing is
  013.attachment) — mirror `012.comment.ts` / `013.attachment.ts` style (`sql`
  import; no `gen_random_uuid` needed — this is a pure join table). Create
  `card_assignees`: `card_id uuid notnull references cards.id on delete cascade`,
  `user_id uuid notnull references users.id on delete cascade`,
  `assigned_at timestamptz notnull default now()`, primary key
  `(card_id, user_id)` via `addPrimaryKeyConstraint` (mirror
  `comment_mentions_pkey`). Add index `card_assignees_user_idx` on `user_id` (for
  the "my cards" / filter-by-assignee query and for revoke cleanup). `down`
  drops the table `.ifExists()`.
- [x] `db/types.ts` — add `CardAssigneesTable`: `card_id: string`,
  `user_id: string`, `assigned_at: GeneratedTimestamp`. Register
  `card_assignees: CardAssigneesTable` in the `Database` interface. (Confirm the
  exact `Generated*` timestamp alias used by sibling tables in `db/types.ts`.)
- [x] migration spec `migrations/014.assignee.spec.ts` (LIVES IN
  `src/migrations/`, NOT in `features/.../test/` — mirror
  `migrations/013.attachment.spec.ts`): pg-mem + register `gen_random_uuid`, run
  the prior `up`s needed for the FK chain (`up001` auth, `up003` project, `up004`
  board, `up005` column, `up006` card), then `up` (014). Assert: up creates the
  table + `user_id` index; inserting a row works; the composite PK rejects a
  duplicate `(card_id, user_id)`; deleting the parent card cascades its assignee
  rows; deleting the user cascades its rows; `down` drops the table.

## 2. Shared schemas + errors (`packages/shared`)
- [x] `src/assignee.schema.ts`:
  - inputs `listAssigneesInput` (`{ cardId: z.string() }`),
    `listBoardMembersInput` (`{ boardId: z.string() }`),
    `assignInput` (`{ cardId: z.string(), userId: z.string() }`),
    `unassignInput` (`{ cardId: z.string(), userId: z.string() }`).
  - output `assigneeSchema` = `{ id: z.string(), email: z.string() }` (the
    minimal public shape; FE derives name/initials from `email`). Reused for
    both the card-assignee list and the board-members list.
- [x] `src/card.schema.ts` — extend `cardSchema` (`card.schema.ts:46`) with
  `assignees: z.array(assigneeSchema)` (placed alongside `labels`, `commentCount`,
  `attachmentCount`). `cardSchema` is the single card shape that `boardDataSchema`
  reuses, so the kanban payload picks this up automatically. Import
  `assigneeSchema` into `card.schema.ts`.
- [x] `src/errors/assignee.error.ts` — `AssigneeError` const object (mirror
  `errors/comment.error.ts` `as const` + type export): `FORBIDDEN`,
  `CARD_NOT_FOUND`, `BOARD_NOT_FOUND`, `USER_NOT_FOUND` (target user does not
  exist), `NOT_BOARD_MEMBER` (target exists but has no enumerable board membership
  -> cannot be assigned).
- [x] `src/index.ts` — add `export * from "./assignee.schema.js";` and
  `export * from "./errors/assignee.error.js";` (the barrel exports each file
  explicitly; it does NOT auto-discover — see `index.ts:1-23`).
- [x] `pnpm --filter shared build` so backend + frontend pick up the new types.

## 3. Assignee feature (`features/assignee`)
- [x] `assignee.repo.ts`:
  - `findByCardUser(db, cardId, userId)` — returns the row or undefined (used to
    decide NEW vs re-assign for the email).
  - `assign(db, cardId, userId)` — `insertInto("card_assignees")
    .values({ card_id, user_id }).onConflict((oc) =>
    oc.columns(["card_id","user_id"]).doNothing()).execute()` (idempotent at the
    DB layer; combined with `findByCardUser` to know if it was actually new).
    Mirror `comment.repo.insertMentions` onConflict style (`comment.repo.ts:84`).
  - `unassign(db, cardId, userId)` — delete by both keys; idempotent (deleting a
    non-existent row is a no-op).
  - `listByCard(db, cardId)` — join `card_assignees` -> `users`, select
    `users.id`, `users.email`, ordered by `users.email asc`.
  - `listForCards(db, cardIds[]) -> Map<cardId, {id,email}[]>` — BATCH for
    `enrichCards` (no N+1): empty-input guard returning an empty Map; ONE query
    `where card_id in (...)` joined to `users`; group in JS. Mirror
    `comment.repo.countByCards` empty-guard style (`comment.repo.ts:142`).
  - `unassignAllForBoard(db, boardId, userId)` — delete every `card_assignees`
    row for `userId` whose `card_id` belongs to the board (`card_id in (select
    cards.id from cards join columns on columns.id = cards.column_id where
    columns.board_id = boardId)`). Used by the board-access-revoke cleanup.
  - DO NOT add a `listBoardMembers` here — reuse `commentRepo.listBoardMembers`.
- [x] `assignee.service.ts` (functions take `db`, `user`, and `email: EmailPort`
  where notifications are sent; mirror `comment.service.createComment`'s
  `(db, user, email, input)` shape):
  - `resolveCardBoard(db, user, cardId, min)` — copy
    `comment.service.resolveCardBoard` (`comment.service.ts:50`): `findCardById`
    -> `findColumnById` -> `loadBoardFor(db, user, column.board_id, min)`; catch a
    board `TRPCError` with `code==="NOT_FOUND"` and rethrow as `CARD_NOT_FOUND`
    (no existence leak); let a FORBIDDEN (edit shortfall) propagate unchanged.
    Returns `{ boardId, perm }`.
  - `listAssignees(db, user, { cardId })` — `resolveCardBoard(..., "view")`;
    return `repo.listByCard` mapped to `assigneeSchema`.
  - `listBoardMembers(db, user, { boardId })` — `loadBoardFor(db, user, boardId,
    "view")` inside a try/catch that maps board NOT_FOUND -> `BOARD_NOT_FOUND` (for
    a clear picker error); return `commentRepo.listBoardMembers(db, boardId)`
    mapped to `assigneeSchema`.
  - `assign(db, user, email, { cardId, userId })` — `resolveCardBoard(..., "edit")`
    to get `boardId`; VALIDATE the target in ONE step: fetch
    `commentRepo.listBoardMembers(db, boardId)`; if `userId` is not in that list,
    distinguish the two errors — if the user exists in `users` but is not a member
    -> `NOT_BOARD_MEMBER`; if the user does not exist at all -> `USER_NOT_FOUND`.
    (One extra `selectFrom("users").where id` lookup decides which.) If the user
    IS a member: determine NEW vs existing via `repo.findByCardUser`: if a row
    already exists -> idempotent no-op, DO NOT send email, return current
    assignees. If new -> `repo.assign`, then send the email (see below), return
    current assignees (`repo.listByCard` mapped).
  - email-on-NEW only: after a genuinely new insert, fetch the card title via an
    inline `db.selectFrom("cards").select(["title"]).where("id","=",cardId)
    .executeTakeFirst()` (matching `comment.service.ts:191`, NOT a repo helper),
    build the link `${env.APP_BASE_URL}/boards/${boardId}?card=${cardId}` (mirror
    `comment.service.cardLink`), and look up the target email from the
    members list already fetched. Call `email.sendCardAssigned(target.email,
    cardTitle, link)`. Never email when the assignment already existed. SKIP the
    email when `target.id === user.id` (self-assignment), matching comment-mention's
    "never email the author" spirit. State this in the test.
  - `unassign(db, user, { cardId, userId })` — `resolveCardBoard(..., "edit")`;
    `repo.unassign` (idempotent; unassigning a non-assignee is a successful
    no-op); return current assignees. No email.
- [x] `assignee.router.ts` — tRPC `assigneesRouter`. Mirror `comment.router.ts`'s
  `user(ctx)` helper and `.meta` openapi shape. The email is taken from CONTEXT
  (`ctx.email`), NOT imported from `email.service` — this is what makes it
  mockable (see `comment.router.ts:32`).
  - `listForCard` — `protectedProcedure`, `.meta` openapi GET
    `/cards/{cardId}/assignees`, input `listAssigneesInput`, output
    `z.array(assigneeSchema)`, `.query` calls
    `listAssignees(ctx.db, user(ctx), input)`.
  - `boardMembers` — `protectedProcedure`, `.meta` openapi GET
    `/boards/{boardId}/members`, input `listBoardMembersInput`, output
    `z.array(assigneeSchema)`, `.query` calls
    `listBoardMembers(ctx.db, user(ctx), input)`.
  - `assign` — `protectedProcedure`, `.meta` openapi PUT
    `/cards/{cardId}/assignees/{userId}`, input `assignInput`, output
    `z.array(assigneeSchema)`, `.mutation` calls
    `assign(ctx.db, user(ctx), ctx.email, input)`.
  - `unassign` — `protectedProcedure`, `.meta` openapi DELETE
    `/cards/{cardId}/assignees/{userId}`, input `unassignInput`, output
    `z.array(assigneeSchema)`, `.mutation` calls
    `unassign(ctx.db, user(ctx), input)`.
  - Register `assignees: assigneesRouter` in `trpc/router.ts` (add the import +
    the line in `appRouter`).
- [x] `features/email/email.service.ts` — add `sendCardAssigned(to, cardTitle,
  link)` to BOTH the `EmailPort` interface AND the `createEmailService` return,
  reusing `noticeTemplate("You were assigned to a card", `You were assigned to
  "${cardTitle}".`, link)` and subject ``You were assigned: ${cardTitle}``.
  Mirror `sendCommentMention` / `sendCardDueSoon` exactly. (`esc` is applied
  inside `noticeTemplate`.)
- [x] `features/card/card.enrich.ts` — add
  `const assigneesByCard = await assigneeRepo.listForCards(db, ids)` next to the
  existing label/count batch calls, and include
  `assignees: assigneesByCard.get(r.id) ?? []` in the mapped `Card`. Used
  automatically by `boards.getData` (which calls `enrichCards`). MUST be one
  batched query — no per-card lookup.
- [x] `features/board/board.service.ts` `revokeBoardAccess` — after
  `repo.deleteBoardAccess(db, id, input.userId)` (line 281), call
  `assigneeRepo.unassignAllForBoard(db, id, input.userId)` so the revoked user is
  unassigned from every card on the board (see decision above). No email.

## 3b. Test-harness wiring (REQUIRED — do not skip)
- [x] `features/auth/test/helpers.ts` — `newTestDb` hardcodes `up001..up013`
  (lines 10-53). Import `up as up014` from `../../../migrations/014.assignee.js`
  and call `await up014(db)` after `up013`. WITHOUT this the test DB has no
  `card_assignees` table and every assignee test fails.
- [x] `features/auth/test/helpers.ts` — `EmailPort` is an interface, so adding
  `sendCardAssigned` makes `fakeEmail()` (line 71) and the `SentEmail` union
  (line 56) fail to compile. Add `"assigned"` to the `SentEmail.type` union and
  add a `sendCardAssigned: async (to, cardTitle, link) => { sent.push({ type:
  "assigned", to, cardTitle, link }); }` entry to `fakeEmail()`.

## 4. Tests (pg-mem, mirror `features/comment/test`)
Use the shared `fakeEmail()` injected via `makeContext({ db, userId, email })`
(see `comment.spec.ts:130-140`). Reuse `seedBoard`/`seedBoardAccess`/`seedColumn`/
`seedCard`/`seedUser`/`seedUserCaller`/`authedCaller` from `board/test/helpers`.

### assign (happy + idempotent + email-once)
- [x] editor assigns a board member -> row inserted, assignee appears in the
  returned list AND in the card payload (getData);
  `email.sent.filter(e => e.type === "assigned")` has length 1 with the assignee's
  email + card link.
- [x] re-assigning the SAME user (assign twice) -> idempotent: still one row, no
  error; `assigned` email sent only on the FIRST call, NOT the second.
- [x] self-assignment (assigner == target) -> assigned, but NO email sent.
- [x] assigning a user reachable via project-level access (`project_access` grant,
  no board_access row) succeeds (they ARE in `listBoardMembers`).

### assign (errors)
- [x] view-only member tries to assign -> FORBIDDEN (board `edit` required).
- [x] assign on a card whose board the caller cannot view -> CARD_NOT_FOUND
  (no existence leak), no row, no email.
- [x] assign a non-existent userId -> USER_NOT_FOUND, no row, no email.
- [x] assign a real user who has NO grant/ownership on the board ->
  NOT_BOARD_MEMBER, no row, no email.
- [x] a public-project viewer with NO explicit grant is NOT assignable ->
  NOT_BOARD_MEMBER (documents the corrected assignable-set definition).

### list
- [x] `listForCard` returns assignees ordered by email; board not viewable ->
  CARD_NOT_FOUND.
- [x] `boardMembers` returns the full assignable set (board owner + project owner
  + board_access + project_access, deduped); board not viewable -> BOARD_NOT_FOUND.

### unassign
- [x] editor unassigns an existing assignee -> row gone, returned list no longer
  contains them; no email.
- [x] unassigning a user who is NOT assigned -> idempotent success (no error,
  no email).
- [x] view-only member tries to unassign -> FORBIDDEN.
- [x] unassign on an inaccessible board -> CARD_NOT_FOUND.

### enrichment / no N+1
- [x] getData returns each card's `assignees` array correctly populated.
- [x] seed N cards with assignees, `vi.spyOn(assigneeRepo, "listForCards")`, call
  `getData`, assert `toHaveBeenCalledTimes(1)` — no per-card N+1 (mirror
  `attachment/test/enrich.spec.ts:52-57`).

### cascade
- [x] deleting a card removes its `card_assignees` rows (DB cascade) — covered in
  the migration spec and a service-level delete test (`deleteCard`).
- [x] deleting a user removes their `card_assignees` rows (DB cascade).
- [x] REVOKE cascade: `boards.accessRevoke` for a user assigned to cards on that
  board removes ALL their `card_assignees` rows on that board (and ONLY that board
  — assignments on other boards are untouched); no email sent.
- [x] RE-GRANT does NOT restore: after revoke + re-grant, the user has NO
  assignments (hard delete, no restore path).

### migration
- [x] `migrations/014.assignee.spec.ts`: up creates table + `user_id` index;
  duplicate `(card_id, user_id)` rejected by PK; card-cascade; user-cascade;
  down drops.

## 5. Verify
- [x] `pnpm --filter shared build`
- [x] `pnpm --filter backend test` green (email mocked via `fakeEmail`)
- [x] `pnpm --filter backend migrate` auto-discovers `014.assignee` (the live
  runner globs `migrations/` — `scripts/migrate.script.ts:13`; verified via the
  pg-mem migration spec; live Postgres not run locally).
- [x] Swagger shows the new `/cards/{cardId}/assignees`,
  `/boards/{boardId}/members` routes.
</content>
