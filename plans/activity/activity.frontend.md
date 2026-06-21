# Activity Log / Audit Trail — Frontend Plan

Two read-only views over the backend activity feed:
1. **Per-card timeline** — a section inside `CardEditor` (additive, like
   `CommentList` / `AttachmentList`).
2. **Per-board activity feed** — a modal/drawer opened from the board header
   (mirror how `LabelManager` / `BoardAccessPanel` open from `BoardDetailPage`).

Rendering each activity to a human sentence lives in ONE frontend helper keyed by
the shared `ActivityType` enum, so a new event type means one new case. Use
`useTRPC()` directly (no custom API hooks — `frontend.md` rule). Read-only: no
mutations, no edit/delete UI.

**tRPC key (audit B2):** the backend registers the router under the SINGULAR key
`activity`, so the FE calls `trpc.activity.listForCard` /
`trpc.activity.listForBoard`. This must match the backend plan exactly.

Mirror `features/board/components/CommentList.tsx` and the board feature layout.

## Decisions

- Activity is **read-only** — no optimistic updates, no mutations. Just
  `useQuery`. Invalidate-on-action is optional and out of scope (the feed can be
  refetched on open / via React Query staleness); do NOT wire every mutation to
  invalidate activity (token discipline — avoid scope creep).
- The human-readable line is built **entirely from `meta`** returned by the
  backend (column names, label name, assignee handle are already in `meta`), so
  the renderer needs NO extra queries — no N+1 on the client.
- Actor shown as `activity.actor.handle` (email local-part; `null` actor renders
  as `"unknown"` — already handled server-side).
- Board feed paginates with `limit/offset`; "Load more" appends pages using the
  `nextOffset` the server returns.

## 1. Shared types
- [x] Consumed from `shared` (built by the backend plan): `ActivityType`,
  `Activity` (= `z.infer<typeof activitySchema>`), `BoardActivityPage`
  (= `z.infer<typeof boardActivityPageSchema>`), `ActivityMeta`. The backend plan
  MUST `export type Activity` / `export type BoardActivityPage` alongside the
  schemas (it currently lists only the schema objects — flagged). Prefer to type
  components from the tRPC client outputs (`RouterOutputs`) rather than importing
  the schema-inferred types directly, matching how other features consume tRPC
  outputs. No new shared code in this plan.

## 2. Activity rendering helper (`features/board/activity.ts`)
- [x] `describeActivity(a: Activity): { icon: LucideIcon; text: string }` — a
  single function with a `switch (a.type)` over `ActivityType`, returning an icon
  (lucide-react) + a plain sentence built from `a.meta`. One case per of the 22
  types. Examples:
  - `CARD_CREATED` -> `created this card` / (feed) `created "${meta.cardTitle}"`
  - `CARD_RENAMED` -> `renamed from "${meta.from}" to "${meta.to}"`
  - `CARD_MOVED` -> `moved from ${meta.fromColumn} to ${meta.toColumn}`
  - `CARD_DELETED` -> `deleted "${meta.cardTitle}"` (feed only)
  - `LABEL_ATTACHED` -> `added label ${meta.labelName}`
  - `ASSIGNEE_ASSIGNED` -> `assigned ${meta.targetHandle}`
  - `DUE_DATE_SET` -> `set due date to ${formatDate(meta.dueAt)}`
  - `COVER_CHANGED` -> `changed the cover`
  - `COMMENT_ADDED` -> `commented: "${meta.snippet}"`
  - `ATTACHMENT_ADDED` -> `attached ${meta.filename}`
  - `CHECKLIST_ITEM_CHECKED` -> `checked "${meta.text}"`
  - `MEMBER_GRANTED` -> `granted ${meta.targetHandle} ${meta.permission} access`
  - ... (cover all 22). A `default` returns a generic `made a change` so an
    unknown future type never crashes the UI.
- [x] `describeActivity` takes a `scope: "card" | "board"` flag (or two thin
  wrappers) so the card timeline omits the redundant card name and the board feed
  includes it. Keep it one function; 2-3 conditional lines beat duplication.
