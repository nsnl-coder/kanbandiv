# Board Archiving (soft-delete + restore) — Backend Plan

Soft-delete + restore for **cards, columns, and boards**. A single nullable
`archived_at timestamptz` per row is the whole model: `archived_at IS NULL` =
active; archiving stamps `now()`; restore clears it back to `null`. Hard delete
(the existing DELETE endpoints) is KEPT as "permanent delete" and cascades.

Archived items disappear from every normal list/read view but are retained and
listable via per-board "archived items" reads and a per-project "archived boards"
read, so they can be restored or permanently deleted.

Mirror existing `features/board` / `features/column` / `features/card` patterns:
`*.router.ts` / `*.service.ts` / `*.repo.ts` + `test/<endpoint>.spec.ts`, Kysely,
tRPC `protectedProcedure`, Zod from `shared`, OpenAPI `.meta`, superjson. Reuse
`board.service.loadBoardFor` (`board.service.ts:102`) for permission resolution.

## Key decisions (decided)

### Cascade = FILTER-BY-PARENT, not cascade-stamp — DECIDED
- Archiving a column does **NOT** stamp its cards; archiving a board does **NOT**
  stamp its columns/cards. Only the row the user acted on gets `archived_at` set.
- Hiding cascades at **read time**: a card is hidden from the kanban when its OWN
  `archived_at` is set OR its column's `archived_at` is set OR its board's
  `archived_at` is set. A column is hidden when its own OR its board's
  `archived_at` is set.
- Rationale:
  - **Reversible cleanly.** Restoring a column with cascade-stamp would have to
    guess which cards were archived BY the cascade vs already archived
    individually — impossible without a marker column. Filter-by-parent restores a
    column and its still-active cards reappear automatically; cards the user had
    individually archived stay archived. This is the correct Trello semantics.
  - **No write amplification / no partial-failure window.** Archiving a board is
    one UPDATE, not a sweep over every descendant (which `card.service` does NOT
    wrap in a transaction today — see `activity.backend.md` "after-commit" note).
  - **One source of truth** per row; no drift between a parent flag and child
    flags.
- Cost: every card/column read path gains a JOIN-up filter (`columns.archived_at
  is null AND boards.archived_at is null`). The card read paths ALREADY join
  `columns` (`board.repo.listCardsForBoard` `board.repo.ts:75-95`,
  `card.repo.listDueCards` `card.repo.ts:73-85`) so the extra predicate is free;
  paths that do not join up get the parent flag added (enumerated below).

### Restore-into-archived-parent rule — DECIDED
- **Restoring a card** is allowed only when its parent column AND board are
  ACTIVE. If the parent column (or board) is archived, restoring the card alone
  would leave it invisible (still filtered out by the parent), confusing the user.
  - Behavior: `card.restore` resolves the card's column + board; if either parent
    is archived, throw `BAD_REQUEST` with `BoardError.PARENT_ARCHIVED`. The FE
    surfaces "Restore the column/board first." (The archived-items view groups by
    column so the user can restore the column, which auto-reveals its active
    cards, then restore individual cards as needed.)
  - We do NOT auto-restore the parent (silent side effects on a parent the user
    did not ask to restore are surprising and a permission-scope risk).
- **Restoring a column** is allowed only when its parent board is ACTIVE; else
  `BAD_REQUEST` `BoardError.PARENT_ARCHIVED` ("Restore the board first.").
- **Restoring a board** has no parent constraint (project is not archivable in
  this feature) — always allowed for an owner.

### Permission rules (mirror existing delete) — DECIDED
- Archive/restore/list-archived a **card or column** = board `edit` (same as the
  existing card/column mutations and `loadCardFor(..., "edit")` /
  `loadColumnFor(..., "edit")`).
- Archive/restore a **board**, **permanent-delete** a board, and **list archived
  boards** management actions = board `owner` (mirrors
  `board.service.deleteBoard` `board.service.ts:227` which loads at `"owner"`).
- **List archived items per board** (cards+columns) = board `edit` (an editor who
  can archive can see what they archived). **List archived boards in a project**
  = any caller who can view the board would-be: filter the project's boards to
  archived ones the caller can resolve a permission for (same visibility loop as
  `listBoards` `board.service.ts:128`); show `Restore`/`Delete permanently`
  affordances only for boards where `myPermission === "owner"`.
