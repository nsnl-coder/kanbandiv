# Activity Log / Audit Trail — Production-Readiness Audit

Audit of `activity.backend.md` + `activity.frontend.md` against the real
codebase. Severity: **BLOCKER** (will not work / data corruption),
**HIGH** (wrong behavior or prod risk), **MED** (correctness/consistency),
**LOW** (polish). Plans rewritten in place; this file lists what changed.

---

## BLOCKER

### B1. JSONB insert of a JS object corrupts `meta` on real Postgres
The recorder (`activity.backend.md:149`) inserts `meta: input.meta ?? {}` — a
plain JS object — into a `jsonb` column. Verified facts:
- **No existing table uses `jsonb`.** Grep of `db/types.ts` + all repos: the
  `meta jsonb` column would be the FIRST jsonb column in the schema. The plan's
  claim "confirm the JSONB column convention used by sibling tables"
  (`activity.backend.md:77-79`) is FALSE — there is no sibling convention to
  copy. The plan must DEFINE the convention.
- Kysely is `0.28.17` and does NOT auto-serialize objects for jsonb. node-pg
  sends a plain object as the string `"[object Object]"`, which Postgres rejects
  or stores garbage. (pg-mem happens to accept a raw object — see probe below —
  so tests would PASS while prod FAILS. Silent prod corruption.)
- Probe (pg-mem) result: inserting a JS object reads back as a parsed object;
  inserting `JSON.stringify(obj)` ALSO reads back as a parsed object. So
  `JSON.stringify` is correct on BOTH engines.
