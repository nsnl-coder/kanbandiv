# Card Templates — Frontend Plan

Depends on the backend `cardTemplates` router (`list` / `create` / `update` /
`delete` / `instantiate`). Mirror `features/board` patterns and the LABELS feature
shape (`LabelManager` + `LabelPicker` + board-page wiring). Use `useTRPC()`
`queryOptions` / `mutationOptions` directly in components (no API hooks, per
`frontend.md`). Templates are board-scoped; the manager lives in a Modal (prefer
modal over route, per `frontend.md`).

Two user flows:
1. **Manage templates** — a `TemplatesManager` modal (mirror `LabelManager`): list
   board templates; create/edit/delete via a form (name + description + pick board
   labels + add checklists with items + optional cover color). Gated behind
   `canEdit`.
2. **New card from template** — in the `Column` add-card flow, an entry that opens
   a picker of the board's templates; choosing one calls
   `cardTemplates.instantiate({ id, columnId })` and the returned ENRICHED card is
   inserted into the board (optimistic refetch of `boards.getData`).

Optional (note, build if time): a "Save this card as a template" button in
`CardEditor` that PREFILLS the create form from the open card's `labels` +
checklists, then calls `cardTemplates.create` — FRONTEND-ONLY (no BE endpoint).
Optional: a command-palette action "New card from template".

## 1. Feature scaffold (`features/board`)
- [x] `types.ts` — re-export `CardTemplate`, `CardTemplatePayload` from `shared`.
- [x] `cardTemplateErrors.ts` — `cardTemplateErrorMessage(err)` mapping
  `CardTemplateError` codes (mirror `labelErrors.ts`):
  `TEMPLATE_NOT_FOUND`, `BOARD_NOT_FOUND`, `COLUMN_NOT_FOUND`, `INVALID_TARGET`,
  `FORBIDDEN`.
- [x] `utils.ts` — `emptyTemplatePayload()` returning the default payload shape
  (`{ description: null, coverColor: null, labelIds: [], checklists: [] }`); a
  `cardToTemplatePayload(card, checklists)` helper for the optional "save from card"
  prefill. Mappings (CONFIRMED against `card.schema.ts`):
  - `card.labels[].id` -> `labelIds` (card payload carries `labels[]`,
    `card.schema.ts:99`).
  - `card.description` -> `description`.
  - cover: `card.cover` is a TAGGED UNION `{type:"color"|"image", ...}`
    (`card.schema.ts:79-87`). Extract ONLY the color case:
    `coverColor = card.cover?.type === "color" ? card.cover.color : null`. An
    image cover maps to `null` (templates carry no image cover; the BE payload
    `coverColor` is the `coverColorSchema` ENUM, not a free string — audit B1).
  - `checklists` -> `[{ title, items: items.map(i => i.text) }]`. The card payload
    has ONLY `checklistProgress` (counts), NOT full checklists
    (`card.schema.ts:101`), so the caller MUST pass `checklists` fetched via
    `trpc.checklists.listByCard({ cardId })` (CONFIRMED `GET /checklists?cardId=`,
    `checklist.router.ts:24-30`). Drop empty-text items before mapping (BE rejects
    `min(1)` item text).

## 2. Components (`features/board/components`)
- [x] `TemplateForm.tsx` — the shared create/edit form (used by `TemplatesManager`
  for both create and edit). Controlled fields: `name` (text, `min 1` /
  `CARD_TEMPLATE_NAME_MAX`), `description` (textarea, `CARD_DESCRIPTION_MAX`),
  optional `coverColor` (MUST pick from `COVER_COLORS` / `coverColorSchema` —
  `card.schema.ts:15-28` — the BE payload validates `coverColor` as that enum,
  audit B1; a free-text color is rejected with BAD_REQUEST), label multi-select (toggle the board's labels — reuse `LabelBadge`
  chips, fetched via `trpc.labels.list`), and a checklist editor (add/remove
  checklist rows, each with a title + an editable list of item texts). Emits a full
  `{ name, payload }` on submit. Uses `react-hook-form` (per `frontend.md`) or local
  state mirroring `LabelManager`'s controlled inputs; keep it simple.
- [x] `TemplatesManager.tsx` — board templates panel (mirror `LabelManager.tsx`):
  `useQuery(trpc.cardTemplates.list.queryOptions({ boardId }))` to list; each row
  shows name + a brief summary (label count, checklist count); edit opens
  `TemplateForm` prefilled; delete calls `cardTemplates.delete`. A "New template"
  button opens `TemplateForm` blank. All mutations `onSettled: invalidate` the
  list query key (mirror `LabelManager` invalidate). Gated behind `editable`
  (`canEdit`) — view-only sees nothing actionable (or the entry is hidden).
