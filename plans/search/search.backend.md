# Global Search & Filters — Backend Plan

A single global search endpoint that finds **cards across every board the caller
can view**, matching `cards.title` + `cards.description`, with optional filters
(label ids, assignee ids, due state, board/project scope) and limit/offset
pagination. Results are **lean** (card id/title, its board + column names, a
snippet, due flag) — NOT full enriched `Card` payloads. The hard requirement is
**permission scoping in ONE SQL query** (no per-card N+1): a card is returned
only when the caller can view its board, where board effective permission =
`max(project inheritance, board grant)` exactly as `board.service.resolveBoardPermission`
(`board.service.ts:61`) computes it.

Mirror `features/activity` + `features/backup` patterns: `*.router.ts` /
`*.service.ts` / `*.repo.ts` + `test/<endpoint>.spec.ts`, Kysely, tRPC
`protectedProcedure`, Zod from `shared`, OpenAPI `.meta`, superjson.

**Naming (decided):** router export `searchRouter`, registered under the SINGULAR
key `search` in `trpc/router.ts` (reads as a feature name, like `activity`). FE
calls `trpc.search.cards`.

## Key decisions (decided)

### tsvector + GIN, NOT ILIKE (production-ready) — DECIDED
- `ILIKE '%q%'` cannot use a B-tree index (leading wildcard), so it does a
  sequential scan over every accessible card on every keystroke. That is the v1
  shortcut `project.repo.listProjectsForUser` (`project.repo.ts:86`) takes for a
  project-NAME filter, where the row count is tiny. CARD search runs over the
  whole `cards` table and is the app's hottest read — it must be indexed.
- Use a **generated `tsvector` column** `search_vector` on `cards`, populated from
  `title` (weight A) + `description` (weight B), with a **GIN index**. Postgres
  `GENERATED ALWAYS AS (...) STORED` keeps it in sync automatically on every
  insert/update — no triggers, no app-side maintenance, no risk of drift. This is
  the single new migration (`017.card-search`).
- Query with `websearch_to_tsquery('english', :q)` — it parses user input
  forgivingly (handles quotes, `or`, `-` negation, bad syntax never throws),
  unlike `to_tsquery` which errors on raw user text. Match = `search_vector @@
  websearch_to_tsquery(...)`. Rank with `ts_rank(search_vector, query)` so the
  best title/description matches sort first.
- **Ergonomics caveat (decided):** tsvector does lexeme matching, not substring
  ("compl" will NOT match "complete"). For a global search this is acceptable and
  standard; a prefix experience is out of scope for v1 (note it, do not build it).
  Document that the FE should send whole words.
- **Empty / short query:** if the trimmed query is empty AND no filter is set,
  return an empty page WITHOUT touching the DB (a global "match everything" scan
  is wasteful and not a useful UX). If a FILTER is set but the query is empty,
  run the visibility + filter query with NO text predicate and NO `ts_rank`
  (order by `cards.updated_at desc`) — this makes "all my overdue cards" work.
  A non-empty query shorter than 1 char after trim is treated as empty.

### Permission scoping = ONE query, mirrors resolveBoardPermission — THE CENTERPIECE
`resolveBoardPermission` (`board.service.ts:61-84`) grants board `view` (the
minimum search needs) when ANY of:
1. `user.isSuperuser` → sees ALL cards (no visibility predicate at all).
2. `projects.owner_id = user.id` (project owner).
3. `boards.owner_id = user.id` (board owner).
4. a `board_access` row exists for `(board.id, user.id)` (any permission ≥ view).
5. a `project_access` row exists for `(project.id, user.id)` (any permission ≥ view).
6. `projects.visibility = 'public'` (public project → inherited `view`).

Search only needs the BOOLEAN "can view?", not the ranked permission level, so the
6-way `max()` collapses to a single **OR of EXISTS/equality predicates**. The
query joins `cards → columns → boards → projects` and, for the grant checks, uses
the **`leftJoin … onRef … on(user_id = :userId)`** idiom already proven in
`project.repo.listProjectsForUser` (`project.repo.ts:51-55`) for `project_access`,
plus the same for `board_access`. Concretely (Kysely, in `search.repo.ts`):

