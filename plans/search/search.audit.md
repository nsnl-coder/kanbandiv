# Global Search & Filters — Production-Readiness Audit

Audit of `search.backend.md` + `search.frontend.md` against the real codebase
before build. Severity: **BLOCKER** (build cannot ship / suite breaks), **HIGH**
(security or correctness leak), **MED** (correctness/robustness), **LOW** (polish).
Every claim below was verified by reading the cited real file or by an empirical
pg-mem probe.

---

## TOP PRIORITY — pg-mem vs tsvector migration (RESOLVED)

### Finding (BLOCKER, confirmed empirically)
`newTestDb` (`features/auth/test/helpers.ts:31-59`) applies `up001..up016`
**inline, in sequence, with no try/catch**. The whole backend suite (~543 tests)
boots every DB through this. Migration 017 as drafted adds a
`tsvector GENERATED ALWAYS AS (...) STORED` column + GIN index. I probed the
installed `pg-mem@3.0.5` directly:

```
FAIL :: ALTER TABLE cards ADD COLUMN sv tsvector  ::  type "tsvector" does not exist
FAIL :: SELECT to_tsvector('english','x')         ::  function to_tsvector(text,text) does not exist
FAIL :: CREATE INDEX ... USING gin (...)          ::  (column never created)
FAIL :: SELECT websearch_to_tsquery('english','x')::  function websearch_to_tsquery does not exist
FAIL :: SELECT ts_rank(...)                        ::  function ts_rank does not exist
```

So if 017 is added to `newTestDb` as-is it throws at boot and **every test that
calls `newTestDb` fails**, not just search tests. This is the single biggest risk
in the feature and the original plan's "wrap up017 in try/catch inside helpers.ts"
was under-specified and leaky (it would also swallow real bugs in 017).

### What I also probed (the decision rests on these facts)
- pg-mem **cannot** register the `tsvector` type — the type name itself is
  rejected; there is no public `registerType` that makes `tsvector` resolvable.
  So "teach pg-mem tsvector" (option a-variant) is **not viable**.
- pg-mem **lacks** `version()`, `to_regtype()`, and `current_setting()` — every
  standard SQL dialect-probe also throws. So you cannot branch by querying server
  identity. **But that absence is itself the signal**: a `try { real DDL } catch`
  reliably separates pg-mem from real Postgres.
- pg-mem **does** support `GENERATED ALWAYS AS (<expr>) STORED` on a **plain
  `text`** column, and supports registering stub SQL functions.
- Probe of the end-to-end fallback: real DDL throws → catch runs
  `ALTER TABLE cards ADD COLUMN search_vector text` → inserts succeed → the
  no-text query path (`SELECT ... ORDER BY updated_at`) returns rows → selecting
  the stub `search_vector` column returns `null` without crashing. **Validated.**

### DECISION (final, unambiguous) — option (b) implemented INSIDE migration 017
**The migration self-detects via try/catch and degrades; `newTestDb` keeps
calling `up017` exactly like every other migration (NO special-casing in
helpers.ts).** Concretely, `017.card-search.ts`:

```ts
export async function up(db: Kysely<any>): Promise<void> {
  try {
    // Real Postgres path: generated tsvector + GIN.
    await sql`
      ALTER TABLE cards ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(description, '')), 'B')
        ) STORED
    `.execute(db);
    await sql`CREATE INDEX cards_search_vector_idx ON cards USING gin (search_vector)`.execute(db);
  } catch (err) {
    // pg-mem (tests) has no tsvector/GIN. Degrade to a plain nullable text
    // column so the column EXISTS and no-text-path queries still run. Full-text
    // behavior is exercised on live Postgres only (CLAUDE.md: real search runs
    // on dev/prod). Re-throw if this is NOT the known pg-mem limitation.
    if (!/tsvector|gin|generated/i.test(String((err as Error).message))) throw err;
    await sql`ALTER TABLE cards ADD COLUMN search_vector text`.execute(db);
  }
}
```

Why this and not the alternatives:
- **NOT** "skip up017 in newTestDb": the production query references
  `cards.search_vector`; if the column is absent under pg-mem, the no-text
  visibility/filter/pagination query (which selects/needs the chain but NOT the
  vector) is fine, but any accidental select of the column, and the migration
  spec, get messier. Having the column exist (as text) keeps the test DB schema
  shape-compatible with production and lets permission/filter/pagination tests run
  the *real* repo function unmodified (with `hasText=false`).
- **NOT** try/catch in helpers.ts: that swallows ALL errors from 017 including a
  genuinely broken migration, and duplicates the logic the migration should own.
  Keeping it in the migration means there is ONE place, it is guarded to only
  swallow the known tsvector/gin/generated message, and helpers.ts stays a plain
  `up001..up017` list.
