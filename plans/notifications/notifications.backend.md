# Notifications Center (in-app inbox) — Backend Plan

An in-app notification inbox. A `notifications` row is created at the SAME three
moments the app already sends an email — comment `@mention`, card assigned, and
card due-soon reminder — alongside the email, never replacing it. Each row stores
a self-contained JSONB `payload` (boardId, cardId, actor handle, title/snippet)
so the bell list renders + links with NO extra lookups. The recipient sees a bell
with an unread badge; the badge updates live by reusing the realtime SSE bus with
a NEW per-user channel (`user:{userId}`) + a per-user SSE endpoint; if SSE is
unavailable the bell still works via query refetch (refetch-on-focus +
mark-read). A user only ever sees/marks their OWN notifications (`user_id =
ctx.user.id`, never an input).

Mirror `features/comment` + `features/assignee` + `features/activity` patterns:
`*.router.ts` / `*.service.ts` / `*.repo.ts` + `test/<endpoint>.spec.ts`, Kysely,
tRPC `protectedProcedure`, Zod from `shared`, OpenAPI `.meta`, superjson. Mirror
`features/realtime` (`realtime.bus.ts` / `realtime.http.ts`) for the user-channel
bus extension + the SSE endpoint.

> GROUNDING (every file read + verified):
> - Email + creation points ALREADY EXIST and already call `record(...)`:
>   - mention: `comment.service.createComment` `comment.service.ts:186-213` —
>     resolves board members via `repo.listBoardMembers(db, boardId)`, filters
>     `m.id !== user.id` (NO self-mention) AND a name match, then loops
>     `email.sendCommentMention(m.email, title, snippet, link)`. The matched set =
>     the exact recipient set for notifications.
>   - assign: `assignee.service.assign` `assignee.service.ts:108-125` — only
>     inside `if (!existing)` (genuinely NEW assignment); sends
>     `email.sendCardAssigned(target.email, ...)` only when `target.id !== user.id`
>     (NO self-assign). `target` (id+email) is in hand; `boardId` from
>     `resolveCardBoard(..., "edit")`.
>   - due: `card.reminder.runDueReminders` `card.reminder.ts:39-44` — resolves
>     `members = commentRepo.listBoardMembers(db, column.board_id)` and loops
>     `email.sendCardDueSoon(m.email, card.title, link)` for EVERY board member.
>     There is NO actor here (a scheduled job, not a user) — see §4 self-rule.
> - `EmailPort` `email.service.ts:5-17` already has `sendCommentMention`,
>   `sendCardAssigned`, `sendCardDueSoon`. NO email change in this plan.
> - JSONB precedent: `db/types.ts` `ActivitiesTable.meta` /
>   `BoardViewsTable.config` both use `ColumnType<T, string, string>` and the
>   writer `JSON.stringify`s (recorder `JSON.stringify(input.meta ?? {})`; board
>   view repo stringifies on insert AND on-conflict-update). pg-mem accepts a raw
>   object so a missing stringify passes tests but corrupts prod ("[object
>   Object]") — ALWAYS stringify.
> - Realtime bus `realtime.bus.ts`: channel prefix `board:` hardcoded
>   (`CHANNEL_PREFIX`, `PATTERN = board:*`); `subscribe(boardId, listener)` keys a
>   `Map<string, Set>`; Redis `psubscribe("board:*")`. Bus is board-scoped TODAY —
>   it must be extended to ALSO carry a user channel (see §3).
> - SSE route `realtime.http.ts`: `requireUser(db)` replicates `protectedProcedure`
>   from the `access_token` cookie; `GET /boards/:boardId/events` authorizes via
>   `loadBoardFor`, sets SSE headers, `bus.subscribe`, 25s heartbeat, cleanup on
>   `req.on("close")`. Mounted in `index.ts:119` `app.use("/api", realtimeHttpRouter)`
>   BEFORE the JSON body parser + OpenAPI catch-all.
> - trpc context `context.ts:8-16`: `ctx.userId` (string|null) + `ctx.db`.
>   `protectedProcedure` (see `comment.router.ts` `user(ctx)` helper) yields the
>   authed user; notifications use `ctx.user.id` as `user_id` — NEVER an input.
> - ACTOR EMAIL IS ABSENT IN THE SERVICE: `protectedProcedure` puts `email` on
>   `ctx.user` (`trpc.ts:70-76`), BUT `comment.router.ts:15-18` / assignee pass only
>   `user(ctx) = { id, isSuperuser }`, and `CtxUser` (`board.service.ts:26-29`) =
>   `{ id, isSuperuser }`. So `actorHandle` MUST come from a one-row `users.email`
>   lookup inside the service (see §9) — there is no shortcut.
> - Migrations: highest is `019.board-view` -> next is `020.notification`. The
>   test DB helper `auth/test/helpers.ts` hardcodes `up001..up019` (imports L10-28,
>   calls L46-64) — `up020` MUST be registered there or every test that triggers a
>   notification insert silently fails (the recorder swallows errors).
> - `fakeEmail()` (`auth/test/helpers.ts:83`) records sent mail; notifications run
>   ALONGSIDE the email at the same call sites, so existing comment/assignee/
>   reminder tests now also create rows — tests must tolerate / assert that.

