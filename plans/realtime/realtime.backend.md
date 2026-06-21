# Realtime Sync — Backend Plan

Live board updates: when one user mutates a board (card/column/label/assignee/
comment/checklist/attachment add/move/edit/archive), other users viewing the
SAME board refetch automatically. Scope is **cache-invalidation-on-event**, not
CRDT/OT: the server broadcasts a lightweight `board:{boardId}` "something
changed" event; clients refetch `boards.getData` (and `activity.listForCard`
when a card is open). No payload diff, no patch — just an invalidation signal
plus enough context to skip self-echo.

> AUDIT STATUS: every referenced file was read and verified. See
> `realtime.audit.md` for the full findings. This plan was rewritten to fix the
> P0/P1 issues (exact mount position, the COMPLETE set of 16 missing publish
> points, payload privacy, deferred shutdown hook).

## Transport decision: SSE over the existing Express server

Chosen: **Server-Sent Events (SSE)** on a plain Express GET route, NOT WebSocket
and NOT tRPC subscriptions. Justification grounded in what is actually wired:

- `packages/backend/src/index.ts` mounts tRPC via
  `createExpressMiddleware({ router: appRouter, createContext, onError })` and
  the REST layer via `createOpenApiExpressMiddleware`. There is **no**
  `wsAdapter`/`applyWSSHandler`, no `httpServer.on("upgrade")`, and the tRPC
  client (`packages/frontend/src/lib/trpc.ts`) uses only `httpBatchLink` — there
  is **no `httpSubscriptionLink`/`wsLink` / `splitLink`**. Adding tRPC
  subscriptions would require a WS adapter + a new link + a separate auth path
  for the WS handshake. Not justified for one-way invalidation.
- WebSocket needs an HTTP upgrade path; the app currently only does
  `app.listen(env.PORT, ...)` with no reference to the underlying server for an
  upgrade handler, and nginx would need explicit `Upgrade`/`Connection` proxy
  config. SSE is plain HTTP GET over the same origin — it passes through nginx
  and the existing cookie flow unchanged.
- Events are strictly **server -> client, fire-and-forget**. SSE is the exact
  fit; the browser `EventSource` auto-reconnects.
- Auth: SSE reuses the **same `access_token` httpOnly cookie**. The route is a
  custom Express router (mirror `attachment.http.ts`) that replicates the
  `protectedProcedure` flow — it cannot be a tRPC procedure because tRPC's HTTP
  adapter is request/response, not a long-lived stream, on this setup.

### Buffering / proxy hazards (VERIFIED)
- [x] **No `compression` middleware exists today** (grep clean in
  `packages/backend/src`). HARD RULE: do NOT add a global `compression()` — it
  would buffer/break `text/event-stream`. If compression is ever added, it MUST
  be mounted AFTER the SSE route or skip `text/event-stream` via its `filter`.
- [x] `helmet`, `pino-http`, `metricsMiddleware` do NOT buffer the response body
  (verified: they set headers / wrap logging / time the request). Confirm
  `metricsMiddleware` tolerates a multi-minute open response without leaking its
  per-request timer (note during impl; acceptable).
- [x] **csrfGuard does not apply.** In `index.ts` `csrfGuard` is wired ONLY on
  the `/trpc` mount (line 119), never on `/api`. Even if it did, it treats GET as
  safe (line 93). EventSource (a GET that cannot set `x-requested-with`) is fine.
- [x] **nginx:** `packages/infra/proxy/snippets/proxy_headers.conf` sets
  `proxy_http_version 1.1` (good for SSE upstream keep-alive). No
  `proxy_read_timeout` override -> default 60s idle; the 25s heartbeat stays
  under it. The app sets `X-Accel-Buffering: no` to disable nginx response
  buffering. OPTIONAL defense-in-depth (recommended): add a dedicated location in
  `default.conf.template` backend block:
  `location ~ ^/api/boards/[^/]+/events$ { include snippets/proxy_headers.conf;
  proxy_pass http://backend:4000; proxy_buffering off; proxy_cache off;
  proxy_read_timeout 1h; }`. The `X-Accel-Buffering` header alone is sufficient
  for MVP.

## API endpoints
- [x] `GET /api/boards/{boardId}/events` — SSE stream of board change events for one board; auth (cookie) + board `view`; emits `data: {type}` events + `:` heartbeat comments (Express, long-lived, no OpenAPI doc — same as backup/sso/attachment HTTP routes)

No tRPC endpoints, no new mutations, **no DB migration** (confirmed: realtime is
transient pub/sub; nothing is persisted — events are derived from existing
mutations and never stored).

## 1. Event bus module (`features/realtime/realtime.bus.ts`)