- **Fix:** the recorder must insert `meta: sql\`${JSON.stringify(input.meta ?? {})}\`::jsonb`
  OR `JSON.stringify(input.meta ?? {})` (the column is jsonb; the driver casts a
  JSON-text param). Plan now specifies `JSON.stringify`. The `db/types.ts`
  `ActivitysTable.meta` type is now spelled out concretely (no "confirm sibling
  convention").

### B2. Router/registration naming is inconsistent with the codebase
All feature routers are registered under PLURAL keys and exported as
`<plural>Router` (`router.ts`: `cards: cardsRouter`, `boards: boardsRouter`,
`comments: commentsRouter`, `assignees: assigneesRouter`). The plan uses
`activity` / `activityRouter` (singular). The FE plan calls
`trpc.activity.listForCard` (singular). These must agree. Decision: keep the
router key SINGULAR `activity` (it reads as a feed name, and "activities" is
awkward), but the inconsistency was undocumented. Plans now state explicitly:
key `activity`, export `activityRouter`, FE `trpc.activity.*`. (If the team
prefers plural for consistency, change BOTH plans together — flagged.)

### B3. Test harness will silently drop every activity row
`auth/test/helpers.ts:42-57` hardcodes `up001..up015`; the migrate script
(`migrate.script.ts`) globs the folder so LIVE auto-discovers 016, but TESTS do
NOT. Because the recorder swallows insert errors (by design), a missing
`activities` table makes every recorded-event assertion fail with an EMPTY
result, not an error — confusing. Plan already calls this out
(`activity.backend.md:278-285`); kept and strengthened: also add `up016` import
to the migration spec is NOT needed (spec builds its own chain), but `newTestDb`
MUST get `up016`.

---

## HIGH

### H1. `attachment.loadCardBoard` returns only `perm` — boardId not in scope
`attachment.service.loadCardBoard` (`attachment.service.ts:35-54`) returns
`MyPermission`, NOT the boardId. `createAttachment` (line 89) calls it as
`await loadCardBoard(db, user, input.cardId, "edit")` and discards everything.
The plan hand-waves "capture boardId — change it to return `{ perm, boardId }`
or do one cheap column lookup". **Specified fix:** change `loadCardBoard` to
return `{ perm, boardId }` (it already loads `column.board_id` internally at
line 43-46 — zero extra query). Update both call sites (`createAttachment`,
`loadAttachmentFor`). `deleteAttachment` then has boardId via
`loadAttachmentFor` -> `loadCardBoard`. No N+1.

### H2. `checklist.enforceCard` returns void — boardId not in scope
`enforceCard` (`checklist.service.ts:87-105`) returns `void` but internally
resolves `column.board_id` (line 95-100). The plan hand-waves. **Specified
fix:** change `enforceCard` to return `{ boardId: string }` (and update its 2
internal callers `loadChecklistFor`, `listByCard`, `createChecklist`,
`createItem` — verified they ignore the return today, so widening is safe). Then
`createChecklist`/`createItem`/`deleteChecklist`/`updateItem` get boardId free.
`loadChecklistFor` must ALSO surface boardId for the delete/item paths — return
`{ checklist, boardId }`. No extra query.

### H3. `card.updateCard` discards the pre-update row — diff is impossible
`updateCard` (`card.service.ts:102-132`) calls `loadCardFor` (returns
`{ card, column }`) but only uses it for permission; `card` (the PRE-update row,
with old title/description/due/cover) is dropped. The plan says "read the
pre-update row from loadCardFor's card" — but the current code throws that away.
**Specified fix:** keep `const { card: before, column } = await loadCardFor(...)`
and diff `before` vs `patch`/`updated` to emit `CARD_RENAMED {from,to}`,
`CARD_DESCRIPTION_CHANGED`, `DUE_DATE_SET/CLEARED`, `COVER_CHANGED`. boardId =
`column.board_id`. No extra query. cardTitle for the row = `updated.title`.

### H4. `card.moveCard` — column NAMES are not in scope (selectAll lacks join, but has name)
`moveCard` (`card.service.ts:207-234`): `loadCardFor` returns `column` typed as
`{ id, board_id }` only, and `target` is `findColumnById` typed
`{ id, board_id }`. BUT `findColumnById` does `selectAll()` on `columns` (which
HAS a `name` column — `ColumnsTable.name`), so the name IS in the row at runtime;
only the local TS type omits it. **Specified fix:** read `column.name` /
`target.name` by widening the local `ColumnRow` type to include `name: string`
(no extra query — selectAll already returns it). Emit `CARD_MOVED
{fromColumn, toColumn}` with names. Skip when `input.toColumnId === column.id`
(pure reorder). Plan kept the skip rule.

### H5. `assignee.unassign` cannot detect a no-op (double/garbage recording)
`unassign` service (`assignee.service.ts:119-128`) does NOT check existence and
`repo.unassign` returns `void` (`assignee.repo.ts:23`). A no-op unassign (user
was never assigned) would still record `ASSIGNEE_UNASSIGNED`. **Specified fix:**
call `repo.findByCardUser` BEFORE `repo.unassign`; only record if a row existed.
Also resolve `targetEmail` from that lookup is impossible (`card_assignees` has
no email) — do one cheap `users.select(["email"]).where id` (the same pattern as
`assignee.service.ts:90-94`). Plan now specifies this.

### H6. `board.revokeBoardAccess` target email requires a pre-delete lookup
`revokeBoardAccess` (`board.service.ts:275-285`) takes only `userId`; the email
is not loaded and the row is deleted before any chance to read it. **Specified
fix:** `users.select(["email"]).where id` BEFORE `repo.deleteBoardAccess`; if
the user does not exist, skip recording. Record `MEMBER_REVOKED`
{targetEmail, targetHandle}. Plan kept; made the "before delete" explicit.

### H7. After-commit consistency claim — VERIFIED TRUE
Checked every instrumented service: NONE wraps work in a Kysely transaction;
all run sequential `db.*` on the shared connection (card/label/assignee/comment/
attachment/checklist/board services). So "record after the write, swallow
errors" cannot roll back the user mutation. The plan's core decision is sound.
No change beyond making the try/catch swallow explicit in the recorder (done).

---

## MED

### M1. Card timeline must exclude `card_id IS NULL` rows
`CARD_DELETED` rows have `card_id = null` and live only in the board feed. The
card timeline query `where card_id = cardId` already excludes them naturally
(NULL never equals a uuid) — correct. But `resolveCardBoard` for the timeline is
called with the SAME `cardId`; after the card is deleted the card no longer
exists so the timeline endpoint returns `CARD_NOT_FOUND` (expected). Documented
in the plan test section (already present at `activity.backend.md:330-331`).

### M2. `nextOffset` has-more signal can over-report by one page
`nextOffset = items.length === limit ? offset + items.length : null`
(`activity.backend.md:182`). When the total is an exact multiple of `limit`, the
client makes one extra request returning `[]` and then `nextOffset = null`. This
matches the simple backup-list ergonomics and is acceptable; documented as a
known minor (no count query, by design). Kept.

### M3. Actor batch resolution — pattern VERIFIED
`comment.service.buildComments` (`comment.service.ts:71-84`) is exactly the
batched `users where id in (...)` + `nameFromEmail` (`comment.service.ts:42`)
pattern. `buildActivities` mirrors it. `nameFromEmail` is NOT exported from
comment.service (it is a file-local fn) — the plan says "reuse comment's" which
would require an export or a copy. **Decision:** copy the one-liner into
activity.service (token rule: 3 lines beat premature abstraction; avoids
cross-feature coupling for a trivial fn). Plan updated to "copy, do not import".

### M4. `PublicUser` has no name/avatar — VERIFIED
`auth.schema.ts:90-98` `publicUserSchema` = {id, email, isSuperuser, roleId,
emailVerified, permissions}. No name/avatar. So actor handle = email local-part
is the only option. meta sufficiency for the FE renderer: all human-readable
strings (column names, label name/color, target email+handle, filename, title,
snippet, dueAt) are captured at record time — the FE needs zero extra lookups.
VERIFIED sufficient. Kept.

### M5. List endpoints permission — no existence leak, VERIFIED
`listCardActivity` maps board NOT_FOUND -> `CARD_NOT_FOUND` via the
comment/assignee `resolveCardBoard` pattern; `listBoardActivity` maps board
NOT_FOUND -> `BOARD_NOT_FOUND`. `loadBoardFor` with `"view"` already throws
NOT_FOUND (not FORBIDDEN) for no-access (`board.service.ts:106-108`), so a
view-only member passes and a non-member sees NOT_FOUND. Correct. Pagination
shape mirrors `backup.repo.listRuns` (`.limit().offset()`). Kept.

### M6. Activity not writable via API — VERIFIED by design
Router exposes only two `protectedProcedure.query` endpoints; no
mutation/insert is exposed. The recorder is internal (not on the router). Rows
are system-generated only. Correct.

---

## LOW

### L1. FE: no `useInfiniteQuery` precedent in the codebase
Grep: zero `infiniteQueryOptions` / `useInfiniteQuery` usages. The FE plan's
"preferred useInfiniteQuery" has no precedent. **Decision:** use the simple
`limit/offset` + "Load more" approach (matches backup-list ergonomics, which the
plan itself defaults to). Plan updated to drop the infinite-query option and
commit to offset state.

### L2. FE: time util name is `relativeTime` from `features/board/utils`
`CommentItem.tsx:3,42` uses `relativeTime(date)` from `../utils`. The plan said
"reuse the existing time-formatting util used by CommentItem; cite during
implementation". Now cited concretely: `import { relativeTime } from "../utils"`.

### L3. FE: History button must NOT be gated by editable/isOwner
The existing `Manage labels` button is gated `editable`, `Manage access` gated
`isOwner(board)` (`BoardDetailPage.tsx:306-325`). The History button must render
for ANY viewer (read needs only `view`). Plan made this explicit: render
unconditionally (the page only loads for users who can view the board).

### L4. `ATTACHMENT_DELETED` cardTitle needs a lookup
`deleteAttachment` has `row.card_id` and `row.filename`, but not the card title.
One cheap `cards.select(["title"]).where id` is required (single-mutation path,
acceptable). Specified. Same cheap-lookup note applies to LABEL_DETACHED
(`detachLabel` does not load the card row — `loadCardBoard` returns
`{ card: {id, column_id}, boardId }`, no title). Specified one lookup each.

### L5. `ActivitiesTable` name in `db/types.ts`
Plan wrote `ActivitiesTable`; the `Database` key must be `activities`
(plural table). Confirmed table name `activities`. Kept; key `activities`.

---

## Items verified as CORRECT (no change)

- After-commit, not in-transaction: no service uses a transaction (H7).
- pg-mem honors `ON DELETE SET NULL` (the 015 card-cover spec proves it,
  `015.card-cover.spec.ts:127-155`); migration style (`sql` + `gen_random_uuid`,
  `references().onDelete()`) supports SET NULL / CASCADE — mirror `012.comment`.
- Migration auto-discovery in live runner (`migrate.script.ts` globs + skips
  `.spec.`), so 016 is picked up live.
- Batch actor resolution avoids N+1 (M3).
- Permission model + no existence leak (M5), read-only API (M6), meta
  sufficiency (M4).
- card delete keeps the row via `card_id SET NULL` + `meta.cardTitle`; board
  delete CASCADE; actor delete SET NULL. Migration can express all three.

---

## Summary of plan edits

Backend plan: B1 (jsonb JSON.stringify + concrete db/types), B2 (naming),
H1 (`loadCardBoard` returns boardId), H2 (`enforceCard`/`loadChecklistFor`
return boardId), H3 (keep pre-update card row), H4 (widen ColumnRow for name),
H5 (unassign no-op guard + email lookup), H6 (revoke pre-delete email lookup),
M3 (copy nameFromEmail), L4/L5 (cheap title lookups, table key). Frontend plan:
B2 (trpc.activity), L1 (drop infinite query), L2 (relativeTime), L3 (ungated
History button).
