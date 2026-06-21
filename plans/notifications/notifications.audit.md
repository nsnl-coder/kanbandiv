# Notifications Center — Production-Readiness Audit

Audit of `notifications.backend.md` + `notifications.frontend.md` against the
ACTUAL codebase (every referenced file opened + verified). Severity: BLOCKER (will
break prod / corrupt data / leak), MAJOR (wrong behavior or test breakage), MINOR
(doc/clarity). Both plan files were REWRITTEN in place with the fixes below.

## Verdict
The plans are accurate and well-grounded. No BLOCKERs in the design. Several MAJOR
line-reference / claim corrections were applied so the implementor does not write
the wrong code. The recipient set at each of the 3 creation points DOES match the
email recipient set (confirmed below).

---

## Recipient-set confirmation (the core ask)

| site | email recipient set (verified) | notification recipient set (plan) | match |
|---|---|---|---|
| `comment.service.createComment` `comment.service.ts:209-211` | `for (const m of matched)` where `matched = members.filter(m => m.id !== user.id && wanted.has(handle))` (`comment.service.ts:191-194`) | same `matched` loop | YES |
| `assignee.service.assign` `assignee.service.ts:111-113` | `if (target.id !== user.id) email.sendCardAssigned(target.email,...)` inside `if (!existing)` (`assignee.service.ts:108`) | same `target`, same `if (!existing)` + `if (target.id !== user.id)` guard | YES |
| `card.reminder.runDueReminders` `card.reminder.ts:41-43` | `for (const m of members)` where `members = listBoardMembers(db, column.board_id)` (`card.reminder.ts:39`); NO actor | same `members` loop, `actorHandle: null` | YES |

No recipient-set drift. No self-notify path: mention `matched` excludes the author;
assign reuses the `target.id !== user.id` email guard; due has no actor.

Double-create risk reviewed:
- comment EDIT (`updateComment` `comment.service.ts:219-244`) does NOT re-run the
  mention block (only `createComment` parses mentions) -> no re-mention notify.
- assign re-assign is a no-op: the whole email+notify block is inside
  `if (!existing)` (`assignee.service.ts:108`) -> a repeat assign creates nothing.
- reminder idempotency: `stampReminderSent` (`card.reminder.ts:44`) + the
  `windowStart`/`reminder_sent_at` gate run once per card; the notify create sits in
  the same per-card pass BEFORE the stamp -> one notification per member per card.

---

## Issues + changes

### I1 (MAJOR) — `CtxUser` has NO email; actor-email fetch is REQUIRED, not optional
`trpc.ts:70-76` puts `email` on `ctx.user`, BUT `comment.router.ts:15-18` and
`assignee` pass only `user(ctx) = { id, isSuperuser }`; `CtxUser`
(`board.service.ts:26-29`) = `{ id, isSuperuser }`. So inside the SERVICE the actor
email is genuinely absent. The backend plan's "fetch the author email once" is
correct and NOT optional. CHANGE: removed the "OR pass user.id" alternative and made
the one-row `users.email` lookup the single decided path at the comment + assignee
sites (mirrors `activity` actor-handle convention; one extra cheap query on a
single-mutation path — acceptable).

### I2 (MAJOR) — assignee: activity `record` is UNCONDITIONAL; only the EMAIL is self-guarded
`assignee.service.ts:108-124`: inside `if (!existing)`, `record(...)` runs for ALL
new assigns (incl. self), but `email.sendCardAssigned` is gated by
`if (target.id !== user.id)`. The notification MUST follow the EMAIL guard (inside
`if (target.id !== user.id)`), NOT the activity guard — else a self-assign produces a
notification with no matching email (recipient-set drift). The plan already said
"under the SAME `if (target.id !== user.id)` guard" — CONFIRMED correct; added an
explicit warning so the implementor does not accidentally place it next to `record`.

### I3 (MINOR) — bus extension: in-proc branch returns an object literal; new methods must be added in BOTH return objects
`realtime.bus.ts:76-91` (in-proc) and `:133-160` (redis) are SEPARATE returned
objects. `subscribeUser`/`publishUser` must be added to BOTH. The plan implied this
but did not call out the two distinct return sites. CHANGE: explicit task per branch.

### I4 (MINOR) — `close()` shape: in-proc clears `listeners` + `removeAllListeners`; redis clears + quits
The plan said "`close()` must also `userListeners.clear()`" — correct for both
branches. CHANGE: spelled out that BOTH `close()` impls (`:87-90` and `:152-159`)
add `userListeners.clear()`.

### I5 (MINOR) — `pmessage` handler currently ignores `_channel`; user path REQUIRES inspecting it
`realtime.bus.ts:116` `(_pattern, _channel, payload)` ignores the channel. With two
patterns psubscribed, the handler MUST branch on the channel prefix to pick
`boardEventSchema` vs `userEventSchema`. The plan covers this; CHANGE: noted the
exact param to un-underscore (`_channel` -> `channel`).