```
db.selectFrom("cards")
  .innerJoin("columns", "columns.id", "cards.column_id")
  .innerJoin("boards", "boards.id", "columns.board_id")
  .innerJoin("projects", "projects.id", "boards.project_id")
  .leftJoin("board_access", (j) =>
    j.onRef("board_access.board_id", "=", "boards.id")
     .on("board_access.user_id", "=", userId))
  .leftJoin("project_access", (j) =>
    j.onRef("project_access.project_id", "=", "projects.id")
     .on("project_access.user_id", "=", userId))
  // visibility predicate — SKIP ENTIRELY when user.isSuperuser:
  .where((eb) => eb.or([
    eb("projects.owner_id", "=", userId),
    eb("boards.owner_id", "=", userId),
    eb("board_access.user_id", "is not", null),   // board grant matched
    eb("project_access.user_id", "is not", null), // project grant matched
    eb("projects.visibility", "=", ProjectVisibility.Public),
  ]))
```

- **No N+1:** visibility is resolved set-wise in the SQL — there is NO call to
  `resolveBoardPermission` / `loadBoardFor` per card. This is the whole point.
- **No leak:** a card on a private board the caller has no row for fails ALL six
  OR branches and is never returned (rows the FE cannot see also never appear in
  the total count — see pagination). Mirrors the "private boards must not leak"
  rule (`board.service.ts:101`).
- **Superuser:** when `user.isSuperuser`, the visibility `where` is omitted
  entirely → every card is searchable. (The leftJoins still run harmlessly.)
- **Public projects:** branch 6 returns their cards to any authenticated caller,
  matching `resolveBoardPermission` line 79 (`visibility === Public → view`).
  This is the documented behavior even though such projects are not auto-listed in
  the sidebar (`project.repo.ts:42-43`) — they ARE viewable by direct access, so
  their cards ARE searchable. State this in tests.
- **DISTINCT note:** a card can match BOTH a board grant and a project grant
  (two leftJoin rows), duplicating the card. De-dup with `.distinctOn("cards.id")`
  + matching leading `orderBy("cards.id")`, OR group by card id. **Decided:**
  use a single `EXISTS` subquery per grant instead of leftJoins to avoid row
  multiplication AND keep `ts_rank` ordering clean — see "implementation note"
  below. Either is acceptable; the EXISTS form is preferred because it composes
  with `order by ts_rank` without a `distinctOn`/`orderBy` collision.

**Implementation note (preferred final form):** keep the three `innerJoin`s
(`columns`/`boards`/`projects` are 1:1 up the chain, no multiplication), and
express the two grant checks as correlated `EXISTS` subqueries so there is NO
fan-out and ordering by `ts_rank` is unconstrained:

```
.where((eb) => eb.or([
  eb("projects.owner_id", "=", userId),
  eb("boards.owner_id", "=", userId),
  eb("projects.visibility", "=", ProjectVisibility.Public),
  eb.exists(eb.selectFrom("board_access")
    .whereRef("board_access.board_id", "=", "boards.id")
    .where("board_access.user_id", "=", userId).select("board_access.user_id")),
  eb.exists(eb.selectFrom("project_access")
    .whereRef("project_access.project_id", "=", "projects.id")
    .where("project_access.user_id", "=", userId).select("project_access.user_id")),
]))
```

### Filters compose with AND on top of the visibility + text predicate — DECIDED
- `labelIds: string[]` — card has AT LEAST ONE of the given labels:
  `eb.exists(selectFrom("card_labels").whereRef("card_id","=","cards.id")
  .where("label_id","in",labelIds))`. (OR-within-filter, matching the board's
  `cardMatchesLabels` "any selected" behavior — `board/utils`.)
