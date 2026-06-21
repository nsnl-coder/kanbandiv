# Board Archiving — Production-Readiness Audit

Audited the two plan files against the actual codebase (every referenced file
opened and verified). Severity: **P0** = data leak / wrong email / corruption;
**P1** = correctness gap; **P2** = clarity / robustness. Issues with a fix were
applied in-place to `archiving.backend.md` / `archiving.frontend.md`.

## Issues found

### P0-1 — `boards.get` / `boards.getData` leak an ARCHIVED board
- **Where:** `board.service.getBoard` (`board.service.ts:119-126`),
  `getBoardData` (`board.service.ts:142-168`). Both call
  `loadBoardFor(..., "view")` → unfiltered `findBoardById` (`board.repo.ts:30-36`).
- **Problem:** The plan correctly keeps `findBoardById` unfiltered (needed for
  archive/restore), but never decided what the normal READ endpoints do with an
  archived board. As written, an archived board still opens via `boards.get` and
  `boards.getData` (the latter returns it with an empty column list once
  `listColumnsForBoard` is filtered — a "ghost board"). This is a leak + bad UX.
- **Fix (applied):** `getBoard` and `getBoardData` throw NOT_FOUND when
  `row.archived_at != null`. Archived boards are reachable only via
  `boards.archived` + restore. Added to backend plan §board.service.ts and to the
  read-path tests; FE plan got a matching "archived board not directly openable"
  decision + deep-link not-found test.

### P0-2 — `listDueCards` missing the BOARD predicate (reminder/due leak path)
- **Where:** `card.repo.listDueCards` (`card.repo.ts:73-85`), called by
  `card.service.listDueCards` (`card.service.ts:241-257`).