- Permanent delete = the EXISTING hard-delete endpoints
  (`boards.delete`/`columns.delete`/`cards.delete`), unchanged, cascade as today.

### Interaction with existing hard-delete endpoints — DECIDED
- KEEP `boards.delete`, `columns.delete`, `cards.delete` exactly as-is — they
  remain "permanent delete (cascade)".
- ADD new archive/restore endpoints alongside. The primary destructive UI action
  becomes **Archive**; **Delete permanently** is exposed only inside the archived
  views (see frontend plan). No backend endpoint is removed or renamed.

### Activity events — ADDED (decided: yes)
- Add 6 new `ActivityType` values:
  `CARD_ARCHIVED`, `CARD_RESTORED`, `COLUMN_ARCHIVED`, `COLUMN_RESTORED`,
  `BOARD_ARCHIVED`, `BOARD_RESTORED` (taxonomy grows from 22 → 28). Card-scoped
  events carry `cardId` + `meta.cardTitle`; column/board events are board-scoped
  (`cardId: null`) and carry `meta.columnName` / `meta.boardName`. The recorder is
  best-effort after-commit, exactly as in `activity.backend.md`.
- A `BOARD_ARCHIVED` row survives on the (still-present) board; permanent delete
  cascades its activity away as today (`activities.board_id ON DELETE CASCADE`).

### Empty / not-found semantics
- Archive/restore on a row that does not exist or whose board the caller cannot
  view → NOT_FOUND (no existence leak), reusing the existing `loadCardFor` /
  `loadColumnFor` / `loadBoardFor` NOT_FOUND mapping.
- Archiving an already-archived row (or restoring an already-active row) is an
  idempotent no-op that returns the current row (do NOT throw) — simpler for the
  FE and avoids races on double-click. The no-op path records NO activity (only a
  real state transition emits an event).

### Reading an ARCHIVED board through a normal read endpoint — DECIDED (audit fix)
- **CRITICAL.** `getBoard` (`boards.get`) and `getBoardData` (`boards.getData`)
  call `loadBoardFor(..., "view")`, which resolves an ARCHIVED board (because
  `findBoardById` is intentionally unfiltered). Without a guard, a caller who
  knows/keeps a board id can still open an archived board (and `getBoardData`
  returns it with an empty column list once `listColumnsForBoard` is filtered) —
  a leak + a confusing "ghost board" UX.
- Behavior: `getBoard` and `getBoardData` throw NOT_FOUND
  (`BoardError.BOARD_NOT_FOUND`) when `row.archived_at != null`. The board is only
  reachable via the archived-boards management list (`boards.archived`) and its
  restore endpoint. Archive/restore/list-archived endpoints keep using
  `loadBoardFor` and read the archived row fine (they do not call `getBoard`).
- There is NO `cards.get` / `columns.get` read endpoint (cards/columns are only
  ever returned nested inside `getBoardData`, which is now archive-guarded and
  parent-filtered), so the board guard is the only single-entity read that needs
  this check. `card.service.loadCardFor` / `column.service.loadColumnFor` stay
  unfiltered so archive/restore can operate on archived rows.

## API endpoints

tRPC procedure → OpenAPI method + path. All `protectedProcedure`. NEW endpoints
only; existing DELETE endpoints are unchanged (permanent delete).

### boards (`/boards`)
- [x] `POST /boards/{id}/archive` — archive a board (set `archived_at`); board `owner`; records `BOARD_ARCHIVED`
- [x] `POST /boards/{id}/restore` — restore a board (clear `archived_at`); board `owner`; records `BOARD_RESTORED`
- [x] `GET /boards/archived?projectId=` — list archived boards in a project the caller can access; board `owner` affordances per row

### columns (`/columns`)
- [x] `POST /columns/{id}/archive` — archive a column; board `edit`; records `COLUMN_ARCHIVED`
- [x] `POST /columns/{id}/restore` — restore a column (rejects if board archived); board `edit`; records `COLUMN_RESTORED`