### I6 (CONFIRMED) — partial index works in pg-mem
`002.rbac.ts:42` (`CREATE UNIQUE INDEX ... WHERE is_superuser`) and `010.card-due-date.ts:11-16`
(`.createIndex(...).where(sql.ref("due_at"),"is not",null)`) both ship and pass under
pg-mem. The plan's `notifications_user_unread_idx ... where read_at is null` is fine.
Recommend the Kysely builder form `.where(sql.ref("read_at"),"is",null)` (mirror 010)
over a raw `sql` fragment for consistency. CHANGE applied to the migration task.

### I7 (CONFIRMED) — `up020` registration is mandatory
`auth/test/helpers.ts:10-28` imports `up001..up019`, `:46-64` calls them; highest
migration is `019.board-view`. WITHOUT `up020` the test DB lacks `notifications`, and
because the recorder swallows errors (`activity.recorder.ts:42-53` pattern), every
comment/assignee/reminder test silently drops the row and unread-count asserts fail
confusingly. CHANGE: kept as a REQUIRED task, reinforced.

### I8 (CONFIRMED) — `SentEmail` union + `fakeEmail` already cover all 3 sites
`auth/test/helpers.ts:68-75` SentEmail has `"due" | "mention" | "assigned"`;
`fakeEmail` (`:96-103`) records them. Existing comment/assignee/reminder tests assert
on `fakeEmail().sent`. Adding notification WRITES alongside does NOT touch the email
path, so those email-count asserts stay green — PROVIDED `up020` is registered (I7).
No SentEmail change needed. CHANGE: added an explicit "do not break existing email
asserts" note + listed the affected existing specs to re-run.

### I9 (CONFIRMED) — JSONB stringify pattern is correct
`db/types.ts:243-254` (`ActivitiesTable.meta`) + `:256-266` (`BoardViewsTable.config`)
use `ColumnType<T, string, string>`; writers `JSON.stringify` (`activity.recorder.ts:39`).
pg-mem accepts a raw object (so a missing stringify passes tests but writes
"[object Object]" in prod). The plan's `ColumnType<NotificationPayload,string,string>`
+ `JSON.stringify(payload)` in the recorder is correct. Kysely auto-parses jsonb on
SELECT (read returns a parsed object). CONFIRMED, no change.

### I10 (CONFIRMED) — per-user SSE: `requireUser` reusable, no board authz
`realtime.http.ts:38-66` `requireUser(db)` is a generic Express middleware (cookie ->
`req.authUser`); the board route adds `loadBoardFor` ON TOP (`:80-85`). The user route
needs ONLY `requireUser` (own channel; authz == authentication). Router already
mounted `app.use("/api", realtimeHttpRouter)` (`index.ts:119`) BEFORE the JSON parser
(`:131`) and OpenAPI catch-all (`:132`) — correct for a long-lived stream. No
`index.ts` change. CONFIRMED.

### I11 (CONFIRMED) — per-user isolation
Every read/mark query filters `user_id = user.id` (service passes `ctx.user.id`, never
an input). `markRead` = `where id=? and user_id=caller` -> a foreign id hits 0 rows;
the service uses `existsForUser(db, user.id, id)` to return NOT_FOUND for unknown OR
foreign id (no cross-user existence leak). CONFIRMED. Added a test for "mark another
user's id leaves their row unchanged".

### I12 (MINOR, FE) — bell placement spots verified
`Sidebar.tsx:68-84` brand block has the Search button (`:76-83`) — bell goes there
(desktop). `AppLayout.tsx:36-54` mobile bar has Search + Log out — bell goes there
(mobile). `AppLayout` is the shell wrapping all signed-in pages (renders `<Outlet/>`),
so `useNotificationsRealtime()` mounts once at its top. `useBoardRealtime.ts:1-129`
is the exact lifecycle to mirror (`config.apiBaseUrl`, `withCredentials`, debounce,
`seenOpen` catch-up, `REFRESH_AFTER_ERRORS` -> `refreshSession`). CONFIRMED.

### I13 (MINOR, FE) — `useBoardRealtime` self-echo skip does NOT apply to the user stream
The board hook skips `ev.actorId === me` (`useBoardRealtime.ts:92`). The user nudge
carries NO actorId and the recipient is BY DEFINITION not the actor (no self-notify),
so the user hook must NOT copy the self-echo skip. CHANGE: called out in the FE plan
so the implementor drops that branch when mirroring.

---

## Net changes to the plans
- backend: I1 (decided actor-email fetch), I2 (assign guard warning), I3/I4/I5
  (bus two-return-object + close + pmessage channel), I6 (Kysely partial-index form),
  I7/I8 (test harness reinforcement), isolation test additions.
- frontend: I12 (placement confirmed), I13 (drop self-echo skip when mirroring).

No feature code written. Both plan files updated in place in `.claude/rules/plans.md`
format (checkbox tasks; backend endpoints listed one line each).