## Key decisions (decided)

- **Created alongside the email, after-commit, best-effort (mirror the activity
  recorder).** A new `notification.recorder.create(db, {...})` is called at each
  of the 3 sites right where the email is sent, wrapped in its own try/catch and
  logging via a centralized `LogEvent` (NO string literal — `backend.md` rule). A
  failed notification insert MUST NOT fail the user action or the email. A dropped
  in-app notification is far less harmful than failing a card assign / comment.
- **NEVER notify the actor about their own action** (mirror the email no-self
  rules exactly):
  - mention: the recipient set is `comment.service` `matched` (already excludes
    `m.id === user.id`). Reuse it verbatim.
  - assign: only on NEW assignment AND only when `target.id !== user.id` (mirror
    the email guard).
  - due: the reminder is a SCHEDULED JOB with no acting user — there is no "self"
    to exclude; notify every board member (same set the email uses). The
    `payload.actor` for a due notification is the system (`actor: null` / a
    `"system"` handle), NOT a user. Documented; tested.
- **Recipient must currently have board access.** The email code ALREADY resolves
  the recipient from board membership (`listBoardMembers` / the mention
  `matched`), so reusing those exact sets guarantees board access at creation
  time. No extra access check is added at the creation site. (Read-time isolation
  is by `user_id`, not board access — a revoked user simply stops getting NEW
  notifications; old rows remain in their own inbox and link out, where
  `boards.getData` re-checks access on click. Documented.)
- **JSONB `payload` is self-contained.** It carries enough to render + link with
  no follow-up query: `{ boardId, cardId?, actorHandle, title, snippet? }`. Follow
  the established JSONB pattern: `ColumnType<NotificationPayload, string, string>`
  in `db/types.ts`, `JSON.stringify` on insert, validate the shape with a Zod
  schema (`notificationPayloadSchema`) at the recorder boundary BEFORE stringify.
- **Read-time permission = ownership only.** Every read/mark query is filtered by
  `user_id = ctx.user.id`. There is NO endpoint that takes a `userId` input and
  NO cross-user read. mark-one verifies the row belongs to the caller (update is
  `where id = ? and user_id = caller`); a foreign id affects 0 rows -> NOT_FOUND.
- **Live badge via a NEW user channel on the existing bus; graceful fallback.**
  Extend the bus with `subscribeUser(userId, listener)` + a `UserEvent`
  (`{ userId, kind: "notification", ts }` — a lightweight NUDGE, NO content). The
  recorder publishes one `UserEvent` to the recipient after the insert. A new
  `GET /api/me/notifications/events` SSE endpoint (authed like the board SSE)
  streams it so the recipient's bell refetches unread-count/list. If SSE is
  unavailable the bell still works: the FE refetches on window focus + after any
  mark action (see frontend plan). The event carries NO payload (privacy: a stale
  subscriber learns only "you have a new notification", then refetches through the
  authorized, user-scoped tRPC query).

## API endpoints
- [ ] `GET /me/notifications` — list the caller's notifications, newest-first, paginated `{limit, offset}` (own only; `user_id = ctx.user.id`)
- [ ] `GET /me/notifications/unread-count` — count of the caller's unread notifications (`read_at is null`) for the bell badge
- [ ] `POST /me/notifications/{id}/read` — mark ONE of the caller's notifications read; foreign/unknown id -> NOT_FOUND (no cross-user mark)
- [ ] `POST /me/notifications/read-all` — mark ALL of the caller's unread notifications read; returns `{ updated: number }`
- [ ] `GET /api/me/notifications/events` — per-user SSE stream (Express, long-lived, cookie auth, NO OpenAPI doc — same as board SSE); emits a lightweight `notification` nudge so the bell refetches

No write endpoint creates a notification from the client — rows are
system-generated at the 3 instrumented sites only.