- `assigneeIds: string[]` — card has AT LEAST ONE of the given assignees:
  same `EXISTS` over `card_assignees`. **The match column is
  `card_assignees.user_id`** (NOT `assignee_id` — verified `db/types.ts:184-188`),
  i.e. `whereRef("card_assignees.card_id","=","cards.id").where("card_assignees.user_id","in",assigneeIds)`.
- `due: "overdue" | "due_soon" | "has_due"` (optional single value):
  - `overdue`: `cards.due_at is not null AND cards.due_at < now`.
  - `due_soon`: `cards.due_at >= now AND cards.due_at <= now + 24h` (mirror the
    "due soon" window used by the reminder feature; 24h is the decided window —
    state it). Pass `now` from the service (`new Date()`) so tests are
    deterministic, not `sql\`now()\`.
  - `has_due`: `cards.due_at is not null`.
- `projectId?: string` / `boardId?: string` — scope: add
  `boards.project_id = projectId` / `boards.id = boardId`. These NARROW the
  already-visibility-scoped set; they do NOT widen it (a scoped board the user
  cannot view still returns nothing). State in tests.
- All filters are ANDed together and ANDed with the visibility + text predicates.
  Each is applied only when present (build the query incrementally like
  `backup.repo.listRuns` `backup.repo.ts:144-149`).

### Pagination = limit/offset, page shape mirrors activity — DECIDED
- Input `{ limit (1..50, default 20), offset (>=0, default 0) }` — same bounds
  style as `listBoardActivityInput` (activity.schema). Lower max (50) than
  activity (100) because each result needs board/column name joins.
- Output `{ items: SearchResult[], nextOffset: number | null }` where
  `nextOffset = items.length === limit ? offset + items.length : null` (identical
  has-more signal to `boardActivityPageSchema`). NO separate total-count query in
  v1 (an accurate count requires running the full predicate without limit — a
  second scan; the `nextOffset` signal is enough for "Load more"). Note the
  tradeoff: no exact "N results" label. If a count is wanted later, add a
  `count(*)` over the same predicate as a follow-up.

### Lean results, no enrichment — DECIDED
- Do NOT call `enrichCards` (`card.enrich.ts:28`) — it batches labels, assignees,
  checklist progress, comment/attachment counts and image-cover resolution, which
  is far more than a result row needs and would re-introduce per-result work.
- Each `SearchResult` = `{ cardId, title, snippet, boardId, boardName,
  columnId, columnName, projectId, dueAt, isOverdue }`. `boardName`/`columnName`
  come free from the existing chain joins. `snippet` via `ts_headline('english',
  coalesce(description, title), query, 'MaxFragments=1,MaxWords=18,MinWords=5')`
  when a text query is present; when no text query, snippet = first ~140 chars of
  `description` (or the title) computed in JS. `isOverdue` computed in the service
  from `due_at` + the service `now` (reuse the `isOverdue` rule from
  `card.enrich.ts:23`).

## API endpoints
- [x] `GET /search/cards` — search accessible cards by title/description with optional filters (label/assignee/due/project/board scope) + limit/offset; returns `{ items, nextOffset }` (auth required; visibility enforced in-query)

One endpoint only. No write endpoints — search is read-only.

## 1. Database (migration + db types)

> **pg-mem reality (probed against `pg-mem@3.0.5`, the installed version):**
> pg-mem rejects the `tsvector` TYPE itself ("type tsvector does not exist") and
> has no `to_tsvector` / `websearch_to_tsquery` / `ts_rank` / `ts_headline` / GIN.
> It ALSO lacks `version()`, `to_regtype()`, `current_setting()` (no dialect
> probe). It DOES support `GENERATED ALWAYS AS (...) STORED` on a plain `text`
> column. `newTestDb` (`features/auth/test/helpers.ts:31-59`) runs `up001..up016`
> inline with NO try/catch, so a throwing `up017` breaks the ENTIRE ~543-test
> suite, not just search. The migration MUST therefore self-degrade.

- [x] `migrations/017.card-search.ts` (next free number is 017; highest existing
  is `016.activity`). Uses the `sql` import like `002.rbac.ts:1`. This migration
  ONLY alters `cards` (no new table). **It self-detects pg-mem via try/catch and
  degrades** so it never throws under the test harness while still building the
  real index on Postgres:
  ```ts
  export async function up(db: Kysely<any>): Promise<void> {
    try {
      await sql`
        ALTER TABLE cards ADD COLUMN search_vector tsvector
          GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B')
          ) STORED
      `.execute(db);
      await sql`CREATE INDEX cards_search_vector_idx ON cards USING gin (search_vector)`.execute(db);
    } catch (err) {
      // pg-mem (tests): no tsvector/GIN. Degrade to a plain text column so the
      // column EXISTS and the no-text query path runs. Full-text behavior is
      // validated on live Postgres only (CLAUDE.md). Re-throw anything that is
      // NOT the known pg-mem limitation so a real prod failure is not swallowed.
      if (!/tsvector|gin|generated/i.test(String((err as Error).message))) throw err;
      await sql`ALTER TABLE cards ADD COLUMN search_vector text`.execute(db);
    }
  }
  export async function down(db: Kysely<any>): Promise<void> {
    await sql`DROP INDEX IF EXISTS cards_search_vector_idx`.execute(db);
    await sql`ALTER TABLE cards DROP COLUMN IF EXISTS search_vector`.execute(db);
  }
  ```
  - Kysely's schema builder has no generated-column helper, so raw `sql` is
    required (proven pattern: `002.rbac.ts:42` runs raw `CREATE UNIQUE INDEX ...`
    through pg-mem inside `newTestDb` successfully).
  - The error-message guard is the whole safety net: on live Postgres the real
    DDL succeeds; only the specific pg-mem "type does not exist" class is caught.
    An unexpected prod failure still throws.
- [x] `db/types.ts` — add `search_vector` to `CardsTable` as a SELECT-only,
  non-insertable column: `search_vector: ColumnType<string, never, never>`
  (generated column → never written by the app). Keep it LAST in `CardsTable`
  (`db/types.ts:121-134`). `ColumnType` is already imported (used by other
  generated columns). No `Database` interface change (cards already registered).
  Note: under pg-mem this column is a nullable `text` at runtime; the read-only
  path never selects it on the no-text branch, so the typing is safe.
- [x] `migrations/017.card-search.spec.ts` (LIVES IN `src/migrations/`, mirror
  `009.label.spec.ts` + `015.card-cover.spec.ts`). Because 017 self-degrades, the
  spec runs the REAL `up(db)` on pg-mem (it will take the text-column fallback)
  and asserts: (1) after `up`, `sql\`select search_vector from cards\`.execute(db)`
  RESOLVES (column exists); (2) after `down`, the same select REJECTS (column
  dropped). The real tsvector/GIN DDL is validated against live Postgres via
  `pnpm --filter backend migrate` — do NOT pretend pg-mem runs tsvector.

