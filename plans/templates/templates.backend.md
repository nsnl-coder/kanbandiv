# Card Templates â€” Backend Plan

Reusable card presets scoped to a **board**. A template captures a `name` plus a
JSONB `payload` `{ description?, coverColor?, labelIds[], checklists[{title,
items[]}] }`. Two flows:

1. **Author/edit a template via a form** (name + description + pick board labels +
   add checklists/items). This is the PRIMARY create path.
2. **INSTANTIATE** â€” create a new card from a template in ONE backend service call:
   create the card in a target column (like `cards.create`: `columnId`,
   `position = max + 1`), then apply the payload (set description/coverColor,
   attach the board labels that still exist, create checklists + items), record a
   `CARD_CREATED` activity, and publish a realtime `BOARD_CHANGED`. The card comes
   back ENRICHED, exactly like `cards.create`.

"Save this card as a template" is OPTIONAL convenience and is FRONTEND-ONLY: the
FE prefills the same create form from a card's current labels + checklists, then
calls the normal `create` endpoint. The backend needs NO card-prefill endpoint
(see Key decisions). Note it; do not build a separate BE path.

Templates are board-scoped so their `labelIds` align with that board's labels.
Permissions: list = board `view`; create/edit/delete/instantiate = board `edit`
(instantiate creates a card). `user` always comes from `ctx`.

Mirror `features/label` + `features/checklist` patterns: `*.router.ts` /
`*.service.ts` / `*.repo.ts` + `test/<endpoint>.spec.ts`, Kysely, tRPC
`protectedProcedure`, Zod from `shared`, OpenAPI `.meta`, superjson.

**Naming (decided):** router export `cardTemplatesRouter`, registered under the
key `cardTemplates` in `trpc/router.ts`, FE calls `trpc.cardTemplates.*`. Plural
feature key like `labels`/`cards`. Backend and frontend plans MUST stay in sync
on this key.

## Key decisions (decided)

### Storage = one `card_templates` row per template, board-scoped â€” DECIDED
- Table `card_templates`: `id uuid pk`, `board_id uuid fk boards.id ON DELETE
  CASCADE`, `name text notnull`, `payload jsonb notnull default '{}'::jsonb`,
  `created_at`/`updated_at`. Index on `board_id` (the list-by-board query). Mirror
  `009.label.ts` table style EXACTLY (`sql` import, `gen_random_uuid()` default).
- `board_id` is `ON DELETE CASCADE` â€” a template is meaningless once its board is
  gone, and its `labelIds` reference that board's labels (which also cascade away).
  Deleting a board removes its templates.
- NO direct FK from the payload's `labelIds`/checklist data to other tables â€” the
  payload is an opaque JSONB blob of IDS + literal text; referential integrity for
  labels is enforced at INSTANTIATE time by checking each `labelId` still exists on
  the board and SKIPPING stale ones (see below). This is deliberate: a label
  deleted after a template was saved must NOT break the template (it just drops
  that label on instantiate).

### payload is JSONB â€” follow the activity `meta` / board_views `config` /
### notifications `payload` pattern EXACTLY â€” DECIDED
- Those three are the established JSONB columns (`db/types.ts:244-279`). They all
  learned (activity audit B1) that **Kysely + node-pg does NOT auto-serialize a JS
  object into a jsonb column** â€” a raw object is sent as the string
  `"[object Object]"` and corrupts the row. pg-mem accepts a raw object so tests
  pass while prod corrupts (silent). The fix proven there: `JSON.stringify` on
  write and type the column `ColumnType<T, string, string>`.
- `card_templates.payload` MUST follow the SAME pattern:
  - `db/types.ts`: `payload: ColumnType<CardTemplatePayload, string, string>`
    (select returns the parsed object; INSERT/UPDATE send JSON TEXT).
  - repo `create` MUST `JSON.stringify(payload)` on the insert value.
  - repo `update` MUST `JSON.stringify(payload)` on the update value (the update
    path is jsonb too â€” same corruption risk; mirror `board-view.repo.upsert`
    stringifying on BOTH paths).