## 1. Database (migration + db types)
- [ ] `migrations/020.notification.ts` (next free number is 020; highest existing
  is `019.board-view`) — mirror `019.board-view.ts` style (`sql` import,
  `gen_random_uuid()` default, `timestamptz` + `now()`). Create `notifications`:
  - `id uuid pk default gen_random_uuid()`
  - `user_id uuid notnull references users.id on delete cascade` (the RECIPIENT;
    cascade so deleting a user removes their inbox)
  - `type text notnull` (the shared `NotificationType` value)
  - `payload jsonb notnull default '{}'::jsonb` (self-contained render+link bag;
    see §2)
  - `read_at timestamptz` (nullable; null = unread)
  - `created_at timestamptz notnull default now()`
  - Indexes:
    - `notifications_user_created_idx` on `(user_id, created_at desc)` — the list
      query (own, newest-first, paginated).
    - `notifications_user_unread_idx` PARTIAL on `(user_id)` `where read_at is null`
      — the unread-count + unread badge (small, hot index). Use the Kysely builder
      form `.createIndex("notifications_user_unread_idx").on("notifications")
      .column("user_id").where(sql.ref("read_at"), "is", null)` (mirror the verified
      partial index in `010.card-due-date.ts:11-16`; pg-mem supports it — also
      `002.rbac.ts:42`).
  - `down` drops the table `.ifExists()`.
- [ ] `db/types.ts` — add `NotificationsTable` (mirror `ActivitiesTable` /
  `BoardViewsTable` jsonb shape):
  ```ts
  import type { NotificationPayload } from "shared";
  export interface NotificationsTable {
    id: Generated<string>;
    user_id: string;
    type: string;
    // jsonb: select returns a parsed object; INSERT MUST send JSON TEXT (the
    // recorder JSON.stringify's it - node-pg sends a raw object as
    // "[object Object]" and corrupts the row, mirror activity audit B1).
    payload: ColumnType<NotificationPayload, string, string>;
    read_at: Timestamp | null;
    created_at: GeneratedTimestamp;
  }
  ```
  Register `notifications: NotificationsTable` in the `Database` interface. Use
  the existing `Timestamp` / `GeneratedTimestamp` aliases (`db/types.ts:16-18`).
- [ ] `migrations/020.notification.spec.ts` (LIVES IN `src/migrations/`, mirror
  `015.card-cover.spec.ts` / the activity migration spec): pg-mem + register
  `gen_random_uuid`, run the prior `up`s needed for the FK chain (`up001` auth is
  enough — `notifications` only FKs `users`), then `up` (020). Assert: up creates
  the table + BOTH indexes (the `(user_id, created_at)` btree and the partial
  unread index); inserting a row with jsonb `payload` (passed as
  `JSON.stringify({...})`, read back as a PARSED object) works; deleting the user
  cascades the rows; `down` drops the table.

## 2. Shared schemas + enum + errors (`packages/shared`)
- [ ] `src/notification.schema.ts`:
  - `NotificationType` — single source of truth `as const` object, 3 values:
    `MENTION: "MENTION"`, `CARD_ASSIGNED: "CARD_ASSIGNED"`,
    `CARD_DUE_SOON: "CARD_DUE_SOON"`. Export
    `type NotificationTypeValue = (typeof NotificationType)[keyof typeof NotificationType]`.
  - `notificationPayloadSchema` — the self-contained render+link bag, validated at
    the recorder boundary:
    ```ts
    z.object({
      boardId: z.string(),
      cardId: z.string().optional(),
      actorHandle: z.string().nullable(),   // null = system (due reminder)
      title: z.string(),                     // card title (enough to render)
      snippet: z.string().optional(),        // mention body preview (~140 chars)
    })
    ```
    `export type NotificationPayload = z.infer<typeof notificationPayloadSchema>`
    (consumed by `db/types.ts` AND the recorder). Conventional payload per type:
    - `MENTION`: `{ boardId, cardId, actorHandle, title, snippet }`
    - `CARD_ASSIGNED`: `{ boardId, cardId, actorHandle, title }`
    - `CARD_DUE_SOON`: `{ boardId, cardId, actorHandle: null, title }`
  - inputs:
    - `listNotificationsInput` = `{ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }`
      (mirror activity/backup list bounds; NO `userId` — the recipient is always
      `ctx.user.id`).
    - `markReadInput` = `{ id: z.string() }`.
    - (unread-count + read-all take NO input.)
  - output `notificationSchema` = `{ id: z.string(), type: z.string(),
    payload: notificationPayloadSchema, readAt: z.date().nullable(),
    createdAt: z.date() }`.
  - output `notificationPageSchema` = `{ items: z.array(notificationSchema),
    nextOffset: z.number().nullable() }` (nextOffset = `offset + items.length`
    when a full page returned, else null — mirror activity feed).
  - output `unreadCountSchema` = `{ count: z.number().int() }`.
  - output `markAllResultSchema` = `{ updated: z.number().int() }`.
  - Export the inferred types the FE consumes: `export type Notification`,
    `export type NotificationPage`.