## 2. Shared schemas + errors (`packages/shared`)
- [x] `src/search.schema.ts`:
  - `dueFilterSchema` = `z.enum(["overdue", "due_soon", "has_due"])`.
  - input `searchCardsInput` = `z.object({ q: z.string().max(200).default(""),
    labelIds: z.array(z.string()).optional(), assigneeIds: z.array(z.string()).optional(),
    due: dueFilterSchema.optional(), projectId: z.string().optional(),
    boardId: z.string().optional(), limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0) })`. (Bounds mirror
    `listBoardActivityInput`.)
  - output `searchResultSchema` = `{ cardId: z.string(), title: z.string(),
    snippet: z.string(), boardId: z.string(), boardName: z.string(),
    columnId: z.string(), columnName: z.string(), projectId: z.string(),
    dueAt: z.date().nullable(), isOverdue: z.boolean() }`.
  - output `searchPageSchema` = `{ items: z.array(searchResultSchema),
    nextOffset: z.number().nullable() }`.
  - export inferred types: `export type SearchCardsInput`,
    `export type SearchResult`, `export type SearchPage`.
- [x] `src/errors/search.error.ts` — `SearchError` `as const` (mirror
  `errors/activity.error.ts`): currently only a placeholder — search has no
  domain NOT_FOUND (an inaccessible scope just yields empty results, it does NOT
  throw, to avoid leaking existence). If `projectId`/`boardId` reference a
  nonexistent or inaccessible scope, return an EMPTY page (no error) — document
  this. Keep the file minimal/empty-export for symmetry, or omit it if no error
  is needed (decide: omit, since no error is thrown — note that decision here).
