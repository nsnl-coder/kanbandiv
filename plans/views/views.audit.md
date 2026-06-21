# Saved Views — Production-Readiness Audit

Audit of `views.backend.md` + `views.frontend.md` against the ACTUAL codebase.
Every referenced file was opened and each load-bearing claim verified. One
empirical pg-mem probe was run (and removed) to settle the ON CONFLICT question.

## Verdict

Both plans are largely accurate. The JSONB-upsert, permission-isolation,
archived-exclusion, and save/hydrate-loop designs are sound and match real code.
**pg-mem DOES support the upsert** (composite PK + jsonb + `onConflict().doUpdateSet()`
+ `returningAll()`) — verified empirically — so NO select-then-write fallback is
needed. A handful of accuracy fixes were applied; one real bug found (FE swimlane
`members` source). Details + severities below.

## Empirical pg-mem probe (the key risk)

Wrote a throwaway spec (`src/migrations/__pgmem_probe.spec.ts`, since deleted)
using the SAME Kysely + pg-mem setup as `016.activity.spec.ts`:
- `create table ... constraint board_views_pkey primary key (user_id, board_id)`
  with a `jsonb` config column.
- `insertInto(...).onConflict(oc => oc.columns(["user_id","board_id"]).doUpdateSet({...})).returningAll()`
  called twice for the same pair.

Result: **2 tests PASSED.**
- Second upsert UPDATED the same row (1 row total, new mode + config).
- `returningAll()` returned `config` as a PARSED object (jsonb read auto-parses).
- A duplicate plain insert of the same pair was rejected by the composite PK.

Conclusion: `ON CONFLICT (user_id, board_id) DO UPDATE` works on pg-mem with the
exact syntax the plan specifies. The repo can use the upsert directly. NO
fallback. (This also matches the real `repo.upsertBoardAccess`
(`board.repo.ts:151-164`) and `repo.upsertAccess` (`project.repo.ts:150-157`),
both `oc.columns([...]).doUpdateSet({...})`, already shipping.)

## Verified-correct claims (no change needed)

| Claim | Evidence |
|---|---|
| JSONB needs `JSON.stringify` on insert; column typed `ColumnType<T,string,string>` | `activity.recorder.ts:38`, `db/types.ts:251` |
| Kysely reads jsonb back as a PARSED object — no manual parse on read | `activity.repo.ts` `selectAll()` (no parse); `016.activity.spec.ts:97-106` asserts `row.meta` toEqual object |
| UPDATE path of the upsert is jsonb too → must `JSON.stringify` in `doUpdateSet` | jsonb column; probe confirmed stringify works on both paths |
| `cards.due` reuse: input `listDueCardsInput`, output `z.array(cardSchema)`, board `view` | `card.router.ts:22-26`, `card.service.ts:245-261` |
| `listDueCards` already EXCLUDES archived card + column + board | `card.repo.ts:111-113` |
| `getBoardData` enriched cards carry labels/assignees/dueAt/isOverdue/cover/counts | `card.enrich.ts:83-101` |
| `getBoardData` EXCLUDES archived cards (and 404s an archived board) | `card.repo.ts:48`, `board.service.ts:154` |
| `loadBoardFor(...,"view")` 404s an inaccessible/private board (no leak) | `board.service.ts:113-121` |
| FE filter state `labelFilter`/`assigneeFilter`/`assignedToMe` exists | `BoardDetailPage.tsx:61-63` |
| FE helpers `cardMatchesLabels`/`cardMatchesAssignees`/`cardAssignedToUser`/`dueState` exist + reusable | `utils.ts:62,110,100,125` |
| `dueState` returns `"soon"` within a 24h window — FE `due_soon` maps to it | `utils.ts:125-131` |
| search due vocab `["overdue","due_soon","has_due"]` matches plan | `search.schema.ts:3` |
| Badges `DueDateBadge`/`LabelBadge`/`AssigneeStack` exist + reusable | `features/board/components/*.tsx` |
| Test helper hardcodes up001..up018; add `up019` after | `auth/test/helpers.ts:27,62` |
| Activity error `as const` pattern; shared barrel is explicit (no auto-discovery) | `errors/activity.error.ts`, `shared/src/index.ts:1-29` |
| `LogEvent.ActivityRecordFailed` const exists; add a new event the same way | `config/const.config.ts:20` |
| Composite-PK upsert syntax matches a real shipping example | `board.repo.ts:160-161`, `project.repo.ts:153-154` |