### cards (`/cards`)
- [x] `POST /cards/{id}/archive` — archive a card; board `edit`; records `CARD_ARCHIVED`
- [x] `POST /cards/{id}/restore` — restore a card (rejects if column/board archived); board `edit`; records `CARD_RESTORED`

### archived items per board (`/boards/{id}/archived`)
- [x] `GET /boards/{id}/archived` — list archived columns + archived cards under a board (for the "Archived items" view); board `edit`

> Existing (UNCHANGED) permanent-delete endpoints kept: `DELETE /boards/{id}`,
> `DELETE /columns/{id}`, `DELETE /cards/{id}`.

## 0. Read paths to filter — AUDIT (every query that must exclude archived rows)

Each line is an explicit task. Missing one = archived data leaks back into the UI.
"add `archived_at is null`" means the row's own flag; "add parent filter" means
the joined-up column/board flag (filter-by-parent cascade).

### board.repo.ts
- [x] `listBoardsForProject` (`board.repo.ts:38-45`) — add `.where("archived_at","is",null)`.
  Used by `board.service.listBoards` (`board.service.ts:128`) → `boards.list`
  (the project's board grid). Active boards only.
- [x] `listColumnsForBoard` (`board.repo.ts:66-73`) — add `.where("archived_at","is",null)`.
  Used by `getBoardData` (`board.service.ts:148`) → the kanban. (Board itself is
  already proven active because `getBoardData` loads the board; but cards must
  still be parent-filtered — next line.)
- [x] `listCardsForBoard` (`board.repo.ts:75-95`) — already joins `columns`. Add
  `.where("cards.archived_at","is",null)` AND `.where("columns.archived_at","is",null)`.
  (Board is the loaded active board, so no board predicate needed here, but cards
  under an archived column must NOT appear.) Used by `getBoardData`.
- [x] `findBoardById` (`board.repo.ts:30-36`) — **do NOT filter.** It backs
  `loadBoardFor`, which must still resolve an ARCHIVED board so archive/restore
  and the archived-boards list can operate on it. Archived-ness is enforced at the
  service layer per operation, not in this lookup.

### board.service.ts
- [x] `getBoard` (`board.service.ts:119-126`) — **AUDIT FIX (leak):** after
  `loadBoardFor(..., "view")`, if `row.archived_at != null` throw NOT_FOUND
  (`BoardError.BOARD_NOT_FOUND`). An archived board must not open through the normal
  read path; it is reachable only via `boards.archived` + restore.
- [x] `getBoardData` (`board.service.ts:142-168`) — **AUDIT FIX (leak):** same guard
  as `getBoard` — after `loadBoardFor`, if `row.archived_at != null` throw NOT_FOUND.
  Then relies on the two repo filters above (columns+cards filtered). (Without the
  guard, an archived board would render as an empty-column ghost board.)
- [x] `listBoards` (`board.service.ts:128-140`) — relies on `listBoardsForProject`
  now returning active-only; add a sibling `listArchivedBoards` (see §4) using a
  new repo `listArchivedBoardsForProject`.

### column.repo.ts
- [x] `listByBoard` (`column.repo.ts:29-36`) — add `.where("archived_at","is",null)`.
  Used by `column.service.moveColumn` siblings (`column.service.ts:117`) and any
  ordered list; an archived column must not be a reorder neighbour nor counted.
- [x] `maxPosition` (`column.repo.ts:60-67`) — add `.where("archived_at","is",null)`.
  New columns append after the max ACTIVE position (an archived column's stale
  position should not push new columns out).
- [x] `findColumnById` (`column.repo.ts:21-27`) — **do NOT filter** (same reason
  as `findBoardById`: archive/restore must resolve an archived column).

### card.repo.ts
- [x] `listByColumn` (`card.repo.ts:43-50`) — add `.where("archived_at","is",null)`.
  Used by `card.service.moveCard` target siblings (`card.service.ts:299`) and
  position computation; archived cards must not be reorder neighbours.
- [x] `maxPosition` (`card.repo.ts:125-132`) — add `.where("archived_at","is",null)`.
  New cards append after the max ACTIVE position.
- [x] `listDueCards` (`card.repo.ts:73-85`) — already joins `columns`. Add
  `.innerJoin("boards","boards.id","columns.board_id")` then
  `.where("cards.archived_at","is",null)`, `.where("columns.archived_at","is",null)`,
  AND `.where("boards.archived_at","is",null)`. Backs `cards.due`
  (`card.service.listDueCards` `card.service.ts:241`) — archived cards/columns/boards
  must not show in due lists. **AUDIT FIX:** the board predicate is REQUIRED, not
  optional. `card.service.listDueCards` (`card.service.ts:247`) only calls
  `enforceBoard(..., "view")` which does NOT reject an archived board (it goes
  through unfiltered `loadBoardFor`); so without the boards join, an archived board
  whose columns are still active would leak its due cards. (Select stays
  `.selectAll("cards")`.)
- [x] `findDueForReminder` (`card.repo.ts:88-97`) — **CRITICAL (reminders).** Add
  `.where("archived_at","is",null)` on the card, and join up to exclude archived
  columns/boards: add `.innerJoin("columns","columns.id","cards.column_id")
  .innerJoin("boards","boards.id","columns.board_id")
  .where("columns.archived_at","is",null).where("boards.archived_at","is",null)`
  (select `cards.*` via `.selectAll("cards")`). Backs `card.reminder.runDueReminders`
  (`card.reminder.ts:26`) — an archived card/column/board must NOT email members.
- [x] `findCardById` (`card.repo.ts:27-33`) — **do NOT filter** (archive/restore +
  enrichment of a single archived card must resolve it).

### card.enrich.ts
- [x] `enrichCards` (`card.enrich.ts:28`) — takes an explicit `rows: CardRow[]`
  array and batches by `ids`. It does NOT independently re-query cards, so once the
  CALLERS pass only active rows (via the filtered list repos above) enrichment is
  clean. **No change needed in enrich itself**, BUT note: the label/comment/
  assignee/attachment/checklist `*ForCards(db, ids)` count/list helpers
  (`card.enrich.ts:35-65`) are keyed off the passed `ids` only — they never widen
  the set, so counts/labels/assignees are automatically scoped to the active cards
  handed in. Add a TEST asserting an archived card is absent from `getBoardData`
  and therefore contributes nothing to any count/enrichment. (No repo edit.)

### card.reminder.ts
- [x] `runDueReminders` (`card.reminder.ts:21-48`) — relies on the
  `findDueForReminder` fix above; no other change. Add a TEST: an archived card
  due now sends NO email; archiving its column/board likewise suppresses.

### search.repo.ts (search.repo.ts MUST NOT return archived cards)
- [x] `buildSearchQuery` (`search.repo.ts:40-152`) — already innerJoins
  `cards→columns→boards→projects` (`search.repo.ts:46-49`). Add three predicates
  (active by default): `.where("cards.archived_at","is",null)`,
  `.where("columns.archived_at","is",null)`, `.where("boards.archived_at","is",null)`.
  Apply UNCONDITIONALLY (search never surfaces archived cards). Place them with the
  filter block (`search.repo.ts:102-142`) so they AND with visibility + text.
  Backs `search.service.searchCards` → `GET /search/cards`.

### activity feed scope
- [x] Activity reads (`activity.repo.listByCard` / `listByBoard`) — **do NOT
  filter by archive.** History of an archived card/board is still valid audit data
  and the archived-items view / a restored board should show its full history.
  Archiving a card does NOT remove its activity; permanent delete cascades it
  (board) or SET NULLs it (card) exactly as today. No change. (State this decision
  so a reviewer does not "helpfully" add a filter.)

### assignee / label / comment counts
- [x] Covered transitively by enrich (above): all `*ForCards(db, ids)` helpers are
  keyed on the active `ids` passed from filtered list paths, so no archived card
  ever enters the id set. The per-card direct reads (e.g. opening a single archived
  card via `findCardById`) intentionally still resolve. No repo edit; add the
  no-leak test in §6.

## 1. Database (migration + db types)

- [x] `migrations/018.archiving.ts` (next free number is 018; highest existing is
  `017.card-search`). Use the `sql` import like `016.activity.ts:1`. Adds ONE
  nullable column to each of three tables, plus partial indexes for the
  active-row reads:
  ```ts
  import { type Kysely, sql } from "kysely";

  export async function up(db: Kysely<any>): Promise<void> {
    for (const t of ["boards", "columns", "cards"] as const) {
      await db.schema
        .alterTable(t)
        .addColumn("archived_at", "timestamptz")  // nullable = active
        .execute();
    }
    // Partial indexes accelerate the "active rows" reads (the hot path).
    // Use the Kysely builder .where(sql.ref(...), "is", null) form — this is the
    // form already proven to boot under pg-mem (010.card-due-date.ts:11-16 runs in
    // newTestDb). A raw .where(sql`archived_at is null`) is NOT verified on pg-mem.
    await db.schema.createIndex("boards_active_idx").on("boards")
      .columns(["project_id"]).where(sql.ref("archived_at"), "is", null).execute();
    await db.schema.createIndex("columns_active_idx").on("columns")
      .columns(["board_id"]).where(sql.ref("archived_at"), "is", null).execute();
    await db.schema.createIndex("cards_active_idx").on("cards")
      .columns(["column_id"]).where(sql.ref("archived_at"), "is", null).execute();
  }
  export async function down(db: Kysely<any>): Promise<void> {
    for (const i of ["boards_active_idx","columns_active_idx","cards_active_idx"])
      await db.schema.dropIndex(i).ifExists().execute();
    for (const t of ["boards","columns","cards"] as const)
      await db.schema.alterTable(t).dropColumn("archived_at").execute();
  }
  ```
  - **pg-mem note (RESOLVED in audit):** partial indexes via the Kysely builder
    `.where(sql.ref("archived_at"), "is", null)` ALREADY run under pg-mem — this is
    the exact pattern in `010.card-due-date.ts:11-16`, which `newTestDb` executes
    (`up010`) with no degrade/try-catch. So NO try/catch degrade is needed here; do
    NOT copy the `017.card-search.ts` degrade pattern (that was only for
    tsvector/GIN, which pg-mem genuinely lacks). The `archived_at` COLUMN (plain
    `timestamptz`) is also pg-mem-safe.
- [x] `db/types.ts` — add `archived_at: Timestamp | null` to `BoardsTable`
  (`db/types.ts:95-104`), `ColumnsTable` (`db/types.ts:112-119`), and `CardsTable`
  (`db/types.ts:121-135`, before `search_vector`). Use the existing `Timestamp`
  alias (`db/types.ts:15`). No `Database` interface change (tables already
  registered).
- [x] `migrations/018.archiving.spec.ts` (LIVES IN `src/migrations/`, mirror
  `015.card-cover.spec.ts`): pg-mem + `gen_random_uuid`; run `up001..up017` for the
  FK chain, then `up` (018). Assert: `up` itself does NOT throw (proves the partial
  indexes boot under pg-mem — see the migration note); after `up`, `archived_at`
  selectable on all three tables and defaults to null on insert; after `down`, the
  column is gone (select rejects). (Index query-planner USE is validated on live PG;
  index CREATION is validated here under pg-mem.)

## 2. Shared schemas + errors (`packages/shared`)

- [x] `src/activity.schema.ts` — add the 6 new `ActivityType` values
  (`CARD_ARCHIVED`, `CARD_RESTORED`, `COLUMN_ARCHIVED`, `COLUMN_RESTORED`,
  `BOARD_ARCHIVED`, `BOARD_RESTORED`) to the `as const` object
  (`activity.schema.ts:4-37`); document their conventional meta keys in the
  comment block (`activity.schema.ts:40-49`): card events `{ cardTitle }`,
  column events `{ columnName }`, board events `{ boardName }`. Update the "(22
  types)" count comment to "(28 types)".