### payload is VALIDATED by a STRICT Zod schema before write â€” DECIDED
- The create/update input carries `payload: cardTemplatePayloadSchema` â€” a
  `.strict()` object (see Â§2) â€” so an unknown key is REJECTED at the tRPC boundary
  with a `BAD_REQUEST` (Zod) and never reaches the DB. Mirror
  `boardViewConfigSchema.strict()` reasoning: a malformed payload cannot smuggle
  junk into the jsonb.
- `labelIds` are kept as plain `z.string()[]` (NOT validated against the board at
  WRITE time â€” a label may be deleted later anyway; integrity is an
  instantiate-time concern). Checklists are
  `{ title: z.string().min(1).max(...), items: z.array(z.string().min(1).max(...)) }[]`.

### INSTANTIATE is ONE service call, sequential `db.*` (NOT a transaction) â€” DECIDED
- Mutations in this repo do NOT wrap work in a Kysely transaction (activity audit:
  each service runs sequential `db.*` calls on the shared `appDb`). INSTANTIATE
  follows the SAME model: ONE `instantiate(db, user, input)` service fn that does
  all the writes sequentially, so the client makes ONE round-trip and a dropped
  request can't leave a half-applied card from MULTIPLE client calls (the whole
  point of the requirement). The card create comes FIRST; if a later step (a
  checklist insert) failed, the card already exists with whatever applied so far â€”
  acceptable and the same best-effort posture the rest of the codebase uses. Do
  NOT introduce a transaction wrapper just for this (large, out-of-pattern change);
  state this trade-off.
- Reuse EXISTING repos, do NOT duplicate write logic (ALL signatures VERIFIED
  against source in `templates.audit.md` â€” no mismatch found):
  - `cardRepo.maxPosition(db, columnId)` + `cardRepo.createCard(db, {columnId,
    title, description, position: max+1})` â€” IDENTICAL to `card.service.createCard`
    (`card.service.ts:101-107`). `maxPosition` already filters `archived_at is
    null` (`card.repo.ts:161-168`) so the new card lands after live cards.
  - cover/description: `cardRepo.updateCard(db, cardId, { description,
    cover_color })` (the repo already accepts both, `card.repo.ts:79-98`). Apply
    in the create itself where possible (description is a create field;
    `coverColor` is set via one `updateCard`). Mutual-exclusion of cover fields is
    moot here â€” a template only carries `coverColor` (no image), so
    `cover_attachment_id` stays null.
  - labels: `labelRepo.attachLabel(db, cardId, labelId)` (`label.repo.ts:71-81`,
    idempotent `onConflict doNothing`).
  - checklists/items: `checklistRepo.createChecklist(db, {cardId, title,
    position})` then per item `checklistRepo.createItem(db, {checklistId, text,
    position})`. Positions follow the new=max+1 convention; since the card is
    brand-new, positions are simply `1, 2, 3...` per checklist and per item
    (sequential index + 1), OR call `maxChecklistPosition`/`maxItemPosition` for
    strict consistency. Decided: use sequential `i + 1` (the card has no prior
    checklists/items â€” no need for a max query; simpler and correct for a fresh
    card). State this.
- Return the card ENRICHED via `enrichCard(db, row)` (`card.enrich.ts:104`) so the
  payload matches what `cards.create` returns (labels[], checklistProgress, cover,
  counts...). Enrich AFTER all applies so labels + checklist progress are reflected.

### stale-label skipping at instantiate â€” DECIDED
- Before attaching, load the board's CURRENT labels once:
  `labelRepo.listByBoard(db, boardId)` -> a `Set<labelId>`. For each
  `payload.labelIds`, attach ONLY if the id is in the set; SKIP (silently drop) any
  id not present (a label deleted since the template was saved). This is why
  `labelIds` is not FK-constrained. NEVER throw on a stale label â€” instantiation
  must succeed with the labels that still exist.
- Cross-board safety: `listByBoard` only returns THIS board's labels, so a stale OR
  foreign label id is filtered the same way (no `LABEL_BOARD_MISMATCH` needed â€” the
  set membership check covers it).

