# Card Templates — Production-Readiness Audit

Audit of `templates.backend.md` + `templates.frontend.md` against the ACTUAL
codebase before build. Every referenced reuse target was opened and its signature
verified. Severity: BLOCKER (won't compile / corrupts data / security) > MAJOR
(wrong behavior) > MINOR (consistency/polish).

## Verified-correct claims (no change)

- `cardRepo.maxPosition(db, columnId)` filters `archived_at is null`
  (`card.repo.ts:161-168`). New card lands after live cards. CORRECT.
- `cardRepo.createCard(db, {columnId,title,description,position})` returns the row
  via `returningAll().executeTakeFirstOrThrow()` (`card.repo.ts:6-25`). CORRECT.
- `cardRepo.updateCard(db, id, { cover_color })` accepts `cover_color`
  (`card.repo.ts:79-98`). CORRECT.
- `labelRepo.attachLabel(db, cardId, labelId)` is `(cardId,labelId)`, idempotent
  `onConflict doNothing` (`label.repo.ts:71-81`). CORRECT.
- `labelRepo.listByBoard(db, boardId)` returns rows with `.id`
  (`label.repo.ts:29-36`). Set-membership stale/cross-board skip is sound — only
  THIS board's labels come back, so a foreign label id is filtered identically.
  CORRECT.
- `checklistRepo.createChecklist(db, {cardId,title,position})` returns the row with
  `.id` via `executeTakeFirstOrThrow` (`checklist.repo.ts:14-27`). `.id` is usable
  for `createItem`. CORRECT.
- `checklistRepo.createItem(db, {checklistId,text,position})`
  (`checklist.repo.ts:81-94`). CORRECT.
- `record(db, {boardId,cardId,actorId,type,meta})` ALSO publishes the realtime
  event in the SAME call — `bus.publish` with `CARD_ACTIVITY` because `cardId` is
  set (`activity.recorder.ts:56-63`). No separate `bus.publish` needed; a second
  one WOULD double-deliver. CORRECT — keep the single recorder call.
- JSONB stringify-on-BOTH-paths pattern matches `board-view.repo.upsert`
  (`board-view.repo.ts:31,37`) and `activity.recorder` (`activity.recorder.ts:39`).
  `db/types.ts` uses `ColumnType<T,string,string>` for `meta`/`config`/`payload`
  (`db/types.ts:253,265,276`). CORRECT.
- Permission helper `enforceBoard` + `loadXFor` (load entity -> its board ->
  `loadBoardFor`) mirrors `label.service.ts:57-82`. NOT_FOUND mapped, no existence
  leak. CORRECT.
- `checklists.listByCard` exists: `GET /checklists?cardId=`
  (`checklist.router.ts:24-30`). FE save-from-card CAN fetch full checklists.
  CORRECT (the card payload carries only `checklistProgress`, NOT full checklists —
  `card.schema.ts:101` — so save-from-card MUST call this endpoint; the FE plan
  already says so).
- Test helper `newTestDb` hardcodes `up001..up020` (`helpers.ts:10-29,47-66`).
  Adding `up021` is REQUIRED. CORRECT.
- Migration style `009.label.ts` (`sql` import, `gen_random_uuid()`, board_id FK
  cascade, board index) matches what 021 should mirror. CORRECT.
- `okSchema` is exported from `shared` (used by `label.router.ts:7`). CORRECT.

## Issues found + fixes applied

### B1 — BLOCKER: `coverColor` schema is `z.string()`, must be `coverColorSchema`
`templates.backend.md` §2 declares
`coverColor: z.string().nullable().default(null)`. But the card cover color is a
strict ENUM (`COVER_COLORS` / `coverColorSchema`, `card.schema.ts:15-28`), and the
instantiate output is `cardSchema` whose `cover` is
`cardCoverSchema = {type:"color", color: coverColorSchema}` (`card.schema.ts:79-87`).
`enrichCard.resolveCover` returns `{type:"color", color: r.cover_color as any}`
(`card.enrich.ts:69`) — the `as any` BYPASSES validation at enrich, but the tRPC
OUTPUT schema (`cardSchema`) re-validates on the wire. A template storing an
arbitrary `coverColor` string (e.g. `"#fff"` or junk) would instantiate a card,
write `cover_color`, then FAIL the instantiate response output validation with a
500-class error AFTER the card is already created — a half-applied, unreportable
state.
FIX: payload `coverColor` MUST be `coverColorSchema.nullable().default(null)`
(import `coverColorSchema` from shared). Rejects bad colors at the create/update
boundary (BAD_REQUEST), never reaches the DB, instantiate output always valid.

### B2 — MAJOR: stored title for the new card vs. card title bounds
Instantiate sets the new card `title = template.name`
(`templates.backend.md` step 4). Template name max is `CARD_TEMPLATE_NAME_MAX`
(plan suggests 100); card title max is `CARD_TITLE_MAX = 200` and `min 1`
(`card.schema.ts:5-6`). 100 <= 200 so no overflow, and name `min 1` covers the
title min. SAFE as long as `CARD_TEMPLATE_NAME_MAX <= CARD_TITLE_MAX`.
FIX: pin `CARD_TEMPLATE_NAME_MAX = 100` and ADD an explicit note in the plan that
it must stay `<= CARD_TITLE_MAX (200)` so the template name is always a legal card
title (no separate validation at instantiate). Documented in §2.

### B3 — MINOR: description bound mismatch (trim)
`card.schema.ts` description is `.trim().max(CARD_DESCRIPTION_MAX)`. The template
payload description uses `.max(CARD_DESCRIPTION_MAX)` WITHOUT `.trim()`. Harmless
(template desc is stored verbatim and reused as a card description, which on a
later card.update would be trimmed). No corruption.
FIX: leave un-trimmed but note it; description is stored as-is, identical to how
markdown source is treated. Documented.

### B4 — MAJOR confirm: enrich needs a RE-FETCHED row for cover_color
The plan ALREADY catches this (step 9): `createCard`'s returned `row` predates the
step-5 `updateCard(cover_color)`, and `enrichCard` reads `cover_color` FROM THE ROW
OBJECT (`card.enrich.ts:69`), not by re-query. So you MUST `cardRepo.findCardById`
AFTER the cover update and pass the FRESH row to `enrichCard`. VERIFIED correct in
the plan; strengthened the wording (re-fetch is MANDATORY when `coverColor` set,
and harmless/cheap to always re-fetch — simplest: always re-fetch before enrich).
FIX: plan now says ALWAYS re-fetch the card row before `enrichCard` (one extra
`findCardById`), removing the conditional-correctness footgun.

### B5 — MINOR: payload size abuse bounds
`.strict()` blocks unknown keys (good). Item/checklist COUNT caps
(`CARD_TEMPLATE_CHECKLIST_MAX`, `CARD_TEMPLATE_ITEMS_MAX`) and per-string maxes
(reusing `CHECKLIST_TITLE_MAX=200`, `CHECKLIST_ITEM_TEXT_MAX=500`,
`CARD_DESCRIPTION_MAX=5000`) are present. `labelIds` had NO cap — an attacker could
store a huge `labelIds` array. Stale-skip makes it harmless at instantiate, but it
still bloats the jsonb row.
FIX: add `CARD_TEMPLATE_LABELS_MAX` (e.g. 50, >= a board's realistic label count)
and `.max(CARD_TEMPLATE_LABELS_MAX)` on `labelIds`. Documented in §2.

### B6 — MINOR: archived target column not rejected
Instantiate validates `column.board_id === template.board_id` (INVALID_TARGET) but
does NOT reject an ARCHIVED column. However `cards.create` (`card.service.ts:96-100`)
ALSO does not check `column.archived_at`. Matching existing behavior is acceptable;
calling it out so it is a conscious decision, not an oversight.
FIX: note the parity with `cards.create` (no archived-column guard); do NOT add a
new guard (out of pattern). Documented in step 2 of instantiate.

### B7 — MINOR: no transaction = best-effort half-apply on mid-error
No Kysely transaction (the whole repo runs sequential `db.*` on the shared appDb).
Ordering is card-FIRST, then cover/labels/checklists, then activity. A failure
mid-apply leaves a USABLE card (not an orphan) with whatever applied so far —
acceptable, matches the codebase's best-effort posture. The recorder NEVER throws
(`activity.recorder.ts:30-69`) so the activity/realtime step can't fail the call.
FIX: keep no-transaction; the audit ratifies the trade-off and the card-first
ordering. No code change. Documented (already in plan §INSTANTIATE).

### B8 — MINOR: `cardSchema` output already imported as `cardSchema`
Instantiate output reuses `cardSchema` from shared (no new output schema). VERIFIED
exists (`card.schema.ts:89-108`). No change; plan correct.

## Net code-affecting fixes (must land in build)

1. `coverColor: coverColorSchema.nullable().default(null)` (B1) — import
   `coverColorSchema`.
2. `labelIds: z.array(z.string()).max(CARD_TEMPLATE_LABELS_MAX).default([])` (B5).
3. `CARD_TEMPLATE_NAME_MAX = 100` with the `<= CARD_TITLE_MAX` invariant noted (B2).
4. Instantiate: ALWAYS `cardRepo.findCardById(db, row.id)` before `enrichCard`
   (B4).
5. Reuse `CHECKLIST_TITLE_MAX` / `CHECKLIST_ITEM_TEXT_MAX` / `CARD_DESCRIPTION_MAX`
   by import (already planned) — confirmed exact names exist.

No signature mismatch found in the instantiate reuse chain — every reused repo fn
matches the plan's call shape. The one real data-integrity BLOCKER is the
`coverColor` enum (B1).

### F1 — MINOR (frontend): wrong store path
FE plan §4 implied `useBoardActionsStore` under `features/board`. It actually lives
at `features/command/useBoardActionsStore.ts`; `BoardActionsHandlers` is at lines
15-23 (line ref was right, path was not). FIXED in `templates.frontend.md` §4.

### F2 — MINOR (frontend): cover is a tagged union, not a color
FE `cardToTemplatePayload` must read `card.cover?.type === "color" ? color : null`
(`card.cover` is `{type:"color"|"image"}`, `card.schema.ts:79-87`), and the form's
color picker must use `COVER_COLORS` (the enum), matching BE B1. FIXED in §1/§2.