- [ ] `src/realtime.schema.ts` — EXTEND for the user channel (keep the existing
  `BoardEvent` untouched):
  - `UserEventKind` const object: `NOTIFICATION: "notification"` (room to grow).
  - `userEventSchema` = `z.object({ userId: z.string(),
    kind: z.enum([UserEventKind.NOTIFICATION]), ts: z.number() })`.
    PRIVACY: NO notification content — only a nudge to refetch.
  - `export type UserEvent = z.infer<typeof userEventSchema>`.
- [ ] `src/errors/notification.error.ts` — `NotificationError` `as const` (mirror
  `comment.error` shape + type export): `NOT_FOUND` (the id is unknown OR belongs
  to another user — same message either way, no cross-user existence leak).
- [ ] `src/index.ts` — add `export * from "./notification.schema.js";` and
  `export * from "./errors/notification.error.js";` (the barrel is explicit; it
  does NOT auto-discover — see `index.ts:1-32`).
- [ ] `pnpm --filter shared build` so backend + frontend pick up the new types.

## 3. Bus user-channel extension (`features/realtime/realtime.bus.ts`)
The bus is board-scoped today (`CHANNEL_PREFIX = "board:"`, `PATTERN = board:*`,
`subscribe(boardId, ...)`). Extend it ADDITIVELY with a parallel user channel —
do NOT break the board path.
- [ ] Add `subscribeUser(userId, listener: UserEventListener): () => void` and
  `publishUser(event: UserEvent): void` to the `Bus` interface (alongside the
  existing `subscribe` / `publish`). `UserEventListener = (e: UserEvent) => void`.
- [ ] Keep a SEPARATE local map `userListeners = new Map<string, Set<UserEventListener>>()`
  + an `addUserListener` / `dispatchUser` pair mirroring the board ones
  (`addListener` / `dispatch`).
- [ ] **TWO RETURN OBJECTS:** `createBus` returns one object literal for the in-proc
  branch (`realtime.bus.ts:76-91`) and a DIFFERENT one for the redis branch
  (`:133-160`). `subscribeUser`/`publishUser` must be added to BOTH; missing one =
  the method is undefined under that backend.
- [ ] **in-process backend (REDIS_URL empty):** `subscribeUser` -> `addUserListener`;
  `publishUser` -> try/catch `dispatchUser(event)` (mirror the board branch). Same
  shared `EventEmitter` is fine; the new map is independent.
- [ ] **Redis backend (REDIS_URL set):** namespace a SECOND channel prefix
  `USER_CHANNEL_PREFIX = "user:"` (`USER_PATTERN = "user:*"`).
  - `ensureSub()` must `psubscribe` BOTH patterns. Either call
    `sub.psubscribe(PATTERN, USER_PATTERN)` (ioredis accepts multiple) OR
    `psubscribe("board:*")` + `psubscribe("user:*")`. On `pmessage`, branch on the
    channel prefix: `board:*` -> `boardEventSchema.parse` -> `dispatch`; `user:*`
    -> `userEventSchema.parse` -> `dispatchUser`. The current handler signature is
    `(_pattern, _channel, payload)` (`realtime.bus.ts:116`) and IGNORES the channel
    — rename `_channel` -> `channel` and branch on `channel.startsWith("user:")`.
  - `publishUser(event)` -> `getPub().publish("user:" + event.userId, JSON.stringify(event))`
    with the same `.catch(log)` best-effort wrapper as `publish`.
  - `subscribeUser` calls `ensureSub()` then `addUserListener` (mirror
    `subscribe`).
  - As with the board path: with Redis ON, `publishUser` writes to Redis ONLY (the
    originating instance gets its own `pmessage`), avoiding double-delivery; with
    Redis OFF, `publishUser` dispatches locally only.
- [ ] BOTH `close()` impls add `userListeners.clear()` (in-proc `:87-90`; redis
  `:152-159`).
- [ ] No new singleton — the existing exported `bus` gains the two methods.
- [ ] Add `LogEvent` entries if needed (reuse `RealtimePublishFailed` /
  `RealtimeEventParseFailed` — they are channel-agnostic; no new constant
  required).

## 4. Notification recorder (`features/notification/notification.recorder.ts`)
Single best-effort entry point, mirror `activity.recorder.record`.
- [ ] `create(db, bus, input)` — signature:
  `create(db: Db, bus: Bus, input: { userId: string; type: NotificationTypeValue; payload: NotificationPayload }): Promise<void>`.
  Body:
  ```ts
  try {
    const payload = notificationPayloadSchema.parse(input.payload); // validate shape
    await db.insertInto("notifications").values({
      user_id: input.userId,
      type: input.type,
      payload: JSON.stringify(payload),   // JSONB: MUST stringify (node-pg)
    }).execute();
    bus.publishUser({ userId: input.userId, kind: UserEventKind.NOTIFICATION, ts: Date.now() });
  } catch (err) {
    logger.error({ err, event: LogEvent.NotificationCreateFailed, type: input.type, userId: input.userId }, LogEvent.NotificationCreateFailed);
  }
  ```
  - NEVER throws. `bus` is injected (the singleton from `realtime.bus.ts` at the
    call sites; a fake in tests) so the publish is mockable.
  - The `bus.publishUser` is INSIDE the try AFTER the insert: a publish-only
    failure is already best-effort inside the bus, but if the INSERT throws we do
    NOT publish a phantom nudge.