- [x] `src/index.ts` — add `export * from "./search.schema.js";` (the barrel
  exports each file explicitly — see `index.ts`; no auto-discovery).
- [x] `pnpm --filter shared build` so backend + frontend pick up the new types.

## 3. Repo (`features/search/search.repo.ts`)

> **pg-mem-compat invariant (load-bearing):** `search_vector`, the `@@` operator,
> `ts_rank`, and `ts_headline` MUST appear ONLY inside the `hasText === true`
> branch. The `hasText === false` query path touches ONLY the chain joins, the
> EXISTS visibility predicate, the filter predicates, `order by updated_at, id`,
> and limit/offset — all pg-mem-supported. This is what lets the permission /
> filter / pagination / no-N+1 tests run the REAL repo function on pg-mem.

- [x] `Db = Kysely<Database>` (mirror other repos).
- [x] `searchCards(db, opts)` where
  `opts = { userId, isSuperuser, q, hasText, labelIds?, assigneeIds?, due?,
  projectId?, boardId?, now, limit, offset }`. Build ONE query:
  - base: `selectFrom("cards").innerJoin("columns",…).innerJoin("boards",…)
    .innerJoin("projects",…)` (the chain).
  - select: `cards.id`, `cards.title`, `cards.description`, `cards.due_at`,
    `columns.id as column_id`, `columns.name as column_name`,
    `boards.id as board_id`, `boards.name as board_name`,
    `projects.id as project_id`. When `hasText`: also select
    `sql\`ts_rank(cards.search_vector, websearch_to_tsquery('english', ${q}))\`.as("rank")`
    and `sql\`ts_headline('english', coalesce(cards.description, cards.title),
    websearch_to_tsquery('english', ${q}), 'MaxFragments=1,MaxWords=18,MinWords=5')\`.as("snippet")`.
  - visibility predicate: apply the EXISTS-based OR block (see centerpiece) ONLY
    when `!isSuperuser`.
  - text predicate: when `hasText`, add
    `where(sql\`cards.search_vector @@ websearch_to_tsquery('english', ${q})\`)`.
  - filter predicates: label/assignee `EXISTS`, due window, project/board scope —
    each applied only when present (incremental, like `backup.repo.listRuns`).
  - order: `hasText` → `orderBy(sql\`rank\`, "desc").orderBy("cards.updated_at","desc")`;
    else → `orderBy("cards.updated_at", "desc")`. Add `orderBy("cards.id","asc")`
    as a stable tiebreaker for deterministic pagination.
  - `.limit(limit).offset(offset).execute()`.
  - All user input (`q`, ids, `now`) is bound via Kysely params / `sql` tagged
    template interpolation — NEVER string-concatenated (no SQL injection; tsquery
    text is parameterized).