## Issues found + fixes applied

### H1 (HIGH) — FE swimlane-by-assignee `members` source is wrong
`views.frontend.md` §8 passes a `members` prop for assignee lanes. The page's
`members` (`BoardDetailPage.tsx:96-98`) is `MentionMember[] = { name }[]` derived
from `accessQuery` — it has NO user id, so it cannot key assignee lanes.
The enriched cards already carry `assignees: { id, email }[]`
(`assignee.schema.ts:21-25`, `card.enrich.ts:94`). 
Fix: derive assignee lanes from the (filtered) cards' own `assignees` (id for the
lane key, email local-part for the label). Drop the `members` prop dependency for
lane construction. Applied to FE §8.

### M1 (MEDIUM) — defensive read uses `boardViewSchema`, but a stale `mode` is a separate failure mode
Plan §4 re-parses `{ mode: row.mode, config: row.config }` through
`boardViewSchema`. Correct, but make explicit that BOTH a bad `mode` (column is
plain `text`, not enum-constrained at the DB) AND a bad `config` fall back to
`defaultBoardView`. Clarified the fallback covers the `mode` text column too, and
that the new `LogEvent.BoardViewParseFailed` const must be ADDED to
`const.config.ts` (it does not exist yet — confirmed). Applied to BE §4.

### M2 (MEDIUM) — jsonb DEFAULT vs NOT NULL interaction on the upsert
`config jsonb notnull default '{}'` is fine, but the repo ALWAYS sends a full
stringified config (Zod fills defaults), so the column default is never relied on
at write time. Kept the default (defensive for hand-inserted rows) and noted the
repo never sends `undefined` for `config`. Applied a clarifying note to BE §1/§3.

### L1 (LOW) — line-number drift in references
FE inline kanban filter is at `BoardDetailPage.tsx:408-413` (plan says 407-413);
filter bar block around `:386-387`. State `assignedToMe` at `:63`. These are off
by 1-2 lines. Updated the references to ranges to stay robust.

### L2 (LOW) — shared file location convention
`shared.md` nominally puts schemas under `validations/`, but the ACTUAL repo keeps
them flat at `shared/src/*.schema.ts` (e.g. `activity.schema.ts`, `search.schema.ts`).
The plan's `src/board-view.schema.ts` correctly follows the REAL convention. No
change; noted so a reviewer does not "fix" it to `validations/`.

### L3 (LOW) — calendar `due` predicate is a no-op, keep it harmless
FE §7: all `cards.due` results have a due date, so applying `cardMatchesDue` is
harmless except for the `due` value chosen in the filter bar (e.g. user picked
"overdue" while in calendar). Decided: in calendar, apply label/assignee/
assigned-to-me predicates but SKIP the `due` predicate (the calendar's axis IS
due-date; re-filtering by due would hide cards the month grid is meant to show).
Clarified in FE §7.

## pg-mem caveats already handled by the codebase (no action)
- `listDueCards` notes a pg-mem planner bug with `IS NOT NULL` + range on the same
  column and omits the redundant null check (`card.repo.ts:107-108`). The
  board-view feature does no such range query, so it is unaffected.
- `gen_random_uuid` must be registered in pg-mem — the migration spec helper does
  this; board_views has NO id column so it does not even need it, but the FK chain
  (users/boards) does. Kept in the spec helper.

## Final answer on the headline questions
- JSONB upsert corruption: prevented — `JSON.stringify` on BOTH insert and
  `doUpdateSet`, column typed `ColumnType<T,string,string>`. Read auto-parses.
- pg-mem ON CONFLICT: **SUPPORTED** (empirically verified). No fallback.
- save/hydrate loop: prevented — hydrate is one-shot behind a `hydrated` ref; the
  save effect is skipped until hydrated, so hydration never triggers a save.
- config injection/oversize: `.strict()` Zod object rejects unknown keys at the
  tRPC boundary (`BAD_REQUEST`) before any DB write; defensive re-parse on read.
- permission isolation: `user_id` is ALWAYS `ctx.user.id`, never input; both
  procedures gate on `loadBoardFor(...,"view")`.
- archived cards in table/calendar/swimlane: cannot appear — `getBoardData` and
  `listDueCards` both exclude archived rows at the query level.