- **Problem:** The plan made the board predicate OPTIONAL ("add for safety if the
  join is widened"). But `listDueCards` joins only `columns`, and the service gate
  is `enforceBoard(..., "view")` (`card.service.ts:247`) which routes through the
  unfiltered `loadBoardFor` and therefore ADMITS an archived board (see P0-1). So
  an archived BOARD whose columns are still active would leak its due cards.
- **Fix (applied):** board join + `boards.archived_at is null` is now REQUIRED in
  the `listDueCards` task, with the reasoning. (`findDueForReminder` was already
  correctly specified with the full join-up — the reminder worker is covered.)

### P1-1 — Migration partial-index form not verified on pg-mem (and false degrade note)
- **Where:** backend plan §1 migration code block.
- **Problem:** The plan wrote `.where(sql`archived_at is null`)` (raw SQL) and a
  note saying "if pg-mem rejects the partial WHERE, self-degrade like
  `017.card-search.ts`." Two issues: (a) the raw-SQL form is unverified on pg-mem;
  (b) the degrade premise is wrong — `010.card-due-date.ts:11-16` ALREADY creates a
  partial index with the Kysely builder form `.where(sql.ref("due_at"), "is not",
  null)` and `newTestDb` runs `up010` with no try/catch. Partial indexes work on
  pg-mem. The `017` degrade existed only for tsvector/GIN, which pg-mem truly lacks.
- **Fix (applied):** migration code now uses `.where(sql.ref("archived_at"), "is",
  null)` (the proven `010` form), imports `sql`, and the pg-mem note is rewritten
  to "RESOLVED — no degrade needed." Spec task now asserts `up` does not throw
  (proves index creation under pg-mem).

### P2-1 — Idempotent no-op must not emit activity
- **Where:** backend plan §4 archive/restore service tasks.
- **Problem:** Plan said double-archive returns the current row, but the activity
  side was only implied.
- **Fix (applied):** explicit statement in "Empty / not-found semantics" and on the
  `restoreColumn` task that a no-op transition records NO activity (already asserted
  in the idempotency tests).

### P2-2 — Restore parent guards must use UNFILTERED finders
- **Where:** `restoreCard` / `restoreColumn` (backend plan §4).
- **Problem:** The guard only fires if the parent lookup can SEE an archived parent.
  If a future edit pointed these at a filtered finder, an archived parent would read
  as null and the guard would silently pass (then restore into an invisible parent).
- **Fix (applied):** annotated `repo.findColumnById` / `boardRepo.findBoardById` as
  UNFILTERED (required) in both restore tasks.

## Verified CORRECT (no change needed)

- **`findBoardById` / `findColumnById` / `findCardById` left unfiltered** —
  intentional and necessary for archive/restore + parent guards. Confirmed the only
  read endpoint that exposes an archived row through them is `boards.get`/`getData`
  (fixed in P0-1); there is NO `cards.get` / `columns.get` endpoint, so cards and
  columns surface only via the (now-guarded, parent-filtered) `getBoardData`.
- **Cascade = filter-by-parent** — JOIN-up filters are correct. `listCardsForBoard`
  (`board.repo.ts:75-95`) and `findDueForReminder` already join `columns`; adding
  the card+column (+board for due) predicates is the right place. Partial indexes
  `(parent_id) WHERE archived_at IS NULL` match the active-row read shape.
- **Permanent delete still cascades** — `deleteBoard`/`deleteColumn`/`deleteCard`
  unchanged; DB FK cascades unaffected by a nullable column.
- **maxPosition exclude-archived** (`column.repo.ts:60-67`, `card.repo.ts:125-132`)
  — correct: new rows append after max ACTIVE position; a stale archived position
  must not push new rows out.
- **Move/neighbor queries** — `moveColumn` uses `listByBoard` (`column.service.ts:117`),
  `moveCard` uses `listByColumn` (`card.service.ts:299`). Adding `archived_at is
  null` to both list repos removes archived rows from the sibling set fed to
  `computePosition` (`column.service.ts:130-143`), so you cannot position relative
  to an archived neighbor. Correct.
- **Enrichment / counts** — `enrichCards` (`card.enrich.ts:28`) takes explicit rows
  and every `*ForCards(db, ids)` helper keys strictly off the passed `ids`
  (verified: `label.repo.ts:106-123`, `assignee.repo.ts:42-65`,
  `comment.repo.ts:142-158`, `checklist.repo.ts:152-171`,
  `attachment.repo.ts:87`). They never widen the set, so once list repos return
  active-only, counts/labels/assignees are clean. No repo edit needed.
- **search.repo.buildSearchQuery** (`search.repo.ts:40-152`) — already innerJoins
  cards→columns→boards→projects; the plan's 3 unconditional predicates are correct
  and land in the filter block. pg-mem runs the no-text path, so the predicates are
  exercised in tests.
- **Activity** — `record` signature (`activity.recorder.ts:17-53`) accepts
  `{boardId, cardId, actorId, type, meta}`; the 6 new types fit. Activity reads
  (`activity.repo.listByCard`/`listByBoard`, `activity.repo.ts:6-24`) intentionally
  NOT archive-filtered — correct (audit history of an archived/restored entity must
  survive). Enum lives in `activity.schema.ts:4-37` (currently 22 → 28).
- **Permissions** — archive/restore card+column = `edit` (matches `loadCardFor` /
  `loadColumnFor` "edit" usage in delete); board archive/restore/permanent-delete =
  `owner` (matches `deleteBoard` `board.service.ts:232`). `loadBoardFor`
  (`board.service.ts:102-117`) maps no-access → NOT_FOUND, low-perm → FORBIDDEN:
  correct no-leak semantics.
- **Test harness** — `newTestDb` (`auth/test/helpers.ts:32-62`) hardcodes
  up001..up017; the plan's up018 wiring is required and correct.
- **db/types.ts** — `archived_at: Timestamp | null` targets confirmed:
  `BoardsTable` (`:95-104`), `ColumnsTable` (`:112-119`), `CardsTable` (`:121-135`,
  before `search_vector`). `Timestamp` alias at `:15`. No `Database` change.

## FINAL complete list of read paths to filter (confirmed)

Own-flag = add `<table>.archived_at is null`. Parent = add joined column/board flag.

1. `board.repo.listBoardsForProject` — own (`boards.archived_at`). [boards.list]
2. `board.repo.listColumnsForBoard` — own (`columns.archived_at`). [getBoardData]
3. `board.repo.listCardsForBoard` — own (`cards.archived_at`) + parent
   (`columns.archived_at`). [getBoardData]
4. `column.repo.listByBoard` — own. [moveColumn neighbors / ordered list]
5. `column.repo.maxPosition` — own. [new-column append]
6. `card.repo.listByColumn` — own. [moveCard neighbors / position]
7. `card.repo.maxPosition` — own. [new-card append]
8. `card.repo.listDueCards` — own + parent column **+ parent board (P0-2 fix)**.
   [cards.due]
9. `card.repo.findDueForReminder` — own + parent column + parent board. [reminder
   worker — must not email about archived]
10. `search.repo.buildSearchQuery` — cards + columns + boards (unconditional).
    [search.cards]
11. `board.service.getBoard` — guard: NOT_FOUND if board archived **(P0-1 fix)**.
12. `board.service.getBoardData` — guard: NOT_FOUND if board archived **(P0-1
    fix)**, plus relies on #2/#3.

**Intentionally NOT filtered** (must resolve archived rows): `findBoardById`,
`findColumnById` (both feature copies), `findCardById`;
`activity.repo.listByCard` / `listByBoard`. Enrichment `*ForCards` helpers need no
edit (keyed on already-filtered ids).