## 4. Service (`features/search/search.service.ts`)
- [x] `CtxUser = { id: string; isSuperuser: boolean }` (mirror `board.service.ts:21`).
- [x] `searchCards(db, user, input)`:
  - `const q = input.q.trim()`. `const hasText = q.length > 0`.
  - `const hasFilter = !!(input.labelIds?.length || input.assigneeIds?.length ||
    input.due || input.projectId || input.boardId)`.
  - **Short/empty guard:** if `!hasText && !hasFilter` → return
    `{ items: [], nextOffset: null }` WITHOUT a DB call.
  - `const now = new Date()`.
  - call `repo.searchCards({ userId: user.id, isSuperuser: user.isSuperuser, q,
    hasText, …input, now })`.
  - map rows → `SearchResult`: `isOverdue` via the `card.enrich.ts:23` rule
    (`due_at != null && due_at < now`); `snippet` = row.snippet (text path) OR
    JS-trim of `description ?? title` to ~140 chars (no-text path). Strip the
    `<b>…</b>` highlight tags from `ts_headline` OR keep them and let the FE
    render — **decided: keep them OFF** (pass `StartSel=,StopSel=` to
    `ts_headline` so the snippet is plain text; the FE highlights itself or shows
    plain — simpler, no XSS surface). State this.
  - compute `nextOffset = items.length === input.limit ? input.offset + items.length : null`.
  - return `{ items, nextOffset }`.
- [x] Do NOT import `loadBoardFor` / `resolveBoardPermission` — visibility is in
  SQL. Importing them would re-introduce N+1 (anti-goal).

## 5. Router (`features/search/search.router.ts`)
- [x] tRPC `searchRouter`. Mirror `activity.router.ts` `user(ctx)` helper +
  `.meta` openapi shape. One `.query` (read-only):
  - `cards` — `protectedProcedure`, `.meta` openapi GET `/search/cards`,
    `tags: ["search"]`, `protect: true`, input `searchCardsInput`, output
    `searchPageSchema`, `.query` → `searchCards(ctx.db, user(ctx), input)`.
- [x] Register `search: searchRouter` in `trpc/router.ts` (add import + line in
  `appRouter`; `router.ts:17-33`). Key is SINGULAR `search`.

## 6. Test-harness wiring (REQUIRED — do not skip)
- [x] `features/auth/test/helpers.ts` — `newTestDb` hardcodes `up001..up016`
  (imports lines 10-25, calls lines 43-58). Add `up017` as a PLAIN line, exactly
  like the others — **NO try/catch in helpers.ts**:
  - `import { up as up017 } from "../../../migrations/017.card-search.js";`
  - `await up017(db);` after `await up016(db);`
  - This is safe because `017.card-search.ts` ITSELF self-degrades (see §1): on
    pg-mem it falls back to a plain `text search_vector` column and never throws.
    Keeping the catch INSIDE the migration (guarded to only swallow the known
    tsvector/gin/generated message) means there is ONE code path, helpers.ts stays
    a clean `up001..up017` list, and a genuinely broken migration still surfaces.
  - Result: the existing ~543-test suite keeps passing because boot never throws;
    the `search_vector` column exists (as text) so the real repo runs unmodified
    on the `hasText=false` path.
- [x] Because `@@` / `ts_rank` / `ts_headline` don't exist in pg-mem,
  `search.service.searchCards` is fully testable with `hasText=false`
  (filters / visibility / pagination / no-N+1) on pg-mem. The `hasText=true` path
  is covered by (a) a compiled-SQL assertion (`.compile().sql` contains
  `websearch_to_tsquery`, `@@`, `ts_rank`) and (b) a note that full-text behavior
  is validated against live Postgres only (per `CLAUDE.md`).

## 7. Tests (pg-mem, mirror `features/activity/test` + `board/test/helpers`)
Reuse `seedUser`/`seedBoard`/`seedBoardAccess`/`seedColumn`/`seedCard` and the
project/access seed helpers from `board/test/helpers` (+ project_access seeding).
Drive the REAL service via `createCaller` with `makeContext({ db, userId })`.

### text matching (NOT runnable on pg-mem — compiled-SQL assertion + live-PG note)
> These cannot execute on pg-mem (`@@`/`ts_rank`/`ts_headline` absent). Cover them
> by asserting the COMPILED SQL of the `hasText=true` query, and document the
> behavioral checks as live-PG/manual. Do NOT mark them as passing on pg-mem.
- [x] match by TITLE: assert the compiled `hasText=true` query string contains
  `websearch_to_tsquery('english', $n)` and `search_vector @@`; behavioral
  "Deploy pipeline" match verified on live PG (manual/e2e).