- The `err.message` guard means a real, unexpected failure on live Postgres still
  throws (no silent prod breakage).

### Reconciling "can permission/filter tests exercise the real query?"
Yes — **the query is structured so the ONLY Postgres-full-text-specific parts
(`@@`, `ts_rank`, `ts_headline`, reading `search_vector`) live exclusively in the
`hasText === true` branch.** When `hasText === false` the repo builds a query that
touches only the chain joins, the EXISTS visibility predicate, the filter
predicates, `order by updated_at`, and limit/offset — all pg-mem-compatible.
Therefore:
- Permission scoping, filters, pagination, no-N+1, empty/short-query, scope-leak:
  **all run the REAL `searchCards` repo function on pg-mem with `hasText=false`.**
- Text matching + ranking + snippet: covered by (1) a compiled-SQL assertion (the
  query string contains `websearch_to_tsquery`, `@@`, `ts_rank`) and (2) a noted
  live-Postgres-only manual/e2e check. These are NOT run against pg-mem.

This satisfies the hard requirement: **the full existing ~543-test suite still
passes on pg-mem after this feature**, because `up017` never throws there.

---

## Other findings

### A. Permission-scoping SQL vs `resolveBoardPermission` — VERIFIED CORRECT (HIGH area, no leak)
Cross-checked `board.service.resolveBoardPermission` (`board.service.ts:61-84`)
against the plan's EXISTS-OR block. All six view-granting paths are covered and
none is missing:

| resolveBoardPermission path | search predicate | status |
|---|---|---|
| `user.isSuperuser` (`:66`) | visibility `where` omitted entirely | OK |
| project owner (`:70`) | `projects.owner_id = userId` | OK |
| board owner (`:71`) | `boards.owner_id = userId` | OK |
| board grant (`:73`) | `EXISTS board_access (board_id, user_id)` | OK |
| project grant (`:77-78`) | `EXISTS project_access (project_id, user_id)` | OK |
| public project (`:79`) | `projects.visibility = Public` | OK |

- **EXISTS form (not leftJoin) is the right call** — it avoids row fan-out when a
  card matches both a board AND a project grant, so `ts_rank` ordering and
  limit/offset stay correct with no `distinctOn`. Confirmed against the leftJoin
  idiom in `project.repo.listProjectsForUser:51-55` (that one tolerates fan-out
  because it pulls `permission`; search must not).
- **No N+1**: the plan correctly forbids importing `loadBoardFor` /
  `resolveBoardPermission`; visibility is one set-wise query. Good.
- **Public-project subtlety** is real and correctly documented: public projects
  are NOT auto-listed (`project.repo.ts:42-43`) but ARE viewable by direct access,
  so their cards ARE searchable — matches `resolveBoardPermission:79`.

### B. `card_assignees` join column name — CORRECTION (MED)
The plan's assignee filter says `EXISTS over card_assignees`. The actual column is
**`card_assignees.user_id`** (`db/types.ts:184-188`), NOT `assignee_id`. The
filter input is named `assigneeIds` but must match on `user_id`. The rewritten
backend plan now states the column explicitly to prevent a wrong-column build.
`card_labels` columns are `card_id` / `label_id` (`db/types.ts:145-148`) — plan
correct.

### C. `db/types.ts` select-only typing — VERIFIED, minor refinement (LOW)
`CardsTable` (`db/types.ts:121-134`) has no `search_vector`. Adding
`search_vector: ColumnType<string, never, never>` is correct for a generated
column (never inserted/updated). Note for the implementer: under pg-mem the column
is plain `text` and still selects as `string | null` at runtime; the
`ColumnType<string, never, never>` read type is fine because the no-text path
never selects it. Confirm `ColumnType` is already imported in `db/types.ts`
(it is used by other generated columns). Keep the column last in the interface.

### D. Pagination shape vs `boardActivityPageSchema` — VERIFIED (LOW)
`boardActivityPageSchema` (`activity.schema.ts:74-77`) =
`{ items, nextOffset: number().nullable() }`. The plan's `searchPageSchema`
mirrors it exactly. `listBoardActivityInput` (`:56-60`) uses `limit max(100)
default(50)`; search uses `max(50) default(20)` — intentional, documented. OK.
`nextOffset = items.length === limit ? offset + items.length : null` matches the
activity has-more convention.

