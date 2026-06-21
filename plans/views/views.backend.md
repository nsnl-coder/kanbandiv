# Saved Board Views — Backend Plan

Persist, per `(user, board)`, the user's chosen VIEW MODE (kanban / table /
calendar / swimlanes) and the active FILTERS (label ids, assignee ids, due
filter, swimlane grouping) so reopening the board restores them. This is the
ONLY backend work for the Saved Views feature — every alternative rendering
(table, calendar, swimlanes) lives in the frontend plan (`views.frontend.md`)
and is built from data the board ALREADY returns:
- TABLE + SWIMLANES render from `board.service.getBoardData`
  (`board.service.ts:148`) — its `columns[].cards[]` are already enriched with
  labels, assignees, due (`dueAt`/`isOverdue`), cover and counts via
  `enrichCards` (`board.service.ts:157`). No new card-fetch endpoint.
- CALENDAR reuses the EXISTING due query `card.service.listDueCards`
  (`card.service.ts:245`) exposed as `cards.due` (`GET /cards/due`,
  `card.router.ts:22`). No new card-fetch endpoint.

So the backend adds exactly ONE persistence table + two procedures (get my
view, set my view). NO rendering, NO new card queries.

Mirror `features/activity` + `features/search` patterns: `*.router.ts` /
`*.service.ts` / `*.repo.ts` + `test/<endpoint>.spec.ts`, Kysely, tRPC
`protectedProcedure`, Zod from `shared`, OpenAPI `.meta`, superjson.

**Naming (decided):** router export `boardViewsRouter`, registered under the
key `boardViews` in `trpc/router.ts`, FE calls `trpc.boardViews.*`. (Plural-ish
feature key like `boards`/`cards`; `boardView` is a single saved row but the key
reads as the feature.) Backend and frontend plans MUST stay in sync on this key.

## Key decisions (decided)

### Storage shape = one row per `(user_id, board_id)`, upserted — DECIDED
- Table `board_views` keyed by a **composite PK `(user_id, board_id)`** — at most
  ONE saved view per user per board. No id column needed (the pair IS the
  identity); this makes "set my view" a clean `INSERT … ON CONFLICT (user_id,
  board_id) DO UPDATE` (upsert), and "get my view" a single point lookup.
- Columns: `mode text notnull` (the `BoardViewMode` enum value) + `config jsonb
  notnull default '{}'` (the active filters bag) + `updated_at`. The mode is a
  top-level column (not inside config) so it can be defaulted/queried cleanly and
  is validated by an enum; the filters live in `config` because they are an
  evolving, FE-driven shape.
- `user_id` / `board_id` are both `ON DELETE CASCADE` — a saved view is
  meaningless once the user or the board is gone (it is a personal UI preference,
  not audit data; contrast `activities` which keeps history). Deleting a board or
  a user simply removes their saved views.

### config is JSONB — follow the activity `meta` pattern EXACTLY — DECIDED
- `activities.meta` (`db/types.ts:242-253`) is the FIRST and ONLY jsonb column in
  the schema and it learned (activity audit B1) that **Kysely + node-pg does NOT
  auto-serialize a JS object into a jsonb column** — a raw object is sent as the
  string `"[object Object]"` and corrupts the row. pg-mem accepts a raw object so
  tests pass while prod corrupts (silent). The fix proven there: `JSON.stringify`
  on insert and type the column `ColumnType<T, string, string>`.
- `board_views.config` MUST follow the SAME pattern:
  - `db/types.ts`: `config: ColumnType<BoardViewConfig, string, string>`
    (select returns the parsed object; INSERT/UPDATE send JSON TEXT).
  - repo upsert MUST `JSON.stringify(config)` on BOTH the insert values AND the
    `ON CONFLICT … DO UPDATE SET` value (the update path is jsonb too — same
    corruption risk).

### config is VALIDATED by Zod before write — a malformed config can't corrupt rendering — DECIDED
- The upsert input goes through `boardViewConfigSchema` (a STRICT Zod object, see
  §2) BEFORE it is stringified and stored. tRPC `.input(...)` already validates,
  so a malformed mode/config is rejected at the boundary with a `BAD_REQUEST`
  (Zod) and never reaches the DB. This is the guard that keeps the FE's rendering
  safe: whatever comes back from "get my view" is always a well-formed
  `{ mode, config }`.