### activity + realtime on instantiate ONLY (matches createCard) â€” DECIDED
- After the card is created (and applies done), call `record(db, { boardId, cardId:
  row.id, actorId: user.id, type: ActivityType.CARD_CREATED, meta: { cardTitle:
  row.title } })` â€” IDENTICAL to `card.service.createCard` (`card.service.ts:108`).
  The recorder ALSO publishes the realtime event internally (it calls
  `bus.publish` with `CARD_ACTIVITY` because `cardId` is set â€”
  `activity.recorder.ts:56-63`), so other viewers refetch. Do NOT add a second
  explicit `bus.publish` (would double-deliver). State this: realtime is covered by
  the recorder chokepoint, same as createCard.
- Do NOT record per-label / per-checklist activity on instantiate (a template fill
  is conceptually ONE "card created" event; flooding the feed with N attach/create
  rows is noise). Only `CARD_CREATED`. State this decision.

### permission resolution â€” DECIDED
- Template ops resolve the board via `card_templates.board_id` ->
  `loadBoardFor(db, user, boardId, min)` (`board.service.ts`), the SAME helper
  every feature uses. `loadBoardFor` throws NOT_FOUND when the caller cannot see
  the board (no existence leak for private boards). Wrap to
  `CardTemplateError.BOARD_NOT_FOUND` / `TEMPLATE_NOT_FOUND` via try/catch (mirror
  `label.service.enforceBoard`).
  - `list` -> `"view"`.
  - `create`/`update`/`delete` -> `"edit"` (board edit).
  - `instantiate` -> `"edit"` (it creates a card). Resolve the board from the
    TEMPLATE's `board_id`; the target `columnId` MUST belong to the SAME board
    (validate: load the column, assert `column.board_id === template.board_id`, else
    a `COLUMN_NOT_FOUND` / `INVALID_TARGET` error â€” a template cannot fill a card
    into another board's column).

### no card->template "save" endpoint on the backend â€” DECIDED
- "Save this card as a template" is implemented FRONTEND-side: read the open card's
  `labels[]` (already in the card payload) + its checklists (via
  `checklists.listByCard` / the open card's loaded checklists), map them into the
  create-form's payload shape, and call the normal `create` endpoint. No new BE
  surface. State this; if a server-side "snapshot from card" is wanted later, add
  it then.

## API endpoints
tRPC procedure -> OpenAPI method + path. All `protectedProcedure`. `user` is always
`ctx`.

- [x] `GET /card-templates?boardId=` â€” list a board's card templates (board `view`)
- [x] `POST /card-templates` â€” create a template `{boardId, name, payload}` (board `edit`)
- [x] `PATCH /card-templates/{id}` â€” update name and/or payload (board `edit`)
- [x] `DELETE /card-templates/{id}` â€” delete a template (board `edit`)
- [x] `POST /card-templates/{id}/instantiate` â€” create a card from the template in `{columnId}`; applies description/coverColor/labels/checklists+items; returns the ENRICHED card (board `edit`)

## 1. Database (migration + db types)
- [x] `migrations/021.card-template.ts` (next free number is 021; highest existing
  is `020.notification`). Mirror `009.label.ts` / `020.notification.ts` style
  (`sql` import, `gen_random_uuid()` default). Create `card_templates`:
  - `id uuid pk default gen_random_uuid()`
  - `board_id uuid notnull references boards.id on delete cascade`
  - `name text notnull`
  - `payload jsonb notnull default '{}'::jsonb` (the preset bag; see Â§2). The
    default is defensive only â€” the repo ALWAYS sends a full `JSON.stringify`'d
    payload (Zod fills `.default(...)` for `labelIds`/`checklists`).
  - `created_at timestamptz notnull default now()`
  - `updated_at timestamptz notnull default now()`
  - Index `card_templates_board_idx` on `board_id` (the list query).
  - `down` drops the table `.ifExists()`.
- [x] `db/types.ts` â€” add `CardTemplatesTable`. The `payload` jsonb column follows
  the `ActivitiesTable.meta` / `NotificationsTable.payload` /
  `BoardViewsTable.config` pattern EXACTLY (`db/types.ts:253,265,276`):
  ```ts
  import type { ColumnType, Generated } from "kysely";
  import type { CardTemplatePayload } from "shared";
  export interface CardTemplatesTable {
    id: Generated<string>;
    board_id: string;
    name: string;
    // jsonb: select returns a parsed object; INSERT/UPDATE MUST send JSON TEXT
    // (the repo JSON.stringify's it on BOTH paths â€” node-pg sends a raw object
    // as "[object Object]" and corrupts the row, mirror activity audit B1).
    payload: ColumnType<CardTemplatePayload, string, string>;
    created_at: GeneratedTimestamp;
    updated_at: GeneratedTimestamp;
  }
  ```
  Register `card_templates: CardTemplatesTable` in the `Database` interface
  (`db/types.ts:281-307`). `ColumnType`/`Generated` already imported
  (`db/types.ts:1`); reuse the `GeneratedTimestamp` alias (`db/types.ts:19`).
- [x] `migrations/021.card-template.spec.ts` (LIVES IN `src/migrations/`, mirror
  `009.label.spec.ts` if present, else the board_view/activity migration specs):
  pg-mem + register `gen_random_uuid`; run prior `up`s for the FK chain (`up001`
  auth, `up003` project, `up004` board), then `up` (021). Assert:
  - up creates `card_templates` + the `board_id` index.
  - inserting a row with jsonb `payload` passed as `JSON.stringify({...})` reads
    back as a PARSED object (`expect(row.payload).toEqual({...})`) â€” confirms the
    stringify round-trip (activity B1: pg-mem accepts a raw object too, so this
    asserts the round-trip; the stringify is the real prod guard).
  - deleting the board cascades the template away (pg-mem honors `ON DELETE
    CASCADE`).
  - `down` drops the table.

## 2. Shared schemas + errors (`packages/shared`)
Schemas live FLAT at `shared/src/*.schema.ts` (e.g. `label.schema.ts`,
`board-view.schema.ts`). Follow the ACTUAL layout: `src/card-template.schema.ts`.

- [x] `src/card-template.schema.ts`:
  - constants: `CARD_TEMPLATE_NAME_MAX = 100` (MUST stay `<= CARD_TITLE_MAX` (200,
    `card.schema.ts:6`) â€” the instantiate sets the new card `title = template.name`,
    so the name must always be a legal card title; no separate validation at
    instantiate), `CARD_TEMPLATE_CHECKLIST_MAX` (max checklists per template, e.g.
    20), `CARD_TEMPLATE_ITEMS_MAX` (max items per checklist, e.g. 50),
    `CARD_TEMPLATE_LABELS_MAX` (cap on `labelIds`, e.g. 50 â€” prevents a huge
    `labelIds` array bloating the jsonb row; stale-skip already makes extra ids
    harmless at instantiate, this caps storage). Reuse existing text bounds:
    checklist titles -> `CHECKLIST_TITLE_MAX` (=200, `checklist.schema.ts:3`),
    items -> `CHECKLIST_ITEM_TEXT_MAX` (=500, `checklist.schema.ts:4`),
    description -> `CARD_DESCRIPTION_MAX` (=5000, `card.schema.ts:7`). Re-import
    those (CONFIRMED exact names) rather than redeclaring. ALSO import
    `coverColorSchema` (`card.schema.ts:28`) â€” see the payload note below.
  - `cardTemplateChecklistSchema` = `z.object({ title:
    z.string().min(1).max(CHECKLIST_TITLE_MAX), items:
    z.array(z.string().min(1).max(CHECKLIST_ITEM_TEXT_MAX)).max(CARD_TEMPLATE_ITEMS_MAX).default([]) }).strict()`.
  - `cardTemplatePayloadSchema` â€” STRICT object (the validated preset bag stored in
    `payload` jsonb):
    ```ts
    export const cardTemplatePayloadSchema = z.object({
      description: z.string().max(CARD_DESCRIPTION_MAX).nullable().default(null),
      // BLOCKER FIX (audit B1): coverColor is the card cover ENUM, NOT a free
      // string. The instantiate output is `cardSchema` whose cover is
      // `{type:"color", color: coverColorSchema}` (card.schema.ts:79-87); enrich
      // casts cover_color `as any` (card.enrich.ts:69) so a junk string survives
      // the DB write then FAILS the instantiate OUTPUT validation AFTER the card
      // is already created. Validate as the enum at the WRITE boundary instead.
      coverColor: coverColorSchema.nullable().default(null),
      // audit B5: cap labelIds so a huge array can't bloat the jsonb row.
      labelIds: z.array(z.string()).max(CARD_TEMPLATE_LABELS_MAX).default([]),
      checklists: z.array(cardTemplateChecklistSchema).max(CARD_TEMPLATE_CHECKLIST_MAX).default([]),
    }).strict();
    export type CardTemplatePayload = z.infer<typeof cardTemplatePayloadSchema>;
    ```
    (`.strict()` so an unknown payload key is REJECTED â€” a malformed payload cannot
    corrupt the jsonb; mirror `boardViewConfigSchema`. Every field has
    `.default(...)` so a partial payload from the FE is normalized to a complete
    payload before storage â€” a stored payload is ALWAYS complete. `coverColor` uses
    `coverColorSchema` (enum) NOT `z.string()` â€” see B1 above.)
  - inputs:
    - `listCardTemplatesInput` = `z.object({ boardId: z.string() })`.
    - `createCardTemplateInput` = `z.object({ boardId: z.string(), name:
      z.string().min(1).max(CARD_TEMPLATE_NAME_MAX), payload:
      cardTemplatePayloadSchema })`.
    - `updateCardTemplateInput` = `z.object({ name:
      z.string().min(1).max(CARD_TEMPLATE_NAME_MAX).optional(), payload:
      cardTemplatePayloadSchema.optional() })` (merged with `{id}` in the router;
      mirror `updateLabelInput`).
    - `instantiateCardTemplateInput` = `z.object({ columnId: z.string() })`
      (merged with `{id}` = the template id in the router).
  - output `cardTemplateSchema` = `z.object({ id: z.string(), boardId: z.string(),
    name: z.string(), payload: cardTemplatePayloadSchema, createdAt: z.date(),
    updatedAt: z.date() })`.
  - instantiate output = the existing `cardSchema` (`card.schema.ts`) â€” the
    enriched card, identical to `cards.create`'s output. Do NOT define a new output.
  - export inferred types the FE consumes: `export type CardTemplate = z.infer<...>`,
    `CardTemplatePayload`, `CreateCardTemplateInput`, `UpdateCardTemplateInput`,
    `ListCardTemplatesInput`, `InstantiateCardTemplateInput`.
- [x] `src/errors/card-template.error.ts` â€” `CardTemplateError` `as const` (mirror
  `errors/label.error.ts`): `FORBIDDEN`, `TEMPLATE_NOT_FOUND`, `BOARD_NOT_FOUND`,
  `COLUMN_NOT_FOUND`, `INVALID_TARGET` (column not on the template's board). Export
  the value type.
- [x] `src/index.ts` â€” add `export * from "./card-template.schema.js";` and
  `export * from "./errors/card-template.error.js";` (the barrel is explicit,
  `index.ts:1-34`; no auto-discovery).
- [x] `pnpm --filter shared build` so backend + frontend pick up the new types.

## 3. Repo (`features/card-template/card-template.repo.ts`)
- [x] `Db = Kysely<Database>` (mirror other repos).
- [x] `create(db, { boardId, name, payload })` â€” insert; `payload:
  JSON.stringify(payload)` (jsonb â€” node-pg corruption guard). `returningAll()`
  (config parsed back on the return). Mirror `label.repo.createLabel`.
- [x] `findById(db, id)` â€” `selectAll().where("id","=",id).executeTakeFirst()`.
- [x] `listByBoard(db, boardId)` â€” `selectAll().where("board_id","=",boardId)
  .orderBy("created_at","asc").execute()` (mirror `label.repo.listByBoard`).
- [x] `update(db, id, patch: { name?: string; payload?: CardTemplatePayload })` â€”
  build the set object: include `name` if present; if `payload` present set
  `payload: JSON.stringify(payload)` (jsonb guard on the UPDATE path too);
  `updated_at: new Date()`. `returningAll().executeTakeFirst()`.
- [x] `deleteById(db, id)` â€” `deleteFrom("card_templates").where("id","=",id)
  .execute()`.
- [x] Do NOT add card/label/checklist write helpers here â€” instantiate REUSES
  `cardRepo` / `labelRepo` / `checklistRepo` (cross-feature repo import is an
  accepted pattern, `card.enrich.ts:2-6`).

## 4. Service (`features/card-template/card-template.service.ts`)
- [x] `CtxUser` â€” import from `board.service` (mirror `label.service.ts:11`).
- [x] `toCardTemplate(row)` â€” map snake_case row -> `CardTemplate` (id, boardId,
  name, payload (already parsed), createdAt, updatedAt). Mirror `label.toLabel`.
- [x] `enforceBoard(db, user, boardId, min, notFound)` â€” try `loadBoardFor`, map
  NOT_FOUND -> the given error (copy `label.service.enforceBoard`).
- [x] `loadTemplateFor(db, user, id, min)` â€” `repo.findById`; if missing ->
  `TEMPLATE_NOT_FOUND`; `enforceBoard(..., row.board_id, min, templateNotFound)`;
  return the row (mirror `label.service.loadLabelFor`).
- [x] `listTemplates(db, user, boardId)` â€” `enforceBoard(..., "view",
  boardNotFound)`; `repo.listByBoard`; map `toCardTemplate`.
- [x] `createTemplate(db, user, input)` â€” `enforceBoard(..., input.boardId,
  "edit", boardNotFound)`; `repo.create(db, { boardId, name, payload })`; return
  `toCardTemplate`. (No realtime publish â€” a template is not in `boards.getData`.)
- [x] `updateTemplate(db, user, id, patch)` â€” `loadTemplateFor(..., "edit")`;
  `repo.update(db, id, patch)`; if missing -> `TEMPLATE_NOT_FOUND`; return
  `toCardTemplate`. (No publish â€” not in `boards.getData`.)
- [x] `deleteTemplate(db, user, id)` â€” `loadTemplateFor(..., "edit")`;
  `repo.deleteById`; return `{ ok: true }`.
- [x] `instantiate(db, user, id, input)` â€” THE core, ONE call:
  1. `const template = await loadTemplateFor(db, user, id, "edit")` (board `edit`).
  2. Load the target column: `const column = await cardRepo.findColumnById(db,
     input.columnId)`; if missing -> `COLUMN_NOT_FOUND`; if `column.board_id !==
     template.board_id` -> `INVALID_TARGET` (a template fills only its own board).
     (audit B6: do NOT add an archived-column guard â€” `cards.create`
     (`card.service.ts:96-100`) also does not check `column.archived_at`; match
     that parity, adding a guard here only would be out-of-pattern.)
  3. `const payload = template.payload` (already a parsed `CardTemplatePayload`).
  4. Create the card: `const max = await cardRepo.maxPosition(db,
     input.columnId)`; `const row = await cardRepo.createCard(db, { columnId:
     input.columnId, title: template.name, description: payload.description ??
     null, position: max + 1 })`. (Card TITLE = the template name â€” decided: a
     template's name is the natural new-card title; the form can rename after.
     State this.)
  5. Cover: if `payload.coverColor != null`, `await cardRepo.updateCard(db, row.id,
     { cover_color: payload.coverColor })` (one update; `cover_attachment_id` stays
     null â€” templates carry no image cover).
  6. Labels (stale-skip): `const boardLabels = await labelRepo.listByBoard(db,
     template.board_id)`; `const valid = new Set(boardLabels.map(l => l.id))`; for
     each `lid of payload.labelIds` if `valid.has(lid)` `await
     labelRepo.attachLabel(db, row.id, lid)` (idempotent). Stale/foreign ids are
     SILENTLY skipped.
  7. Checklists + items: for each `(cl, i)` of `payload.checklists`: `const c =
     await checklistRepo.createChecklist(db, { cardId: row.id, title: cl.title,
     position: i + 1 })`; for each `(text, j)` of `cl.items`: `await
     checklistRepo.createItem(db, { checklistId: c.id, text, position: j + 1 })`.
  8. Activity + realtime: `await record(db, { boardId: template.board_id, cardId:
     row.id, actorId: user.id, type: ActivityType.CARD_CREATED, meta: { cardTitle:
     row.title } })` (the recorder ALSO publishes the realtime event â€” no separate
     `bus.publish`).
  9. ALWAYS re-fetch then enrich (audit B4 â€” MANDATORY, not conditional):
     `const fresh = await cardRepo.findCardById(db, row.id)` then `return await
     enrichCard(db, fresh as CardRow)`. WHY: `enrichCard` reads `cover_color`
     FROM THE ROW OBJECT (`card.enrich.ts:69`), not by re-query; the step-4
     `createCard` row predates the step-5 `updateCard(cover_color)`, so passing
     the stale `row` would drop the cover from the response whenever `coverColor`
     was set. Labels + checklists ARE re-queried by id inside `enrichCards`
     (`card.enrich.ts:29-101`), so those reflect the applies regardless; only
     `cover_color` lives on the row, hence the unconditional re-fetch (cheap, one
     `findCardById`, removes the conditional-correctness footgun).
- [x] error constructors: `templateNotFound()`, `boardNotFound()`,
  `columnNotFound()`, `invalidTarget()` â€” small `TRPCError` factories (copy the
  `label.service` shape; `INVALID_TARGET` is `BAD_REQUEST`, the rest `NOT_FOUND`).

## 5. Router (`features/card-template/card-template.router.ts`)
- [x] tRPC `cardTemplatesRouter`. Mirror `label.router.ts` (`user(ctx)` helper +
  `idInput = z.object({ id: z.string() })` + `.meta` openapi shape).
  - `list` â€” GET `/card-templates`, input `listCardTemplatesInput`, output
    `z.array(cardTemplateSchema)`, `.query` -> `listTemplates(ctx.db, user(ctx),
    input.boardId)`.
  - `create` â€” POST `/card-templates`, input `createCardTemplateInput`, output
    `cardTemplateSchema`, `.mutation` -> `createTemplate(ctx.db, user(ctx),
    input)`.
  - `update` â€” PATCH `/card-templates/{id}`, input
    `idInput.merge(updateCardTemplateInput)`, output `cardTemplateSchema`,
    `.mutation` -> destructure `{ id, ...patch }`, `updateTemplate(ctx.db,
    user(ctx), id, patch)`.
  - `delete` â€” DELETE `/card-templates/{id}`, input `idInput`, output `okSchema`,
    `.mutation` -> `deleteTemplate(ctx.db, user(ctx), input.id)`.
  - `instantiate` â€” POST `/card-templates/{id}/instantiate`, input
    `idInput.merge(instantiateCardTemplateInput)`, output `cardSchema`,
    `.mutation` -> destructure `{ id, ...rest }`, `instantiate(ctx.db, user(ctx),
    id, rest)`.
  - `tags: ["cardTemplates"]`, `protect: true` on every `.meta`.
- [x] Register `cardTemplates: cardTemplatesRouter` in `trpc/router.ts` (add import
  + line in `appRouter`, `router.ts:20-39`). Key is `cardTemplates`.

## 6. Test-harness wiring (REQUIRED â€” do not skip)
- [x] `features/auth/test/helpers.ts` â€” `newTestDb` hardcodes `up001..up020`
  (imports `helpers.ts:10-29`, calls `:47-66`). Add
  `import { up as up021 } from "../../../migrations/021.card-template.js";` and
  `await up021(db);` after `await up020(db);` (`helpers.ts:66`). WITHOUT this the
  test DB has no `card_templates` table and every template test fails on the
  insert/select.

## 7. Tests (pg-mem, mirror `features/label/test` + `features/checklist/test`)
Reuse `seedUser`/`seedBoard`/`seedBoardAccess`/`seedColumn`/`seedCard`/
`authedCaller` (or `createCaller` + `makeContext`) from `board/test/helpers`. Seed
labels via `labels.create` (or a direct insert) and drive the REAL service via the
caller (`trpc.cardTemplates.*`).

### create / list / edit / delete
- [x] `create` a template (board `edit`) -> row stored; `list` returns it; a
  view-only member's `create` -> FORBIDDEN/NOT_FOUND (board `edit` required).
- [x] `list` returns a board's templates ordered by `created_at`; board not
  viewable -> NOT_FOUND (no existence leak).
- [x] `update` name and/or payload (board `edit`); a partial payload is NORMALIZED
  by the schema defaults to a COMPLETE payload and stored complete; view-only
  `update` -> FORBIDDEN/NOT_FOUND.
- [x] `delete` a template (board `edit`); view-only `delete` -> FORBIDDEN/NOT_FOUND;
  deleting the board cascades its templates away (service-level board-delete test).

### payload JSONB round-trip (incl stringify)
- [x] after `create`, read the `card_templates` row DIRECTLY from the db and assert
  `row.payload` is a PARSED object equal to the sent payload (confirms the
  `JSON.stringify` insert path, activity B1; pg-mem would accept a raw object too,
  so this asserts the round-trip â€” the stringify is the real prod guard, keep it).
- [x] nested values survive: `payload.checklists[].items` come back as arrays,
  `description`/`coverColor` as the stored string or `null`, `labelIds` as an
  array. Same assertion after an `update` (the UPDATE jsonb path).
- [x] `create`/`update` with an UNKNOWN payload key (e.g. `payload.evil: 1`) ->
  `BAD_REQUEST` (the `.strict()` schema), no row written/changed.

### instantiate â€” the core
- [x] `instantiate` into a column creates a card at `position = max + 1` (after
  existing live cards; archived cards ignored â€” mirror `cards.create` positioning);
  returns the ENRICHED card (has `labels`, `checklistProgress`, `cover`, counts).
- [x] the new card's `description` = `payload.description`; its `cover` =
  `{ type: "color", color: payload.coverColor }` when `coverColor` set; null when
  not.
- [x] the new card has the template's labels ATTACHED (all that still exist) â€” the
  enriched `card.labels` contains them; assert the `card_labels` rows exist.
- [x] the new card has the template's checklists + items created with correct
  titles/texts and order; `card.checklistProgress.total` = total items, `done` = 0.
- [x] empty template (`payload` all defaults: no description, no cover, no labels,
  no checklists) -> instantiate creates a bare card with `title = template.name`,
  no labels, no checklists; succeeds (no throw).

### stale label skipped
- [x] template `payload.labelIds` includes an id that NO LONGER exists on the board
  (deleted after save) -> instantiate SKIPS it (no error), the new card has only
  the still-existing labels; assert no `card_labels` row for the stale id.
- [x] template `payload.labelIds` includes a label id from ANOTHER board ->
  skipped the same way (set-membership filter), no `LABEL_BOARD_MISMATCH` thrown.

### instantiate â€” permission + target validation
- [x] view-only member `instantiate` -> FORBIDDEN/NOT_FOUND (board `edit`
  required); NO card written (assert the column has no new card).
- [x] `instantiate` with a `columnId` on a DIFFERENT board than the template ->
  `INVALID_TARGET`; NO card written.
- [x] `instantiate` a template on a board the caller cannot see -> NOT_FOUND
  (`TEMPLATE_NOT_FOUND`), no existence leak.
- [x] `instantiate` with a missing `columnId` -> `COLUMN_NOT_FOUND`.

### instantiate â€” activity + realtime
- [x] after `instantiate`, exactly ONE `activities` row with `type = CARD_CREATED`,
  `card_id` = the new card, `board_id` correct, `meta.cardTitle` = the title
  (mirror the createCard activity test). NO per-label / per-checklist activity rows.
- [x] instantiate publishes ONE realtime `BoardEvent` (via the recorder chokepoint)
  for the board â€” `type = CARD_ACTIVITY` (cardId set), correct `boardId`/`actorId`;
  assert NO double-publish (subscribe an in-proc bus, count exactly one event).

### migration
- [x] `migrations/021.card-template.spec.ts`: up creates table + `board_id` index;
  jsonb payload round-trip via `JSON.stringify`; board-delete -> cascade; down
  drops.

## 8. Verify
- [x] `pnpm --filter shared build`
- [x] `pnpm --filter backend test` green (create/list/edit/delete, instantiate
  applies all, stale-label skip, empty template, permission, activity+realtime,
  jsonb round-trip on pg-mem).
- [x] `pnpm --filter backend migrate` auto-discovers `021.card-template` (the live
  runner globs `migrations/` â€” `scripts/migrate.script.ts`; verified via the pg-mem
  migration spec; live Postgres not run locally).
- [x] Swagger shows `/card-templates`, `/card-templates/{id}`, and
  `/card-templates/{id}/instantiate`.
</content>
</invoke>