- [ ] `config/const.config.ts` — add `NotificationCreateFailed:
  "notification.create.failed"` to the `LogEvent` object (mirror
  `ActivityRecordFailed`). Reference `LogEvent.NotificationCreateFailed` (no
  string literal — `backend.md` rule).
- [ ] A tiny helper `handleFromEmail(email)` = `email.split("@")[0]` for
  `actorHandle` (copy the 1-liner; it is file-local in comment/assignee services,
  not exported — token rule "3 similar lines beat a premature abstraction").

## 5. Repo (`features/notification/notification.repo.ts`)
All queries are scoped by `user_id` — the service passes `ctx.user.id`.
- [ ] `listByUser(db, userId, limit, offset)` — `selectFrom("notifications")
  .where("user_id","=",userId).orderBy("created_at","desc").limit(limit)
  .offset(offset)` (mirror `activity.repo.listByBoard`). Select all columns;
  `payload` comes back as a parsed object (jsonb select).
- [ ] `countUnread(db, userId)` — `selectFrom("notifications")
  .where("user_id","=",userId).where("read_at","is",null)
  .select(eb => eb.fn.countAll().as("count"))` ; coerce to `Number`. Uses the
  partial unread index.
- [ ] `markRead(db, userId, id)` — `updateTable("notifications")
  .set({ read_at: sql\`now()\` }).where("id","=",id).where("user_id","=",userId)
  .where("read_at","is",null).executeTakeFirst()`; return the number of updated
  rows (`numUpdatedRows`). The `user_id` predicate is what enforces ownership: a
  foreign id matches 0 rows. (Idempotent: re-marking an already-read row updates 0
  rows and is a successful no-op — the SERVICE decides NOT_FOUND only when the row
  does not belong to the user; see §6.)
- [ ] `markAllRead(db, userId)` — `updateTable("notifications")
  .set({ read_at: sql\`now()\` }).where("user_id","=",userId)
  .where("read_at","is",null).executeTakeFirst()`; return `Number(numUpdatedRows)`.