- [x] `src/board.schema.ts` — add `archivedAt` to `boardSchema`
  (`board.schema.ts:50-60`): `archivedAt: z.date().nullable()`. Add inputs:
  `archiveBoardInput`/`restoreBoardInput` = `z.object({ id: z.string() })` (or
  reuse the router's `idInput`); `listArchivedBoardsInput` = `z.object({ projectId:
  z.string() })`. Add `archivedBoardSchema` = `boardSchema` (already carries
  `archivedAt`) — reuse `boardSchema` for archived-board rows.
- [x] `src/board.schema.ts` — add `archivedBoardItemsSchema` for the per-board
  archived view: `z.object({ columns: z.array(columnSchema.extend({ archivedAt:
  z.date().nullable() })), cards: z.array(cardSchema.extend({ columnId:
  z.string(), columnName: z.string(), archivedAt: z.date().nullable() })) })`.
  (Cards carry `columnName` so the FE can group "archived cards" under their column
  even when the column is active. Reuse `cardSchema` enrichment shape where
  practical; a lean shape `{ id, title, columnId, columnName, archivedAt }` is also
  acceptable — DECIDED: lean shape to avoid enriching archived cards.)
- [x] `src/column.schema.ts` — add `archivedAt: z.date().nullable()` to
  `columnSchema`.
- [x] `src/card.schema.ts` — add `archivedAt: z.date().nullable()` to `cardSchema`.
- [x] `src/errors/board.error.ts` — add `PARENT_ARCHIVED` (restore blocked because
  a parent is archived) to `BoardError`.
- [x] `pnpm --filter shared build` so backend + frontend pick up the new types.

## 3. Repo additions

- [x] `board.repo.ts` — `setBoardArchived(db, id, at: Date | null)`:
  `updateTable("boards").set({ archived_at: at, updated_at: new Date() })
  .where("id","=",id).returningAll().executeTakeFirst()`.
- [x] `board.repo.ts` — `listArchivedBoardsForProject(db, projectId)`: like
  `listBoardsForProject` but `.where("archived_at","is not",null)` ordered by
  `archived_at desc`.
- [x] `column.repo.ts` — `setColumnArchived(db, id, at)` (mirror `setPosition`
  shape, returningAll). `listArchivedByBoard(db, boardId)`:
  `.where("board_id","=",boardId).where("archived_at","is not",null)
  .orderBy("position","asc")`.
- [x] `card.repo.ts` — `setCardArchived(db, id, at)` (returningAll).
  `listArchivedByBoard(db, boardId)`: join `columns`, select card fields +
  `columns.name as column_name`, `.where("columns.board_id","=",boardId)
  .where("cards.archived_at","is not",null)` (cards individually archived; an
  archived-COLUMN's still-active cards are reachable by restoring the column, so
  they are NOT listed here unless individually archived) `.orderBy("cards.position","asc")`.

## 4. Service additions

### board.service.ts (owner-gated; mirror `deleteBoard`)
- [x] `archiveBoard(db, user, id)` — `const { row } = await loadBoardFor(db, user,
  id, "owner")`; if `row.archived_at` already set → return `toBoard` (idempotent
  no-op); else `repo.setBoardArchived(db, id, new Date())`; `record(db, { boardId:
  id, cardId: null, actorId: user.id, type: BOARD_ARCHIVED, meta: { boardName:
  row.name } })`; return updated board.
- [x] `restoreBoard(db, user, id)` — `loadBoardFor(..., "owner")`; if not archived
  → no-op return; else `repo.setBoardArchived(db, id, null)`; record
  `BOARD_RESTORED`; return updated.
- [x] `listArchivedBoards(db, user, projectId)` — `repo.listArchivedBoardsForProject`;
  resolve each row's permission via `resolveBoardPermission` (same loop as
  `listBoards` `board.service.ts:135-138`); include only rows with a non-null perm;
  map to `Board` (carrying `archivedAt`). Owner affordances are derived FE-side
  from `myPermission`.
- [x] `getArchivedItems(db, user, boardId)` — `loadBoardFor(..., "edit")`;
  `column.repo.listArchivedByBoard` + `card.repo.listArchivedByBoard`; map to
  `archivedBoardItemsSchema`. (Decide owner: it lives in board.service since it
  spans columns+cards; OR add to each feature service. DECIDED: board.service to
  keep the cross-entity query in one place, importing `columnRepo`/`cardRepo`
  directly — cross-feature repo import is an accepted pattern, `card.enrich.ts:2-6`.)

### column.service.ts (edit-gated; mirror `deleteColumn`)
- [x] `archiveColumn(db, user, id)` — `const row = await loadColumnFor(db, user, id,
  "edit")`; idempotent no-op if already archived; else `repo.setColumnArchived(db,
  id, new Date())`; resolve board via `row.board_id`; `record(... boardId:
  row.board_id, cardId: null, type: COLUMN_ARCHIVED, meta: { columnName: row.name })`;
  return column.
- [x] `restoreColumn(db, user, id)` — `loadColumnFor(..., "edit")`; **parent guard:**
  load the board via `boardRepo.findBoardById(db, row.board_id)` (UNFILTERED finder —
  must resolve even an archived board so the guard can fire); if
  `board.archived_at != null` throw `BAD_REQUEST` `BoardError.PARENT_ARCHIVED`;
  else `repo.setColumnArchived(db, id, null)`; record `COLUMN_RESTORED`; return.
  (Restoring an already-active column is a no-op return, no activity.)

### card.service.ts (edit-gated; mirror `deleteCard`)
- [x] `archiveCard(db, user, id)` — `const { card, column } = await loadCardFor(db,
  user, id, "edit")`; idempotent no-op if already archived; else
  `repo.setCardArchived(db, id, new Date())`; `record(... boardId: column.board_id,
  cardId: id, type: CARD_ARCHIVED, meta: { cardTitle: card.title })`; return
  enriched card (or lean — DECIDED: return the updated card row enriched via
  `enrichCard` for FE consistency).
- [x] `restoreCard(db, user, id)` — `loadCardFor(..., "edit")` (note: `findCardById`
  is unfiltered so an archived card resolves); **parent guard:** load `column` via
  `repo.findColumnById` (UNFILTERED) then `board` via `boardRepo.findBoardById`
  (UNFILTERED — both must resolve archived parents so the guard fires); if
  `column.archived_at != null || board.archived_at != null` throw `BAD_REQUEST`
  `BoardError.PARENT_ARCHIVED`; else `repo.setCardArchived(db, id, null)`; record
  `CARD_RESTORED`; return enriched card. Note: a restored card needs a fresh
  position only if positions collide; appending `maxPosition(active)+1` is the
  safe choice — DECIDED: restore in place (keep stored position); collisions are
  harmless (double precision, FE sorts) and re-stamping position adds complexity.

## 5. Routers

- [x] `board.router.ts` — add `archive` (POST `/boards/{id}/archive`), `restore`
  (POST `/boards/{id}/restore`), `archived` (GET `/boards/archived` with
  `listArchivedBoardsInput`, output `z.array(boardSchema)`), `archivedItems` (GET
  `/boards/{id}/archived`, output `archivedBoardItemsSchema`). Mirror the existing
  `.meta` openapi shape (`board.router.ts:22-84`).
- [x] `column.router.ts` — add `archive` (POST `/columns/{id}/archive`), `restore`
  (POST `/columns/{id}/restore`), output `columnSchema`.
- [x] `card.router.ts` — add `archive` (POST `/cards/{id}/archive`), `restore`
  (POST `/cards/{id}/restore`), output `cardSchema`.
- [x] No `trpc/router.ts` change (routers already registered as
  `boards`/`columns`/`cards`).

## 6. Test-harness wiring (REQUIRED — do not skip)
- [x] `features/auth/test/helpers.ts` — `newTestDb` hardcodes `up001..up017`
  (imports `helpers.ts:10-26`, calls `:44-60`). Add
  `import { up as up018 } from "../../../migrations/018.archiving.js";` and
  `await up018(db);` after `await up017(db);`. WITHOUT this the test DB has no
  `archived_at` columns and every archive query/test fails.

## 7. Tests (pg-mem, mirror `features/board/test` + `features/card/test`)
Reuse `seedBoard`/`seedColumn`/`seedCard`/`seedBoardAccess`/`seedUser`/`authedCaller`
from `board/test/helpers`. Add seed options to set `archived_at` directly (or call
the archive endpoints to produce it).

### archive hides from EVERY listed read path
- [x] `getBoardData`: an archived CARD is absent from its column's `cards`.
- [x] `getBoardData`: an archived COLUMN is absent AND its (active) cards are
  absent too (filter-by-parent).
- [x] `getBoardData`: cards under an archived column do not appear even though the
  cards themselves are active.
- [x] `boards.list`: an archived board is absent from the project's active list.
- [x] `boards.get` on an archived board → NOT_FOUND (audit-fix leak guard).
- [x] `boards.getData` on an archived board → NOT_FOUND (audit-fix leak guard);
  it does NOT return an empty-column ghost board.
- [x] `boards.archived`: lists exactly the archived boards the caller can resolve;
  excludes active boards and boards on inaccessible projects (no leak).
- [x] `cards.due` on an archived BOARD (columns still active) → empty / NOT_FOUND;
  the board predicate in `listDueCards` suppresses the leak even though
  `enforceBoard("view")` admits the archived board.
- [x] `cards.due` (`listDueCards`): an archived card / a card under an archived
  column is excluded.
- [x] reminders (`runDueReminders`): an archived card due now sends NO email;
  archiving its column or board likewise suppresses the email.
- [x] search (`search.cards`): an archived card never appears in results; a card
  under an archived column/board never appears (assert via the no-text/filter path
  on pg-mem; the visibility+archive predicates run there).
- [x] move neighbours: `column.move` / `card.move` ignore archived siblings
  (archived rows excluded from `listByBoard`/`listByColumn` and `maxPosition`).
- [x] counts/enrichment: an archived card contributes nothing to any
  label/assignee/comment/checklist/attachment count surfaced by `getBoardData`
  (it is simply absent from the enriched set).

### restore brings back
- [x] restore a card whose column+board are active → reappears in `getBoardData`.
- [x] restore a column (board active) → the column and its still-active cards
  reappear; cards individually archived stay hidden.
- [x] restore a board → reappears in `boards.list`, drops from `boards.archived`.

### restore-into-archived-parent
- [x] restoring a card whose column is archived → `BAD_REQUEST` `PARENT_ARCHIVED`;
  card stays archived; no activity recorded.
- [x] restoring a card whose board is archived → `BAD_REQUEST` `PARENT_ARCHIVED`.
- [x] restoring a column whose board is archived → `BAD_REQUEST` `PARENT_ARCHIVED`.
- [x] after restoring the parent column, the card can then be restored.

### permission checks
- [x] archive/restore CARD + COLUMN: board `edit`-grantee ok; `view`-only →
  FORBIDDEN; no access → NOT_FOUND (no leak).
- [x] archive/restore BOARD + permanent-delete board: board/project owner ok;
  `edit`-grantee → FORBIDDEN.
- [x] `boards.archivedItems` requires board `edit`; view-only → FORBIDDEN.
- [x] archive/restore on a nonexistent id or inaccessible board → NOT_FOUND.

### idempotency
- [x] archiving an already-archived row → no-op success, no duplicate activity.
- [x] restoring an already-active row → no-op success.

### permanent delete cascade (existing endpoints, unchanged)
- [x] `cards.delete` on an archived card hard-deletes it (gone from archived list
  and from DB).
- [x] `columns.delete` on an archived column cascades its cards (active + archived)
  away.
- [x] `boards.delete` on an archived board cascades columns/cards/access/activity
  away (same as today).

### activity events
- [x] `CARD_ARCHIVED` / `CARD_RESTORED` rows recorded with `meta.cardTitle`,
  correct `card_id` + `board_id`.
- [x] `COLUMN_ARCHIVED` / `COLUMN_RESTORED` rows recorded board-scoped
  (`card_id null`) with `meta.columnName`.
- [x] `BOARD_ARCHIVED` / `BOARD_RESTORED` rows recorded with `meta.boardName`; the
  `BOARD_ARCHIVED` row is still readable in the board feed after archive (board not
  deleted).
- [x] activity feed is NOT archive-filtered: an archived card's history still
  returned by the card timeline / board feed.

### migration
- [x] `migrations/018.archiving.spec.ts`: up adds `archived_at` to all three tables
  (selectable, null default); down drops it. Partial-index DDL validated on live
  PG (noted in the spec).

## 8. Verify
- [x] `pnpm --filter shared build`
- [x] `pnpm --filter backend test` green (archive/restore/visibility/permission on
  pg-mem; search archive predicates exercised on the no-text path).
- [x] `pnpm --filter backend migrate` applies `018.archiving` against live Postgres
  (the live runner globs `migrations/` — `scripts/migrate.script.ts`); partial
  indexes verified there.
- [x] Swagger shows the new archive/restore/archived routes under
  `/boards` `/columns` `/cards`.