- [x] A small `ActivityLine` presentational component: actor handle (bold) +
  sentence + relative time. Reuse `relativeTime` from `features/board/utils`
  (used by `CommentItem.tsx:3,42` as `relativeTime(comment.createdAt)`; audit L2).
  Read-only, no buttons.

## 3. Per-card timeline (`features/board/components/CardActivity.tsx`)
- [x] Props: `{ cardId: string }` (board view already enforced server-side; no
  `editable` needed — it is read-only for everyone with view access).
- [x] `const activityQuery = useQuery(trpc.activity.listForCard.queryOptions({ cardId }))`.
- [x] Render a labelled "Activity" section: loading state, empty state ("No
  activity yet."), and `activityQuery.data.map((a) => <ActivityLine scope="card" activity={a} />)`.
- [x] Mount in `CardEditor.tsx` after `<CommentList .../>` (`CardEditor.tsx:140-147`),
  before the action-buttons `<div className="mt-4 ...">` (line 149). Additive —
  one new `<CardActivity cardId={card.id} />`. No changes to `CardEditor` props
  (it already has `card.id`).

## 4. Per-board feed (`features/board/components/BoardActivityPanel.tsx`)
- [x] Props: `{ boardId: string }`.
- [x] Paginated query (audit L1 — there is NO `useInfiniteQuery`/`infiniteQueryOptions`
  precedent anywhere in the FE; do NOT introduce one). Use the simple offset
  approach: `const [items, setItems] = useState<Activity[]>([])` +
  `const [offset, setOffset] = useState(0)`, and
  `useQuery(trpc.activity.listForBoard.queryOptions({ boardId, limit: 50, offset }))`.
  On each successful page, append `data.items` to `items` and remember
  `data.nextOffset`. "Load more" sets `offset = nextOffset`. Matches `backup`
  list ergonomics.
- [x] Render newest-first list of `<ActivityLine scope="board" />`; a "Load more"
  button shown only while `nextOffset !== null`; empty + loading states.
- [x] Open it from `BoardDetailPage` header (audit L3): add a `History` (lucide)
  button next to "Manage labels" (`BoardDetailPage.tsx:306-315`) / "Manage access"
  (line 316-325). UNLIKE those — which are gated `editable` / `isOwner(board)` —
  the History button is rendered UNCONDITIONALLY (the page only loads for users
  with at least `view`, and read needs only `view`). Add
  `const [showActivity, setShowActivity] = useState(false)` (next to
  `showAccess`/`showLabels` at lines 54-55) and a modal block UNGATED (not wrapped
  in `isOwner`/`editable` like lines 401-421):
  `<Modal open={showActivity} onClose={() => setShowActivity(false)} title="Board activity" widthClassName="max-w-lg"><BoardActivityPanel boardId={board.id} /></Modal>`.

## 5. Tests (vitest, mirror `CommentList.test.tsx` / `CommentItem.test.tsx`)
- [x] `describeActivity` unit test: every `ActivityType` value produces a
  non-empty sentence and an icon; assert specific phrasing for a representative
  set (rename, move, label, assignee, due, comment, member-granted); unknown type
  hits the `default` branch without throwing. (Iterate `Object.values(ActivityType)`
  so adding a type without a case fails the test.)
- [x] `CardActivity` test: mocks `trpc.activity.listForCard` (mirror how
  `CommentList.test.tsx` mocks tRPC) — renders lines for returned activities;
  shows the empty state when none; shows loading state.
- [x] `BoardActivityPanel` test: renders a page of activities; "Load more" is
  shown when `nextOffset` is non-null and hidden when null; clicking it requests
  the next offset and appends (assert the second page rows appear).
- [x] `BoardDetailPage` test (extend existing `BoardDetailPage.test.tsx`):
  the History button is present for a view-only user and opens the modal.
- [x] Scope behaviour: `scope="card"` omits the card name; `scope="board"`
  includes it (assert the rendered text differs for the same activity).

## 6. Verify
- [x] `pnpm --filter frontend test` green.
- [x] `pnpm --filter frontend build` (types from `shared` resolve;
  `ActivityType` switch is exhaustive).
- [x] Manual: open a card -> Activity section lists recent card events; open the
  board History modal -> feed paginates with "Load more". (e2e only on dev/prod
  per project rules — not local.)
</content>