- [ ] `existsForUser(db, userId, id)` — `selectFrom("notifications").select("id")
  .where("id","=",id).where("user_id","=",userId).executeTakeFirst()` (used by
  the service to distinguish "not yours / unknown" -> NOT_FOUND from "already
  read" -> idempotent success). Cheap single-row lookup.

## 6. Service (`features/notification/notification.service.ts`)
Functions take `(db, user, input)`; `user` is the authed `CtxUser`. The recipient
is ALWAYS `user.id` — there is no `userId` parameter anywhere.
- [ ] `list(db, user, { limit, offset })` — `repo.listByUser(db, user.id, limit,
  offset)`; map rows to `notificationSchema` (`{ id, type, payload, readAt:
  read_at, createdAt: created_at }`); compute
  `nextOffset = items.length === limit ? offset + items.length : null`; return
  `{ items, nextOffset }`.
- [ ] `unreadCount(db, user)` — `return { count: await repo.countUnread(db, user.id) }`.
- [ ] `markRead(db, user, { id })` — first
  `const row = await repo.existsForUser(db, user.id, id)`; if `!row` throw
  `TRPCError NOT_FOUND` (`NotificationError.NOT_FOUND`) — covers both unknown id
  AND another user's id (no cross-user existence leak). Else
  `await repo.markRead(db, user.id, id)` (0 updated rows when already read is a
  fine no-op); return `{ ok: true }` (or the refreshed row — return `{ ok: true }`
  for simplicity; the FE refetches the list/count).
- [ ] `markAllRead(db, user)` — `return { updated: await repo.markAllRead(db, user.id) }`.

## 7. Router (`features/notification/notification.router.ts`)
- [ ] tRPC `notificationsRouter`. Mirror `comment.router.ts` `user(ctx)` helper +
  `.meta` openapi shape. Plural key `notifications` (every feature except
  `activity` uses a plural key).
  - `list` — `protectedProcedure`, `.meta` openapi GET `/me/notifications`, input
    `listNotificationsInput`, output `notificationPageSchema`, `.query` ->
    `list(ctx.db, user(ctx), input)`.
  - `unreadCount` — `protectedProcedure`, `.meta` openapi GET
    `/me/notifications/unread-count`, input `z.void()` (or no input), output
    `unreadCountSchema`, `.query` -> `unreadCount(ctx.db, user(ctx))`.
  - `markRead` — `protectedProcedure`, `.meta` openapi POST
    `/me/notifications/{id}/read`, input `markReadInput`, output
    `z.object({ ok: z.literal(true) })`, `.mutation` ->
    `markRead(ctx.db, user(ctx), input)`.
  - `markAllRead` — `protectedProcedure`, `.meta` openapi POST
    `/me/notifications/read-all`, input `z.void()` (or no input), output
    `markAllResultSchema`, `.mutation` -> `markAllRead(ctx.db, user(ctx))`.
- [ ] Register `notifications: notificationsRouter` in `trpc/router.ts` (add the
  import + the line in `appRouter`, alongside `activity` / `boardViews`).

## 8. Per-user SSE route (`features/realtime/realtime.http.ts`)
Add a SECOND route to the EXISTING realtime router (the bus + `requireUser` are
already there). Do NOT create a new file — keep all SSE in one place.
- [ ] `GET /me/notifications/events`:
  1. `requireUser(db)` runs first -> `const user = req.authUser!`. (NO board
     authorization — the only resource is the caller's own user channel, already
     authenticated as them. Authz == authentication here.)
  2. Set the SAME SSE headers as the board route (`Content-Type:
     text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection:
     keep-alive`, `X-Accel-Buffering: no`), `res.flushHeaders()`, write
     `: connected\n\n`.
  3. `const off = bus.subscribeUser(user.id, (ev) => res.write("data: " +
     JSON.stringify(ev) + "\n\n"))`.
  4. 25s heartbeat (`: ping\n\n`), reusing the existing `HEARTBEAT_MS`.
  5. Cleanup on `req.on("close")`: `clearInterval(hb); off(); res.end()`.
- [ ] No `index.ts` change needed — the router is already mounted at
  `app.use("/api", realtimeHttpRouter)` (`index.ts:119`), so the new route is
  served at `/api/me/notifications/events`, ahead of the JSON parser + OpenAPI
  catch-all (correct for a long-lived stream).
- [ ] nginx: same as the board SSE — `X-Accel-Buffering: no` is sufficient; the
  optional dedicated `location` block could match `^/api/me/notifications/events$`
  with `proxy_buffering off; proxy_read_timeout 1h;` (defense-in-depth, not
  required for MVP — mirror the realtime backend plan note).

## 9. Instrument the 3 creation points (one `create(...)` call alongside each email)
Each site ALREADY resolves the recipient set + boardId + card title for the email.
Reuse them; add the notification create where the email is sent. `create` is
best-effort (swallows its own errors), so no try/catch at the call site.

### comment.service.createComment — `@mention` (`comment.service.ts:186-213`)
- [ ] Inside the existing `if (matched.length)` block, AFTER `email.sendCommentMention`
  in the `for (const m of matched)` loop (or a second loop over the same
  `matched`), call for EACH `m`:
  `await create(db, bus, { userId: m.id, type: NotificationType.MENTION, payload: { boardId, cardId: input.cardId, actorHandle: handleFromEmail(<actor email>), title, snippet } })`.
  - `matched` already excludes the author (`m.id !== user.id`) -> NO self-mention.
  - `title` = the `card?.title ?? "card"` already fetched (`comment.service.ts:204-208`);
    `snippet` = the `input.body.slice(0,140)` already computed (line 202);
    `boardId` from `resolveCardBoard`.
  - actor email (DECIDED — no alternative): `createComment` has `user` (CtxUser
    `{ id, isSuperuser }`, `board.service.ts:26-29`) WITHOUT email, so fetch it once
    BEFORE the `matched` loop:
    `db.selectFrom("users").select(["email"]).where("id","=",user.id).executeTakeFirst()`
    then `handleFromEmail(row.email)` (mirror the activity actor-handle convention).
- [ ] `bus` import: `import { bus } from "../realtime/realtime.bus.js"` is ALREADY
  present in `comment.service.ts:15`. Reuse it.

### assignee.service.assign — card assigned (`assignee.service.ts:108-125`)
- [ ] WARNING — guard placement: inside `if (!existing)` (`assignee.service.ts:108`)
  the activity `record(...)` runs UNCONDITIONALLY (`:114-124`), but the EMAIL is
  gated by `if (target.id !== user.id)` (`:111-113`). The notification MUST sit
  WITH THE EMAIL (inside `if (target.id !== user.id)`), NOT next to `record` — a
  self-assign must produce NEITHER email NOR notification (else recipient-set drift).
- [ ] Inside `if (!existing)`, inside `if (target.id !== user.id)`, right next to
  the `email.sendCardAssigned(...)` call:
  `await create(db, bus, { userId: target.id, type: NotificationType.CARD_ASSIGNED, payload: { boardId, cardId, actorHandle: handleFromEmail(<actor email>), title } })`.
  - `title` = the `await cardTitle(db, cardId)` already fetched (line 110);
    `target` (id+email) already in hand; `boardId` from `resolveCardBoard`.
  - actor email (DECIDED): one cheap
    `db.selectFrom("users").select(["email"]).where("id","=",user.id).executeTakeFirst()`
    -> `handleFromEmail` (CtxUser has no email; single-mutation path).
- [ ] `bus` import: `assignee.service.ts` does NOT import the bus today — add
  `import { bus } from "../realtime/realtime.bus.js"`.

### card.reminder.runDueReminders — due-soon (`card.reminder.ts:39-44`)
- [ ] In the `for (const m of members)` loop, right after
  `email.sendCardDueSoon(m.email, card.title, link)`:
  `await create(db, bus, { userId: m.id, type: NotificationType.CARD_DUE_SOON, payload: { boardId: column.board_id, cardId: card.id, actorHandle: null, title: card.title } })`.
  - NO actor (scheduled job) -> `actorHandle: null`. There is no "self" to
    exclude — notify every board member, exactly as the email does.
  - `column.board_id`, `card.id`, `card.title` are all in scope.
  - the reminder is idempotent via `reminder_sent_at` (`card.reminder.ts:44`), so
    a card produces notifications ONCE — the notification creation inherits that
    idempotency (it runs in the same per-card pass before `stampReminderSent`).
- [ ] `bus` import: add `import { bus } from "../realtime/realtime.bus.js"` to
  `card.reminder.ts`.

## 10. Test-harness wiring (REQUIRED — do not skip)
- [ ] `features/auth/test/helpers.ts` — `newTestDb` hardcodes `up001..up019`
  (imports L10-28, calls L46-64). Add
  `import { up as up020 } from "../../../migrations/020.notification.js";` and
  call `await up020(db)` after `await up019(db)`. WITHOUT this the test DB has no
  `notifications` table and every notification test (and every comment/assignee/
  reminder test that now also creates a notification) silently drops the row (the
  recorder swallows errors) and unread-count assertions fail confusingly.
- [ ] The 3 creation sites publish to the bus singleton. For tests that assert the
  user-channel nudge, inject a fake/spied bus OR `vi.spyOn(bus, "publishUser")`.
  Because the recorder takes `bus` as a parameter, the service call sites pass the
  singleton; tests can pass a fake recorder or spy the singleton. (NO live Redis —
  the in-proc bus is the default when `REDIS_URL` is empty.)
- [ ] DO NOT BREAK EXISTING EMAIL ASSERTS: existing comment/assignee/reminder specs
  assert on `fakeEmail().sent` (`SentEmail` union `auth/test/helpers.ts:68-75` already
  has `due|mention|assigned`). Notification writes run ALONGSIDE the email and never
  touch the email path, so those asserts stay green — PROVIDED `up020` is registered
  (above). No `SentEmail`/`fakeEmail` change is needed. Re-run the existing
  `features/comment/test`, `features/assignee/test`, and the reminder spec to confirm
  the added writes did not change email counts or throw.

## 11. Tests (pg-mem, mirror `features/activity/test` + `features/comment/test` + `features/realtime/test`)
Reuse `seedUser`/`seedBoard`/`seedBoardAccess`/`seedColumn`/`seedCard`/
`authedCaller`/`makeContext({ db, userId, email })` from `board/test` +
`auth/test/helpers`. Use the shared `fakeEmail()` so the existing mention/assign/
reminder paths still send mail; the notification rows are read directly from the
`notifications` table OR via the new tRPC `list`/`unreadCount`.

### creation at the 3 points
- [ ] **MENTION created:** user A comments `@bob` on a card on a board where bob is
  a member -> exactly one `notifications` row for bob, `type=MENTION`,
  `payload.boardId`/`cardId` correct, `payload.title` = card title,
  `payload.snippet` = body preview, `payload.actorHandle` = A's handle,
  `read_at` null. AND the mention email is still sent (regression).
- [ ] **CARD_ASSIGNED created:** editor assigns bob (a board member) to a card ->
  one row for bob, `type=CARD_ASSIGNED`, `payload.actorHandle` = assigner handle,
  `title` = card title; the assigned email is still sent.
- [ ] **CARD_DUE_SOON created:** `runDueReminders` over a due card with two board
  members -> one row PER member, `type=CARD_DUE_SOON`, `payload.actorHandle` null,
  `title` = card title; each due email still sent; re-running does NOT create a
  second row (reminder_sent_at idempotency).

### NOT created for self
- [ ] mention: A `@mentions` THEMSELVES -> NO notification row for A (mirrors the
  no-self-mention email rule; `matched` already excludes the author).
- [ ] assign: A assigns THEMSELVES -> assignment happens, NO notification row for A
  AND no assigned email (under the same `target.id !== user.id` guard).
- [ ] due: the due reminder has no actor -> notifies every member (including the
  card creator); assert `actorHandle` null and a row exists for each member (this
  documents that "no self" does not apply to the actorless due job).

### isolation — only the recipient sees it
- [ ] a MENTION for bob is returned by `list`/`unreadCount` for bob but NOT for A
  (the actor) and NOT for an unrelated user carol.
- [ ] `list` only ever returns rows where `user_id = ctx.user.id` (seed rows for
  two users; each caller sees only their own, newest-first).

### mark read / mark all / unread count
- [ ] `unreadCount` returns the number of `read_at is null` rows for the caller;
  decrements after a `markRead`.
- [ ] `markRead({ id })` sets `read_at` on the caller's own row; re-marking the
  same row is an idempotent success (0 rows updated, no error).
- [ ] `markRead` on another user's notification id -> `NOT_FOUND` (no cross-user
  mark; the row is unchanged for its real owner).