- [x] match by DESCRIPTION: card whose description contains "kubernetes" is
  returned for `q="kubernetes"`; a card matching neither is NOT returned.
- [x] ranking: a title match ranks above a description-only match for the same
  term (weight A > B) — live PG assertion.
- [x] snippet present and plain-text (no `<b>` tags) on a text match.

### empty / short query
- [x] `q=""` AND no filter → empty page, and the repo is NOT called
  (`vi.spyOn(repo, "searchCards")` → `not.toHaveBeenCalled`).
- [x] `q="   "` (whitespace) trimmed to empty, no filter → empty page, no DB call.
- [x] `q=""` WITH a filter (e.g. `due="overdue"`) → runs the no-text path,
  returns matching cards ordered by `updated_at desc`.

### filters
- [x] filter by `labelIds` → only cards carrying at least one of the labels.
- [x] filter by `assigneeIds` → only cards with at least one of the assignees.
- [x] `due="overdue"` → only cards with `due_at < now`; `due="due_soon"` → within
  the 24h window; `due="has_due"` → any non-null `due_at`. Use a fixed seeded
  `due_at` relative to a controlled clock.
- [x] `projectId` scope narrows to that project; `boardId` scope narrows to that
  board; a scope the user cannot view returns EMPTY (no error, no leak).
- [x] multiple filters compose with AND (label + assignee + due together).

### permission scoping (THE CORE — all on pg-mem, no text needed)
- [x] OWN board: user sees cards on a board they own.
- [x] BOARD GRANT: user with a `board_access` `view` grant sees that board's cards.
- [x] PROJECT GRANT (inheritance): user with `project_access` but NO `board_access`
  sees the project's board cards (inherited view).
- [x] PROJECT OWNER: project owner sees cards on a board they did NOT create.
- [x] PUBLIC PROJECT: any authenticated user sees cards on a public project's
  boards with NO explicit grant.
- [x] NO LEAK: user A does NOT see cards on user B's PRIVATE board (no grant, not
  public) — the card is absent from items AND does not affect `nextOffset`.
- [x] SUPERUSER: a superuser sees ALL cards across all boards including private
  ones with no grant.
- [x] de-dup: a card on a board where the user has BOTH a board grant AND a
  project grant appears exactly ONCE (validates the EXISTS form has no fan-out).

### pagination
- [x] seed > limit matching cards; page 1 (`offset=0`) returns `limit` items with
  `nextOffset=limit`; page 2 returns the remainder with `nextOffset=null`.
- [x] deterministic order across pages (no duplicates / no skips) — relies on the
  `cards.id` tiebreaker.

### no N+1
- [x] seed N accessible cards across M boards; `vi.spyOn(repo, "searchCards")` →
  `toHaveBeenCalledTimes(1)` (single query; service does NOT call
  `loadBoardFor`/`resolveBoardPermission` per card — spy those too and assert
  zero calls).

### migration
- [x] `migrations/017.card-search.spec.ts`: runs the REAL `up(db)` on pg-mem
  (takes the text fallback) and asserts `select search_vector from cards`
  RESOLVES; after `down`, the same select REJECTS. The tsvector/GIN DDL is
  validated on live PG via `pnpm --filter backend migrate` (noted in the spec).

## 8. Verify
- [x] `pnpm --filter shared build`
- [x] `pnpm --filter backend test` green (visibility/filter/pagination on pg-mem;
  text path asserted via compiled-SQL / skipped with note).
- [x] `pnpm --filter backend migrate` applies `017.card-search` against LIVE
  Postgres (the live runner globs `migrations/` — `scripts/migrate.script.ts`);
  full-text behavior verified there, NOT on pg-mem (per `CLAUDE.md`).
- [x] Swagger shows the new `GET /search/cards` route.
</content>
</invoke>