- [x] `TemplatePicker.tsx` — a small dropdown/popover listing the board's templates
  for the "New from template" flow; `onPick(templateId)`. Used inside `Column`.
  Reuses `trpc.cardTemplates.list`.

## 3. Column add-card flow (`features/board/components/Column.tsx`)
- [x] Extend the add-card affordance: alongside the existing "Add card" button
  (`Column.tsx:144-153`), add a "From template" entry (a small button / split
  control) that opens `TemplatePicker`. Add an `onAddFromTemplate(templateId:
  string)` prop to `Column` (parallel to `onAddCard`). View-only (`!editable`)
  hides both, as today.
- [x] Picking a template calls the parent handler with the template id; the board
  page runs the `instantiate` mutation for THIS column.

## 4. Board page wiring (`pages/user/projects/BoardDetailPage.tsx`)
- [x] `instantiateMutation = useMutation(trpc.cardTemplates.instantiate
  .mutationOptions({ onSettled: invalidateData }))` (mirror `createCardMutation`,
  `BoardDetailPage.tsx:183-184`). Pass `onAddFromTemplate={(templateId) =>
  instantiateMutation.mutate({ id: templateId, columnId: column.id })}` into each
  `Column` (next to the existing `onAddCard`, `BoardDetailPage.tsx:525-526`).
  Optimistically refetch `boards.getData` on settle (same as create card).
- [x] "Manage templates" entry (owner/editor) opens `TemplatesManager` in a Modal —
  mirror the existing `LabelManager` mount + `openLabels` handler
  (`BoardDetailPage.tsx:210`, `:591`). Add `showTemplates` state + an
  `openTemplates` handler; wire a header/menu button gated on `editable`.
- [x] Register an `openTemplates` handler on the `useBoardActionsStore` handlers
  (mirror `openLabels`). The store lives in
  `features/command/useBoardActionsStore.ts` (NOT `features/board` — CONFIRMED);
  add `openTemplates: () => void` to `BoardActionsHandlers`
  (`useBoardActionsStore.ts:15-23`) and supply it in the `registerActions(...)`
  call in `BoardDetailPage.tsx` (next to `openLabels`, `BoardDetailPage.tsx:210`).

## 5. Optional — Save this card as a template (`CardEditor.tsx`)
- [x] (optional) A "Save as template" button in `CardEditor` (`CardEditor.tsx`)
  shown when `editable`. On click, build a payload via
  `cardToTemplatePayload(card, checklists)`. The open card's `labels[]` are in the
  card payload, but FULL checklists are NOT (only `checklistProgress`) — so FETCH
  them via `trpc.checklists.listByCard({ cardId })` (or reuse the card's already
  loaded `ChecklistSection` data) BEFORE building the payload. Open `TemplateForm`
  prefilled, and on submit call
  `cardTemplates.create`. NO backend endpoint — pure FE prefill. Note as optional.

## 6. Optional — Command palette action (`features/command`)
- [x] (optional) Add a "New card from template" action to the command palette
  (mirror existing board actions). It would open `TemplatePicker` then call
  `instantiate` into a chosen/first column. Requires a column target choice; note
  it as optional scope (the just-built palette + `useBoardActionsStore` already
  expose board ctx). State this; do not build unless time allows.

## 7. Tests (vitest, mock trpc — mirror `LabelManager.test.tsx` +
`BoardDetailPage.test.tsx`)
- [x] `TemplatesManager.test.tsx` — list renders templates; "New template" + submit
  calls `cardTemplates.create` with `{ boardId, name, payload }`; edit calls
  `update`; delete calls `delete`; hidden/disabled for view-only.
- [x] `TemplateForm.test.tsx` — fills name + description + toggles labels + adds a
  checklist with items -> emits the correct `{ name, payload }`; empty checklist
  items are dropped; name `min 1` validation blocks submit.
- [x] `TemplatePicker.test.tsx` — renders the board's templates; picking one calls
  `onPick` with the template id.
- [x] `Column.test.tsx` — "From template" entry visible only when `editable`;
  picking a template calls `onAddFromTemplate(templateId)`.
- [x] `BoardDetailPage.test.tsx` — `onAddFromTemplate` triggers
  `cardTemplates.instantiate({ id, columnId })`; "Manage templates" opens the
  manager; entry hidden for view-only.
- [x] (optional) `CardEditor` "Save as template" prefills the form from the card
  and calls `create`.
- [x] `cardTemplateErrorMessage` covers every `CardTemplateError` code.

## 8. Verify
- [x] `pnpm --filter shared build` (types available to FE)
- [x] `pnpm --filter frontend test` green
- [x] `pnpm --filter frontend build` clean
- [x] manual: create a template (name + desc + labels + checklists), instantiate
  into a column -> new card has the description/labels/checklists; delete a label
  then instantiate -> stale label skipped; view-only cannot manage/instantiate.
</content>