- [ ] `markRead` on an unknown id -> `NOT_FOUND`.
- [ ] `markAllRead` marks ALL the caller's unread rows (returns `{ updated: n }`),
  leaves OTHER users' rows untouched, and a second call returns `{ updated: 0 }`.

### payload round-trips JSONB
- [ ] insert via the recorder, read back via `list`: `payload` is a PARSED object
  equal to the input (`expect(item.payload).toEqual({ boardId, cardId,
  actorHandle, title, snippet })`) — confirms the `JSON.stringify` insert path
  (note: pg-mem accepts a raw object too, so this does NOT catch the prod
  corruption bug; the `JSON.stringify` in the recorder is the real guard — keep
  it). Invalid payload shape (missing `boardId`) is rejected by
  `notificationPayloadSchema.parse` in the recorder and logged, NOT inserted, and
  does NOT throw (best-effort).

### user-channel bus event published
- [ ] creating a notification calls `bus.publishUser` exactly once with
  `{ userId: <recipient>, kind: "notification" }` (spy the bus / inject a fake);
  one publish per recipient (e.g. two due-reminder members -> two `publishUser`).
- [ ] bus extension unit test (in `features/realtime/test`, mirror the existing
  bus test): `subscribeUser` receives an event from `publishUser` for the SAME
  userId; a DIFFERENT userId's listener does NOT; user events and board events do
  not cross channels; Redis-mode (mocked ioredis) `publishUser` on instance 1
  reaches `subscribeUser` on instance 2 via `user:{id}` and the originating
  instance receives it via pmessage EXACTLY once.