- On READ, the service ALSO re-parses the stored row through the schema (defensive
  — a row written by an older app version or a hand-edited DB could be stale); if
  parsing fails, return the DEFAULT view instead of throwing (a corrupt
  preference must never 500 the board). State this.

### Permission = board `view` (you must be able to see the board) — DECIDED
- A saved view belongs to the `(user, board)` pair. Reading or writing YOUR OWN
  view for board B requires only that you can SEE board B. Resolve via
  `board.service.loadBoardFor(db, user, boardId, "view")` (`board.service.ts:107`)
  — it throws NOT_FOUND when the caller has no access (private boards must not
  leak their existence, `board.service.ts:118`). A `view`-only member CAN save a
  view (it is a personal preference, not a board mutation).
- `user_id` is ALWAYS `ctx.user.id` — never an input field. There is no way to
  read or write another user's saved view (no per-user param on either
  procedure). This is the whole isolation model; state it in tests.
- Do NOT block saving a view on an ARCHIVED board specially: `getBoardData`/
  `getBoard` already 404 an archived board (`board.service.ts:130,154`), so the FE
  never opens one; `loadBoardFor("view")` would still resolve an archived row, but
  there is no harm in storing a preference for it (it cascades away on permanent
  delete). No extra archived guard needed.

### get returns a DEFAULT when none saved — DECIDED
- "get my view" NEVER 404s on a missing row. When the user has no saved view for
  the board, return the default `{ mode: "kanban", config: { labelIds: [],
  assigneeIds: [], due: null, swimlaneBy: null } }`. The FE hydrates from this
  unconditionally, so a first-time visitor lands on kanban with no filters. The
  default is a shared constant (`defaultBoardView`, §2) so BE and FE agree.

### no separate "delete my view" endpoint — DECIDED
- Resetting to defaults is just `set` with `mode: "kanban"` and empty filters
  (an upsert). A delete endpoint adds API surface for no UX gain. (If a hard
  reset is wanted later, add it then.) State this decision.

## API endpoints

tRPC procedure → OpenAPI method + path. All `protectedProcedure`. `user_id` is
always the caller; never an input.

- [x] `GET /boards/{boardId}/view` — get the caller's saved view (mode + filters) for a board; returns the default view when none saved; board `view`
- [x] `PUT /boards/{boardId}/view` — upsert the caller's saved view (validated mode + filters config) for a board; board `view`; returns the saved view

No POST/DELETE. Two procedures only (`get` query, `set` mutation). Search /
activity / card-data endpoints are reused UNCHANGED — no new card-fetch endpoint.

## 1. Database (migration + db types)