### E. Migration spec strategy — CLARIFIED (MED)
Existing migration specs run the real `up` on pg-mem then assert (e.g.
`009.label.spec.ts`, `015.card-cover.spec.ts:` selects `cover_color`). Because 017
now self-degrades, the spec CAN run `up(db)` on pg-mem without throwing and then
assert the **stub** column exists (`select search_vector from cards` resolves) and
that `down` drops it. The full-text DDL text is asserted separately by a
string-level check is NOT possible (the DDL is inside try/catch, not a returned
builder), so: assert (1) `up` then `select search_vector from cards` resolves,
(2) `down` then the same select rejects. The real tsvector/GIN DDL is validated
by `pnpm --filter backend migrate` against live PG. Rewritten plan states this.

### F. `websearch_to_tsquery` on hostile/empty input — VERIFIED SAFE (HIGH area)
`websearch_to_tsquery` never throws on arbitrary user text (unlike `to_tsquery`),
so quotes, operators, emoji, or junk are safe. Input is bound via `sql` tagged
template (`${q}`), so no injection. The service trims and short-circuits empty
input before the DB. The `q.max(200)` Zod bound caps payload. All good — the
rewrite keeps the parameterization explicit and adds a note that `q` is ALWAYS
interpolated via `${}`, never concatenated.

### G. Ranking correctness — VERIFIED (LOW)
Title weight A > description weight B via `setweight`, ordered by `ts_rank` desc
then `updated_at` desc then `cards.id` asc (stable tiebreaker for pagination).
Correct. Note: the no-text path has no rank and orders by `updated_at, id` — also
stable.

### H. `ts_headline` snippet XSS — VERIFIED SAFE (MED)
Decision to pass `StartSel=,StopSel=` (empty highlight markers) so the snippet is
plain text is the right call — no `<b>` tags reach the FE, no XSS surface, FE can
highlight client-side. Keep it.

---

## Frontend findings

### I. Trigger locations + zustand + Cmd/Ctrl+K — VERIFIED
- Desktop brand block: `Sidebar.tsx:63-73` (brand `Link` + user email). Search
  button slots here. Confirmed.
- Mobile header: `AppLayout.tsx:15-29` (brand + logout). Confirmed; `<SearchPalette/>`
  mounts once in `AppLayout` (it wraps `<Outlet/>` for all signed-in pages).
- zustand pattern: `useAuthStore.ts:12` uses `create<...>((set) => ...)`. The
  `useSearchStore` mirror is idiomatic. Confirmed.
- `Cmd/Ctrl+K` is **NOT** bound anywhere (grep for `metaKey|ctrlKey|"k"` → no
  matches). Safe to add. Confirmed.
- `Modal.tsx` wraps Radix Dialog (backdrop + Esc close, focus trap) — reuse it.
  Confirmed (`Modal.tsx:16-44`). Note: current `Modal` is `max-w-sm` default;
  pass a wider `widthClassName` (e.g. `max-w-2xl`) for the palette.

### J. BoardDetailPage deep-link (`?card=`) — VERIFIED, additive (MED)
`BoardDetailPage.tsx:61` holds `activeCardId` in local `useState`; opened via
`onOpenCard` (`:391`), closed via `setActiveCardId(null)` (`:458,469,474`). There
is **NO `useSearchParams`** today — the deep-link is genuinely additive. Plan
correctly scopes the only out-of-feature change to: read `?card=` on load/param
change, `setActiveCardId` if the id exists in loaded board data
(guard for `board` loaded), and clear the param on close. Confirmed safe.
Note: the card lookup (`:143`) is across `columns.flatMap(c=>c.cards)`, so the
guard "id exists in loaded board data" reuses that same find.

### K. Route shape — VERIFIED
`App.tsx:94` = `/projects/:id/boards/:boardId`. Navigation target
`/projects/${projectId}/boards/${boardId}?card=${cardId}` matches. Result row must
carry `projectId` — backend `SearchResult` includes it. Confirmed.

### L. Label/assignee filters in palette — scope note (LOW)
Labels are board-local (`LabelsTable.board_id`). The plan correctly defers
global label/assignee pickers and only wires them when a `boardId` scope is
chosen, reusing `LabelFilterBar`/`AssigneeFilterBar`. Reasonable v1 scope.

---

## Net changes applied to the plans
- Backend §1: migration 017 rewritten as self-degrading try/catch (the decision
  above); §6 helpers.ts simplified to a plain `up017` line (no try/catch there).
- Backend §3: assignee filter join column stated as `card_assignees.user_id`.
- Backend §3/§4: explicit invariant that `search_vector`/`@@`/`ts_rank`/
  `ts_headline` appear ONLY in the `hasText` branch (pg-mem compatibility).
- Backend §7: test strategy clarified — real repo runs on pg-mem with
  `hasText=false`; text path = compiled-SQL assertion + live-PG note.
- Frontend: confirmations folded in (no structural change needed; claims hold).

No feature code was written. Both plan files were rewritten in place.