### recorder failure is best-effort
- [ ] force the `notifications` insert to throw (drop the table in one test, or
  mock `db.insertInto`) -> the comment/assign/reminder action still SUCCEEDS, the
  email is still sent, an error is logged (`vi.spyOn(logger, "error")`), and no
  exception propagates; `bus.publishUser` is NOT called when the insert failed.

### per-user SSE route (supertest, mirror the board SSE test)
- [ ] `GET /api/me/notifications/events` with no cookie / bad token / unverified
  user -> 401 (`requireUser`).
- [ ] with a valid cookie -> 200 + `text/event-stream`; a `bus.publishUser` for
  THAT user writes a `data:` line to the stream; a `publishUser` for ANOTHER user
  does NOT; heartbeat `: ping` arrives within the interval (fake timers); client
  close clears the interval and unsubscribes (listener count returns to prior).

### migration
- [ ] `migrations/020.notification.spec.ts`: up creates the table + the
  `(user_id, created_at)` index + the PARTIAL unread index; jsonb payload
  round-trip; user-delete cascade; down drops.

## 12. Verify
- [ ] `pnpm --filter shared build`
- [ ] `pnpm --filter backend test` green (email via `fakeEmail`; bus is the
  in-proc default / spied; Redis faked for the bus extension test).
- [ ] `pnpm --filter backend migrate` auto-discovers `020.notification` (the live
  runner globs `migrations/` — `scripts/migrate.script.ts`; verified via the
  pg-mem migration spec; live Postgres not run locally).
- [ ] Swagger shows `/me/notifications`, `/me/notifications/unread-count`,
  `/me/notifications/{id}/read`, `/me/notifications/read-all`. The SSE route is
  long-lived Express (no OpenAPI doc — same as the board SSE / attachment routes).
- [ ] boot with `REDIS_URL` empty: in-proc bus serves the user channel on a single
  instance; `/api/me/notifications/events` opens and delivers the nudge. boot with
  `REDIS_URL` set: pub + subscriber connect lazily and `psubscribe` BOTH
  `board:*` and `user:*`.