- [x] `migrations/019.board-view.ts` (next free number is 019; highest existing
  is `018.archiving`). Mirror `012.comment.ts` / `016.activity.ts` style (`sql`
  import, `gen_random_uuid` not needed — no id column). Create `board_views`:
  - `user_id uuid notnull references users.id on delete cascade`
  - `board_id uuid notnull references boards.id on delete cascade`
  - `mode text notnull default 'kanban'`
  - `config jsonb notnull default '{}'::jsonb` (the filters bag; see §2). The
    default is defensive only — the repo ALWAYS sends a full `JSON.stringify`'d
    config (Zod fills every field's `.default(...)`), so the column default is
    never relied on at write time.
  - `updated_at timestamptz notnull default now()`
  - **composite primary key `(user_id, board_id)`** — at most one row per pair;
    this is the upsert conflict target. Use
    `.addPrimaryKeyConstraint("board_views_pkey", ["user_id", "board_id"])`.
  - Index: the PK already covers the `(user_id, board_id)` point lookup; an extra
    `board_id` index is NOT needed (no per-board scan of all users' views in this
    feature). State this (no extra index).
  - `down` drops the table `.ifExists()`.
- [x] `db/types.ts` — add `BoardViewsTable`. The `config` jsonb column follows the
  `ActivitiesTable.meta` pattern EXACTLY (`db/types.ts:251`):
  ```ts
  import type { ColumnType } from "kysely";
  import type { BoardViewConfig } from "shared";
  export interface BoardViewsTable {
    user_id: string;
    board_id: string;
    mode: string; // BoardViewMode value; validated by Zod at the boundary
    // jsonb: select returns a parsed object; INSERT/UPDATE MUST send JSON TEXT
    // (the repo JSON.stringify's it on BOTH insert and on-conflict-update —
    // node-pg sends a raw object as "[object Object]" and corrupts the row,
    // mirror activity audit B1). So the insert/update type is string.
    config: ColumnType<BoardViewConfig, string, string>;
    updated_at: GeneratedTimestamp;
  }
  ```
  Register `board_views: BoardViewsTable` in the `Database` interface
  (`db/types.ts:255`). Use the existing `GeneratedTimestamp` alias
  (`db/types.ts:17`). (`ColumnType` is already imported, `db/types.ts:1`.)
- [x] `migrations/019.board-view.spec.ts` (LIVES IN `src/migrations/`, mirror
  `016.activity.spec.ts` if present, else `015.card-cover.spec.ts`): pg-mem +
  register `gen_random_uuid`; run prior `up`s for the FK chain (`up001` auth,
  `up003` project, `up004` board), then `up` (019). Assert:
  - up creates `board_views` with the composite PK; a second insert of the SAME
    `(user_id, board_id)` violates the PK (proves uniqueness) — or the upsert
    path round-trips (see §3 spec note).
  - inserting a row with jsonb `config` passed as `JSON.stringify({...})` reads
    back as a PARSED object (`expect(row.config).toEqual({...})`) — confirms the
    stringify path (activity B1 note: pg-mem would accept a raw object too, so
    this asserts the round-trip, the stringify is the real prod guard).
  - deleting the user cascades the row away; deleting the board cascades the row
    away (pg-mem honors `ON DELETE CASCADE`, proven by `015.card-cover.spec.ts`).
  - `down` drops the table.

## 2. Shared schemas + enum + errors (`packages/shared`)

Note: schemas live FLAT at `shared/src/*.schema.ts` in this repo (e.g.
`activity.schema.ts`, `search.schema.ts`) — NOT under `validations/`. Follow the
ACTUAL layout: `src/board-view.schema.ts`. Do not "fix" it to `validations/`.

- [x] `src/board-view.schema.ts`:
  - `BoardViewMode` — single source of truth `as const` object (mirror
    `ActivityType` `as const` shape, `activity.schema.ts`):
    ```ts
    export const BoardViewMode = {
      KANBAN: "kanban",
      TABLE: "table",
      CALENDAR: "calendar",
      SWIMLANES: "swimlanes",
    } as const;
    export type BoardViewModeValue = (typeof BoardViewMode)[keyof typeof BoardViewMode];
    export const boardViewModeSchema = z.enum(["kanban", "table", "calendar", "swimlanes"]);
    ```
  - `dueViewFilterSchema` — reuse the search feature's due vocabulary so BE/FE
    agree: `z.enum(["overdue", "due_soon", "has_due"])` (identical to
    `dueFilterSchema` `search.schema.ts:3`). Decided: re-declare it here (a tiny
    enum; avoids cross-feature coupling, token rule "3 lines beat an
    abstraction"). The TABLE/SWIMLANE rendering maps this to the FE `dueState`
    helper (`utils.ts:125`) — documented in the FE plan.
  - `swimlaneGroupingSchema` = `z.enum(["label", "assignee"])` — the SWIMLANES
    grouping axis. Only meaningful when `mode === "swimlanes"`; stored regardless
    so switching modes restores the last grouping.
  - `boardViewConfigSchema` — STRICT object (the validated filters bag stored in
    `config` jsonb). Use `.strict()` so an unknown key is REJECTED (a malformed
    config cannot smuggle junk into the jsonb and corrupt rendering):
    ```ts
    export const boardViewConfigSchema = z.object({
      labelIds: z.array(z.string()).default([]),
      assigneeIds: z.array(z.string()).default([]),
      assignedToMe: z.boolean().default(false), // mirrors the existing FE filter
      due: dueViewFilterSchema.nullable().default(null),
      swimlaneBy: swimlaneGroupingSchema.nullable().default(null),
    }).strict();
    export type BoardViewConfig = z.infer<typeof boardViewConfigSchema>;
    ```
    (Note `assignedToMe` mirrors `BoardDetailPage` state `assignedToMe`
    (`BoardDetailPage.tsx:63`) so the full filter set round-trips — decided to
    persist it too.)
  - input `getBoardViewInput` = `z.object({ boardId: z.string() })`.
  - input `setBoardViewInput` = `z.object({ boardId: z.string(), mode:
    boardViewModeSchema, config: boardViewConfigSchema })`. (Because `config`'s
    fields all have `.default(...)`, a partial config from the FE is normalized to
    a full config by Zod before storage — so a stored config is ALWAYS complete.)
  - output `boardViewSchema` = `z.object({ mode: boardViewModeSchema, config:
    boardViewConfigSchema })`. (No `userId`/`boardId` echoed — the FE already
    knows them; keep the payload lean.)
  - `defaultBoardView` — the shared default returned by `get` when no row exists:
    ```ts
    export const defaultBoardView: BoardView = {
      mode: BoardViewMode.KANBAN,
      config: { labelIds: [], assigneeIds: [], assignedToMe: false, due: null, swimlaneBy: null },
    };
    ```
  - export inferred types: `export type BoardView = z.infer<typeof boardViewSchema>`,
    `export type SetBoardViewInput`, `export type GetBoardViewInput`.
- [x] `src/errors/board-view.error.ts` — `BoardViewError` `as const` (mirror
  `errors/activity.error.ts`): `BOARD_NOT_FOUND` (the only domain error — a board
  the caller cannot view; everything else is a Zod `BAD_REQUEST` or the default).
  Export the value type.
- [x] `src/index.ts` — add `export * from "./board-view.schema.js";` and
  `export * from "./errors/board-view.error.js";` (the barrel exports each file
  explicitly, `index.ts:1-29`; no auto-discovery).
- [x] `pnpm --filter shared build` so backend + frontend pick up the new types.

## 3. Repo (`features/board-view/board-view.repo.ts`)

- [x] `Db = Kysely<Database>` (mirror other repos).
- [x] `getForUser(db, userId, boardId)` — point lookup on the composite PK:
  `selectFrom("board_views").selectAll().where("user_id","=",userId)
  .where("board_id","=",boardId).executeTakeFirst()`. Returns the row (with
  `config` already PARSED by node-pg for a jsonb select) or `undefined`.
- [x] `upsert(db, userId, boardId, mode, config: BoardViewConfig)` — INSERT …
  ON CONFLICT upsert. **BOTH the insert value AND the on-conflict update value of
  `config` MUST be `JSON.stringify(config)`** (jsonb on both paths — activity B1):
  ```ts
  return db.insertInto("board_views").values({
    user_id: userId, board_id: boardId, mode,
    config: JSON.stringify(config), updated_at: new Date(),
  }).onConflict((oc) => oc.columns(["user_id", "board_id"]).doUpdateSet({
    mode, config: JSON.stringify(config), updated_at: new Date(),
  })).returningAll().executeTakeFirstOrThrow();
  ```
  Returns the saved row (config parsed back to an object on the `returningAll`).
  - **pg-mem: CONFIRMED supported (audit).** A throwaway probe ran the EXACT
    pattern (composite PK `board_views_pkey (user_id, board_id)` + `jsonb config`
    + `onConflict(oc => oc.columns(["user_id","board_id"]).doUpdateSet({...}))` +
    `returningAll()`) on pg-mem: second upsert updated the same row (1 row total),
    `returningAll().config` came back PARSED, duplicate plain insert rejected by
    the PK. NO select-then-write fallback is needed. This also matches shipping
    repos `repo.upsertBoardAccess` (`board.repo.ts:160-161`) and
    `repo.upsertAccess` (`project.repo.ts:153-154`). Still assert it in the spec
    by upserting the SAME pair twice → one row, updated.

## 4. Service (`features/board-view/board-view.service.ts`)

- [x] `CtxUser = { id: string; isSuperuser: boolean }` (mirror
  `board.service.ts:24`) — or import `CtxUser` from `board.service`.
- [x] `getBoardView(db, user, { boardId })`:
  - `await loadBoardFor(db, user, boardId, "view")` (throws NOT_FOUND when the
    caller cannot see the board — map to `BoardViewError.BOARD_NOT_FOUND` via a
    try/catch if a feature-specific message is wanted, OR let the board
    NOT_FOUND propagate; decided: wrap to `BOARD_NOT_FOUND` for symmetry with the
    activity/search NOT_FOUND mapping).
  - `const row = await repo.getForUser(db, user.id, boardId)`.
  - if `!row` → return `defaultBoardView`.
  - else parse defensively: `const parsed = boardViewSchema.safeParse({ mode:
    row.mode, config: row.config })`; if `parsed.success` return `parsed.data`,
    else return `defaultBoardView`. The fallback covers BOTH failure modes: the
    `mode` column is plain `text` (NOT enum-constrained at the DB) so a stale/
    hand-edited `mode` (e.g. `"gantt"`) AND a stale/extra-key `config` both fail
    the strict schema and fall back. A stale/corrupt stored preference must NOT
    500 the board open (see Key decisions). Log a warning when it falls back
    (use `logger` + a `LogEvent` const, no string literal, per `backend.md`).
    **ADD** `BoardViewParseFailed: "board-view.parse.failed"` to
    `config/const.config.ts` — it does NOT exist yet (only
    `ActivityRecordFailed` is there today, `const.config.ts:20`).
- [x] `setBoardView(db, user, input)`:
  - `await loadBoardFor(db, user, input.boardId, "view")` (same NOT_FOUND map).
  - `input.mode` + `input.config` are ALREADY Zod-validated by the router
    (`setBoardViewInput`) — config is a complete, strict `BoardViewConfig`. Pass
    straight to `repo.upsert(db, user.id, input.boardId, input.mode, input.config)`.
  - return `{ mode: saved.mode as BoardViewModeValue, config: saved.config }`
    shaped to `boardViewSchema` (the saved row; equivalently re-validate with
    `boardViewSchema.parse(...)` for a tight output — decided: re-parse the saved
    row so the output is guaranteed schema-clean).
- [x] Do NOT call `getBoardData`/`listDueCards` here — persistence does not touch
  card data. (Those are FE-side, reusing existing endpoints.)

## 5. Router (`features/board-view/board-view.router.ts`)

- [x] tRPC `boardViewsRouter`. Mirror `activity.router.ts` `user(ctx)` helper +
  `.meta` openapi shape (`activity.router.ts:11-27`).
  - `get` — `protectedProcedure`, `.meta` openapi GET `/boards/{boardId}/view`,
    `tags: ["boardViews"]`, `protect: true`, input `getBoardViewInput`, output
    `boardViewSchema`, `.query` → `getBoardView(ctx.db, user(ctx), input)`.
  - `set` — `protectedProcedure`, `.meta` openapi PUT `/boards/{boardId}/view`,
    `tags: ["boardViews"]`, `protect: true`, input `setBoardViewInput`, output
    `boardViewSchema`, `.mutation` → `setBoardView(ctx.db, user(ctx), input)`.
- [x] Register `boardViews: boardViewsRouter` in `trpc/router.ts` (add import +
  line in `appRouter`, `router.ts:18-35`). Key is `boardViews`.

## 6. Test-harness wiring (REQUIRED — do not skip)

- [x] `features/auth/test/helpers.ts` — `newTestDb` hardcodes `up001..up018`
  (imports `helpers.ts:10-27`, calls `:45-62`). Add
  `import { up as up019 } from "../../../migrations/019.board-view.js";` and
  `await up019(db);` after `await up018(db);` (`helpers.ts:62`). WITHOUT this the
  test DB has no `board_views` table and every board-view test fails on the
  upsert/select.

## 7. Tests (pg-mem, mirror `features/activity/test` + `features/search/test`)

Reuse `seedUser`/`seedBoard`/`seedBoardAccess`/`seedColumn`/`authedCaller` (or
`createCaller` + `makeContext`) from `board/test/helpers`. Drive the REAL service
via the caller (`trpc.boardViews.*`).

### get — default when none
- [x] `get` for a board the user can view but has NEVER saved → returns
  `defaultBoardView` (`mode: "kanban"`, empty filters), does NOT 404.

### upsert creates then updates (the core)
- [x] `set` with `{ mode: "table", config: { labelIds: ["L1"], assigneeIds: [],
  assignedToMe: false, due: "overdue", swimlaneBy: null } }` creates a row; a
  following `get` returns exactly that. Assert a SINGLE `board_views` row for the
  pair.
- [x] a SECOND `set` for the SAME `(user, board)` with `{ mode: "swimlanes",
  config: { …, swimlaneBy: "assignee" } }` UPDATES the same row (still ONE row
  for the pair, `updated_at` advanced); `get` returns the new value. (Proves the
  ON CONFLICT upsert path, not a duplicate insert.)

### per-user isolation
- [x] two different users save DIFFERENT views for the SAME board; each `get`
  returns only their OWN view (no cross-user leak; `user_id` is always the
  caller, never an input).

### config round-trips through JSONB correctly (incl stringify)
- [x] after `set`, read the `board_views` row DIRECTLY from the db and assert
  `row.config` is a PARSED object equal to the sent config (confirms the
  `JSON.stringify` insert path, activity B1; pg-mem would accept a raw object too,
  so this asserts the round-trip — the stringify is the real prod guard, keep it).
- [x] arrays + nested values survive the round-trip:
  `config.labelIds`/`assigneeIds` come back as arrays, `due`/`swimlaneBy` come
  back as the stored string or `null`.

### permission — cannot save/get a view for a board you cannot see
- [x] `get` for a board the caller has NO access to → NOT_FOUND
  (`BoardViewError.BOARD_NOT_FOUND`), no existence leak (private board).
- [x] `set` for a board the caller has NO access to → NOT_FOUND; NO row written
  (assert the `board_views` table has no row for that pair afterwards).
- [x] a `view`-only member CAN `set` and `get` their own view (board `view` is
  enough — a saved view is a personal preference, not a board mutation).

### invalid mode / config rejected by Zod (a malformed config can't corrupt rendering)
- [x] `set` with `mode: "gantt"` (not in the enum) → `BAD_REQUEST` (Zod), no row
  written.
- [x] `set` with `config.due: "someday"` (not in the due enum) → `BAD_REQUEST`,
  no row written.
- [x] `set` with an UNKNOWN config key (e.g. `config.evil: 1`) → `BAD_REQUEST`
  (the `.strict()` schema rejects unknown keys), no row written.
- [x] `set` with `config.swimlaneBy: "color"` (not label/assignee) → `BAD_REQUEST`.
- [x] a partial config (e.g. `config: { labelIds: ["L1"] }`) is NORMALIZED by the
  schema defaults to a complete config (`assigneeIds: []`, `due: null`, etc.) and
  stored complete — `get` returns the full shape.

### defensive read of a stale stored row
- [x] manually INSERT a `board_views` row with a `config` that fails the strict
  schema (e.g. an extra key, or `mode: "gantt"`) via raw db, then `get` → returns
  `defaultBoardView` (does NOT throw / 500) and logs the parse-failure event.

### cascade
- [x] deleting the board (permanent `boards.delete`) cascades the user's
  `board_views` row away.
- [x] deleting the user cascades their `board_views` rows away.

### migration
- [x] `migrations/019.board-view.spec.ts`: up creates table + composite PK; jsonb
  config round-trip via `JSON.stringify`; duplicate `(user_id, board_id)` insert
  rejected by the PK; user-delete → cascade; board-delete → cascade; down drops.

## 8. Verify
- [x] `pnpm --filter shared build`
- [x] `pnpm --filter backend test` green (upsert/get-default/isolation/jsonb
  round-trip/permission/zod-reject on pg-mem).
- [x] `pnpm --filter backend migrate` auto-discovers `019.board-view` (the live
  runner globs `migrations/` — `scripts/migrate.script.ts`; verified via the
  pg-mem migration spec; live Postgres not run locally).
- [x] Swagger shows `GET /boards/{boardId}/view` and `PUT /boards/{boardId}/view`.