A transport-agnostic publish/subscribe bus with two backends, selected at
runtime by `env.REDIS_URL` (mirrors the lazy ioredis singleton pattern already
verified in `features/health/health.http.ts` lines 16-28).

- [x] define the payload type (export from `shared`, see section 2):
  `BoardEvent = { boardId: string; type: BoardEventType; actorId: string; ts: number; cardId?: string }`.
- [x] `subscribe(boardId, listener): () => void` — register a listener for one
  board; returns an unsubscribe fn. Used per SSE connection.
- [x] `publish(event: BoardEvent): void` — fan the event to all listeners on
  `event.boardId`, across ALL server instances.
- [x] **in-process backend (REDIS_URL empty — local dev):** back `subscribe`/
  `publish` with a single Node `EventEmitter`. Channel = the `boardId` string
  used as the emitter event name. `setMaxListeners(0)` (unbounded) so many open
  tabs don't trigger the leak warning. DEFAULT, zero infra (matches the
  "not required for local env" rule in CLAUDE.md).
- [x] **Redis backend (REDIS_URL set — dev/prod VPS):** lazily construct TWO
  ioredis clients (publisher + DEDICATED subscriber — a connection in subscribe
  mode CANNOT issue normal commands; verified necessary). Use the SAME options
  as `health.http.ts`: `{ lazyConnect: true, maxRetriesPerRequest: 1,
  enableOfflineQueue: false }` and `client.on("error", ...)` to swallow/log once.
  Do NOT reuse the health-check client.
  - channel naming: `board:{boardId}` (namespaced so other Redis users on the
    same instance don't collide; the bus owns the `board:` prefix).
  - `publish(event)` -> `pub.publish("board:"+boardId, JSON.stringify(event))`.
  - the subscriber client `PSUBSCRIBE board:*` ONCE on first use; on
    `pmessage`, `boardEventSchema.parse(JSON.parse(payload))` and dispatch to the
    in-process listener map keyed by `boardId`.
  - keep a local `Map<boardId, Set<listener>>`; Redis fans BETWEEN instances,
    the local map fans WITHIN an instance. When REDIS_URL set, `publish` writes
    to Redis ONLY (the originating instance receives its own pmessage, so do NOT
    also call local listeners directly — avoids double-delivery). When REDIS_URL
    empty, `publish` calls local listeners directly (no Redis loopback).
- [x] on Redis client `error`, log once and let the in-process map keep serving
  same-instance subscribers (degraded cross-instance, never crash). Heartbeats
  keep SSE connections alive regardless.
- [x] export a single module-level `bus` singleton; the SSE route and the
  publish call sites import it. Keep it injectable for tests (export the factory
  `createBus(deps)` + the default `bus`, mirroring `attachment.storage.ts`).
- [x] export a `bus.close()` (quit both Redis clients, clear the Map) so a
  future SIGTERM handler can call it. Not wired to a signal handler in MVP (see
  section 5); just present.

## 2. Shared types (`packages/shared`)

- [x] `src/realtime.schema.ts` — `BoardEventType` const object +
  `BoardEventTypeValue`: `BOARD_CHANGED` (catch-all board structure/content),
  `CARD_ACTIVITY` (a card-scoped change that should also refresh open card
  activity). Export `boardEventSchema`
  (`{ boardId, type, actorId, ts, cardId? }`) for parse-on-read in the bus.
- [x] **PRIVACY (P1):** the schema MUST carry ONLY these 5 fields. NEVER add card
  titles, bodies, descriptions, or any mutation content. A stale/revoked
  subscriber must learn only "board X changed", then re-fetch through the normal
  authorized `boards.getData` (which re-checks permission server-side).
- [x] `src/index.ts` barrel — add `export * from "./realtime.schema.js";`
  (the barrel is explicit, not auto-discovered).
- [x] `pnpm --filter shared build` so backend + frontend pick up the type.

## 3. Where events are PUBLISHED — recorder chokepoint + the COMPLETE gap list

Primary: **publish from the activity recorder (`activity.recorder.record`)**.
VERIFIED `record(db, ...)` is imported and called from card, column, label,
assignee, comment, checklist, attachment, board services. Publishing there is
DRY and covers every change that records activity, with `boardId`, `actorId`,
`cardId` already in `RecordInput`.

- [x] in `activity.recorder.record`, AFTER the insert (inside the same fn, also
  best-effort / never throws — wrap in its OWN try/catch so a bus failure cannot
  break the audit insert and vice-versa): call
  `bus.publish({ boardId: input.boardId, actorId: input.actorId, ts: Date.now(), type: input.cardId ? CARD_ACTIVITY : BOARD_CHANGED, cardId: input.cardId ?? undefined })`.
  Rationale: a card-scoped activity (`cardId` present) should refresh both
  `boards.getData` AND any open `activity.listForCard`; board-scoped refreshes
  only `boards.getData`.

### The COMPLETE set of mutations that change `boards.getData` but do NOT call `record`

Recorder-only would MISS all of these = stale UI on other clients. VERIFIED each
exported mutation. Add an EXPLICIT `bus.publish` at each path below. Invariant:
**every mutation that changes anything `boards.getData` returns MUST publish.**

BOARD_CHANGED (no cardId):
- [x] `card.service.moveCard` — same-column reorder (the `else` of the
  `if (input.toColumnId !== column.id)` at L369). Publish
  `{ boardId: column.board_id, actorId: user.id, ts: Date.now(), type: BOARD_CHANGED }`.
  (Do NOT broaden the recorder to log a CARD_MOVED — that changes activity-feed
  semantics, out of scope.)
- [x] `column.service.createColumn` (L69) — publish BOARD_CHANGED (`row.board_id`).
- [x] `column.service.updateColumn` / rename (L94) — load gives `board_id`;
  publish BOARD_CHANGED.
- [x] `column.service.deleteColumn` (L106) — publish BOARD_CHANGED (capture
  `board_id` from `loadColumnFor` BEFORE delete).
- [x] `column.service.moveColumn` / reorder (L168) — publish BOARD_CHANGED.
- [x] `label.service.createLabel` (L105) — publish BOARD_CHANGED (labels render
  on card chips in `boards.getData`).
- [x] `label.service.updateLabel` / name+color (L119) — publish BOARD_CHANGED.
- [x] `label.service.deleteLabel` (L131) — publish BOARD_CHANGED.
- [x] `board.service.updateBoard` / rename+desc+color (L223) — publish
  BOARD_CHANGED (name/color render on the board view).
- [x] `board.service.deleteBoard` (L235) — publish BOARD_CHANGED (so other
  viewers' `boards.getData` refetch -> 404 -> page handles gone board).

CARD_ACTIVITY (carry `cardId` — these services hold it at the call site):
- [x] `checklist.service.updateChecklist` / rename (L197) — carries
  `checklist.card_id`; publish CARD_ACTIVITY.
- [x] `checklist.service.updateItem` — TEXT-ONLY edit branch (the existing record
  only fires when `isDone` changed, L265). For a text edit with no isDone change,
  publish CARD_ACTIVITY (`checklist.card_id`).
- [x] `checklist.service.deleteItem` (L279) — publish CARD_ACTIVITY
  (`checklist.card_id`; capture before delete).
- [x] `checklist.service.moveItem` / reorder (L289) — publish CARD_ACTIVITY
  (`item.checklist_id` -> resolve card_id; the loaded `checklist.card_id` is
  available via `loadItemFor`).
- [x] `comment.service.updateComment` / edit (L217) — publish CARD_ACTIVITY
  (`row.card_id`).
- [x] `comment.service.deleteComment` (L237) — publish CARD_ACTIVITY
  (`row.card_id`; capture before delete).

### Intentionally NOT published (documented)
- `card.service.updateCard` with reminderMinutes ONLY — not in `boards.getData`.
- `board.service.createBoard`, `column.service.createColumn`-on-empty,
  `board.service.createBoard` — a brand-new board/empty board has no other
  viewers yet. (createColumn IS published above because the board may have
  viewers.)
- assignee assign/unassign no-op branches (nothing changed).

> All explicit `bus.publish` calls must be best-effort: never throw, never block
> the mutation's response. Wrap or rely on the bus's internal try/catch.

## 4. SSE route (`features/realtime/realtime.http.ts`)

Mirror `attachment.http.ts` for the Router + cookie auth; copy its `requireUser`
middleware (VERIFIED it replicates the full `protectedProcedure` flow).

- [x] `createRealtimeHttpRouter({ db, bus })` returning an Express `Router`;
  export a default `realtimeHttpRouter` bound to `appDb` + the `bus` singleton.
- [x] `requireUser(db)` middleware — copy `attachment.http.ts requireUser`
  verbatim (cookie -> `verifyAccessToken(token).sub` -> `findPublicUserById` ->
  `!email_verified` reject -> `findUserGlobalPerms` for `isSuperuser` -> attach
  `req.authUser = { id, isSuperuser }`). 401 on any failure. No CSRF (GET).
- [x] `GET /boards/:boardId/events`:
  1. `requireUser` already ran -> `const user = req.authUser!`.
  2. **subscribe authorization:** `await loadBoardFor(db, user, boardId, "view")`
     in try/catch; on the thrown TRPCError respond `403`/`404` and return (reuse
     a small status map like attachment's `STATUS`). A private board reads as
     NOT_FOUND (no existence leak).
  3. set SSE headers: `Content-Type: text/event-stream`,
     `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`,
     `X-Accel-Buffering: no`. `res.flushHeaders()`. Write `: connected\n\n`.
  4. register the listener: `const off = bus.subscribe(boardId, (ev) =>
     res.write("data: " + JSON.stringify(ev) + "\n\n"))`.
  5. **heartbeat:** `setInterval` every ~25s writing `: ping\n\n` (under the 60s
     nginx idle default). Keeps nginx + browser from closing an idle stream.
  6. **cleanup on disconnect (no leak):** `req.on("close", () => {
     clearInterval(hb); off(); res.end(); })`. Handles tab close, navigation,
     network drop. One connection = one board subscription; N tabs = N
     connections (per-tab lifecycle is automatic).
  7. (deferred hardening) periodic `loadBoardFor` re-check on the heartbeat tick
     to stop streaming on mid-session revocation. MVP checks on subscribe only;
     payload privacy (§2) makes a stale subscriber harmless until reconnect.

## 5. Wire into `index.ts`

- [x] `import { realtimeHttpRouter } from "./features/realtime/realtime.http.js"`
  and `app.use("/api", realtimeHttpRouter)` placed IMMEDIATELY AFTER the existing
  `app.use("/api", attachmentHttpRouter)` (line 114) and BEFORE the `/api`
  `express.json()` + OpenAPI middleware (line 124). The SSE route MUST NOT pass
  through the JSON body parser or be shadowed by the OpenAPI catch-all.
- [x] graceful shutdown: there is no shutdown hook today (only `app.listen`,
  L140). Deferred for MVP. The bus exposes `close()` (§1) for a future SIGTERM
  handler that would also end open SSE responses. Document the deviation; do not
  add a shutdown framework just for this.

## 6. Testing cases (`features/realtime/test/`)

Use the existing pg-mem + tRPC caller helpers (re-exported from `board/test`),
and an injected in-proc `bus` so no live Redis is needed. For the HTTP route,
use `supertest` driving a real `express()` with the router mounted (read the
first chunks then end the request).

- [x] **event published via recorder:** in-proc bus, subscribe to `boardId`, run
  each recorder-backed mutation (create card, move cross-column, add comment, add
  attachment, archive column, grant access) and assert exactly one `BoardEvent`
  with correct `boardId`, `actorId`, `type` (CARD_ACTIVITY when `cardId` set).
- [x] **explicit-publish gap coverage — assert EACH of the 16 paths fires a
  BoardEvent AND records NO new activity row** (assert activities table count is
  unchanged for: same-column moveCard, create/rename/delete/move column,
  create/update/delete label, rename checklist, text-only item edit, delete item,
  move item, edit comment, delete comment, updateBoard, deleteBoard).
- [x] **type mapping:** column/label/board paths emit BOARD_CHANGED (no cardId);
  checklist/comment paths emit CARD_ACTIVITY with the right `cardId`.
- [x] **subscribe authz:** SSE GET as a no-access user -> 404 (no existence
  leak); as a view-only member -> 200 + stream opens; a non-member never
  receives the board's events.
- [x] **board scoping:** an event on board A is NOT delivered to a board-B listener.
- [x] **redis fallback:** REDIS_URL empty -> `publish` reaches same-instance
  `subscribe`. REDIS_URL set (mocked ioredis pub/sub) -> publish on instance 1
  reaches subscribe on instance 2 via `board:{id}`; originating instance receives
  via pmessage EXACTLY once (no double-delivery).
- [x] **self-echo metadata:** every event carries the mutating user's `actorId`.
- [x] **payload privacy:** assert the serialized event contains ONLY
  `{ boardId, type, actorId, ts, cardId? }` — no titles/bodies.
- [x] **heartbeat:** SSE response receives `: ping` within the interval (fake timers).
- [x] **cleanup on disconnect:** after client close, listener count for the board
  returns to its prior value and the heartbeat interval is cleared.
- [x] **auth replication:** SSE GET with no cookie / bad token / unverified user
  -> 401.

## 7. Verify
- [x] `pnpm --filter shared build`
- [x] `pnpm --filter backend test` green (bus + Redis faked)
- [x] boot with `REDIS_URL` empty does NOT crash; in-proc bus serves a single
  instance; SSE stream opens and delivers events.
- [x] boot with `REDIS_URL` set connects pub + subscriber lazily;
  `/health/ready` redis check still passes (no extra always-on connection at boot).
