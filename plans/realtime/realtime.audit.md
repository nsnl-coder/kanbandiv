# Realtime Sync — Production-Readiness Audit

Audit of `realtime.backend.md` + `realtime.frontend.md` against the actual
codebase. Every referenced file was read and every claim verified. Severity:
P0 (breaks the feature / data-correctness), P1 (real gap, must handle before
build), P2 (note / acceptable for v1).

---

## A. SSE + Express transport / buffering hazards

### A1 — No `compression` middleware exists. HAZARD IS LATENT, NOT PRESENT. [P2]
The plan warns "compression must be disabled/flushed for SSE". Verified:
`packages/backend/src/index.ts` has NO `compression()` and there is no
`compression` import anywhere in `packages/backend/src` (grep clean). So there
is nothing to bypass today. CHANGE: keep it that way — the plan must state "do
NOT add `compression` globally; if ever added, exclude `text/event-stream` or
mount it AFTER the SSE route." Added as an explicit guard in the backend plan.

### A2 — Middleware order: SSE route must mount BEFORE `express.json()` and the csrfGuard. CORRECT, with a precise spot. [P0 if mis-mounted]
Verified `index.ts` mount order (lines 102-128):
`clientLogRouter` -> `backupHttpRouter` -> `ssoHttpRouter` -> `attachmentHttpRouter`
-> `/trpc` (csrfGuard) -> `/api` (`express.json()` + OpenAPI).
- `csrfGuard` is applied ONLY to `/trpc` (line 119). It does NOT touch `/api`.
  So a GET EventSource on `/api/...` is never subject to csrfGuard. Plan claim
  CONFIRMED. (Also note: csrfGuard already treats GET/HEAD/OPTIONS as safe,
  line 93, so even if it DID apply it would pass a GET.)
- `express.json()` is mounted INSIDE the `/api` OpenAPI handler (line 126). The
  SSE router must be mounted at `/api` BEFORE line 124, exactly like
  `attachmentHttpRouter` (line 114). CHANGE: pin the mount immediately after
  `attachmentHttpRouter`. If mounted after `express.json()`, the body parser
  would try to read the request body of the GET (harmless for a no-body GET, but
  the bigger risk is route precedence — the OpenAPI catch-all could shadow it).
- `helmet()` (line 72) sets headers only; it does not buffer. `pino-http`
  (line 63) wraps logging; it does not buffer the response body. `metricsMiddleware`
  (line 61) times the request; verify it does not hold `res.end` — it wraps the
  response lifecycle but does not buffer chunks. NOTE flagged in plan to confirm
  metricsMiddleware tolerates a long-lived (minutes-long) open response without
  leaking a histogram timer; acceptable but documented.

### A3 — nginx buffering. CORRECT mechanism, add defense-in-depth. [P1]
Verified `packages/infra/proxy/default.conf.template` backend server block
(lines 60-76): `location /` -> `proxy_pass http://backend:4000` with
`proxy_headers.conf`. `proxy_headers.conf` sets `proxy_http_version 1.1` (good —
SSE needs HTTP/1.1 keep-alive upstream; client-edge HTTP/2 is fine). There is
NO `proxy_read_timeout` override, so nginx default 60s idle applies; the plan's
~25s heartbeat keeps the stream under that. `proxy_buffering` is at its default
(`on`), BUT the app sets `X-Accel-Buffering: no` on the SSE response, which
disables nginx buffering for that specific response. CHANGE: plan now (a) keeps
`X-Accel-Buffering: no`, AND (b) recommends an OPTIONAL dedicated nginx location
for `~ ^/api/boards/[^/]+/events$` with `proxy_buffering off;` +
`proxy_read_timeout 1h;` + `proxy_cache off;` as defense-in-depth. The header
alone is sufficient for MVP; the location block is the belt-and-suspenders.

---

## B. Auth replication + token expiry on a long connection

### B1 — `requireUser` precedent. CONFIRMED EXACT. [OK]
`attachment.http.ts requireUser` (lines 42-70) does exactly:
parseCookie -> `access_token` -> `verifyAccessToken(token).sub` ->
`findPublicUserById(db, sub)` -> reject `!user || !user.email_verified` ->
`findUserGlobalPerms(db, user.id)` for `isSuperuser` ->
`req.authUser = { id, isSuperuser }`. This matches `protectedProcedure` per the
plan. SSE route copies this verbatim. CONFIRMED.

### B2 — EventSource cannot send `Authorization`; relies on `access_token` cookie. CONFIRMED. [OK]
The whole app uses httpOnly cookies (`access_token` / refresh), no Authorization
header (trpc.ts uses `credentials:"include"`, no bearer). EventSource with
`withCredentials:true` sends the cookie on same-origin / credentialed-CORS GET.
Same-origin in prod (app + api are siblings under credentialed CORS, `index.ts`
lines 79-81). CONFIRMED.

### B3 — Access-token expiry on a long-lived SSE connection. REAL GAP. [P1]
This is the most important auth gap.
- The connection authenticates ONCE at connect (in `requireUser`). It then
  streams for minutes/hours. The access token WILL expire mid-stream. That is
  ACCEPTABLE for the stream itself (it is read-only, board-scoped, leaks only
  "something changed" — see F), and we explicitly do not re-verify per message
  for MVP.
- The REAL problem is the RECONNECT. EventSource auto-reconnects when the
  connection drops. On reconnect, `requireUser` runs again. If the access token
  has expired, the reconnect gets a 401. CRITICAL: EventSource does NOT run the
  tRPC `refreshLink`. The frontend refreshes tokens ONLY via
  `refreshSession()` in `packages/frontend/src/lib/trpc.ts` (lines 37-54), which
  calls `auth.refresh.mutate({})` over tRPC. A raw EventSource 401 will NOT
  trigger that refresh — EventSource will just retry the same expired cookie
  forever (the server keeps 401ing), and the stream is dead until a tRPC call
  elsewhere happens to refresh the cookie.
- CHANGE (specified in frontend plan): on `es.onerror`, the hook must detect a
  likely-auth failure and proactively call the EXPORTED `refreshSession()` from
  `lib/trpc.ts` before allowing reconnect; since EventSource hides the HTTP
  status on error, use a small consecutive-error counter: on the Nth error,
  `await refreshSession()` then `es.close()` + reopen a fresh EventSource (a new
  EventSource will send the now-refreshed cookie). If `refreshSession()` returns
  false (refresh token also dead), stop retrying and let the page's own
  `boards.getData` query surface the 401/redirect (route guards handle it).
  This piggybacks on the SINGLE in-flight refresh dedup already in trpc.ts, so
  it will not race the tRPC refresh.

---

## C. Publish chokepoint — COMPLETE mutation map (the big one)

`activity.recorder.record` is the chosen chokepoint. VERIFIED it is imported and
called from all 8 claimed services (card, column, label, assignee, comment,
checklist, attachment, board). BUT recorder-only coverage is INCOMPLETE: many
board-mutating paths never call `record`. Each un-recorded path = a STALE UI on
other clients. Full audit of every exported mutation below.

P0: every row marked "NO -> publish" needs an explicit `bus.publish` or the
other tabs will not refresh after that action.

### card.service.ts
| Mutation | records? | publish needed |
|---|---|---|
| createCard (L106) | YES CARD_CREATED | via recorder (cardId) |
| updateCard title (L161) | YES | via recorder |
| updateCard description (L170) | YES | via recorder |
| updateCard dueAt (L179) | YES | via recorder |
| updateCard cover (L195) | YES COVER_CHANGED | via recorder |
| updateCard reminderMinutes ONLY | **NO** (no record branch for reminder-only patch) | reminder is not in boards.getData; SKIP (P2, doc) |
| deleteCard (L271) | YES | via recorder |
| archiveCard (L296) | YES | via recorder |
| restoreCard (L331) | YES | via recorder |
| moveCard cross-column (L370) | YES CARD_MOVED | via recorder |
| **moveCard same-column reorder** (else of L369) | **NO** | **explicit bus.publish BOARD_CHANGED** (plan flagged) |

### column.service.ts — ENTIRE FILE is a gap except archive/restore
| Mutation | records? | publish needed |
|---|---|---|
| createColumn (L69) | **NO** | **explicit bus.publish BOARD_CHANGED** |
| updateColumn / rename (L94) | **NO** | **explicit bus.publish BOARD_CHANGED** |
| deleteColumn (L106) | **NO** | **explicit bus.publish BOARD_CHANGED** |
| moveColumn / reorder (L168) | **NO** | **explicit bus.publish BOARD_CHANGED** |
| archiveColumn (L127) | YES | via recorder |
| restoreColumn (L158) | YES | via recorder |

### label.service.ts
| Mutation | records? | publish needed |
|---|---|---|
| createLabel (L105) | **NO** | **explicit bus.publish BOARD_CHANGED** |
| updateLabel name/color (L119) | **NO** | **explicit bus.publish BOARD_CHANGED** |
| deleteLabel (L131) | **NO** | **explicit bus.publish BOARD_CHANGED** |
| attachLabel (L158) | YES LABEL_ATTACHED | via recorder (cardId) |
| detachLabel (L183) | YES LABEL_DETACHED | via recorder (cardId) |

Note: label create/edit/delete change `boards.getData` (cards carry labels;
label name/color renders on every card chip). MUST publish.

### checklist.service.ts
| Mutation | records? | publish needed |
|---|---|---|
| createChecklist (L187) | YES | via recorder |
| updateChecklist / rename (L197) | **NO** | **explicit bus.publish** (CARD_ACTIVITY, carries card_id) |
| deleteChecklist (L217) | YES | via recorder |
| createItem (L239) | YES | via recorder |
| updateItem toggle done (L266) | YES (only when isDone changed) | via recorder |
| updateItem text-only edit (no isDone change) | **NO** | **explicit bus.publish CARD_ACTIVITY** |
| deleteItem (L279) | **NO** | **explicit bus.publish CARD_ACTIVITY** |
| moveItem / reorder (L289) | **NO** | **explicit bus.publish CARD_ACTIVITY** |

### comment.service.ts
| Mutation | records? | publish needed |
|---|---|---|
| createComment (L176) | YES COMMENT_ADDED | via recorder (cardId) -> CARD_ACTIVITY |
| updateComment / edit (L217) | **NO** | **explicit bus.publish CARD_ACTIVITY** |
| deleteComment (L237) | **NO** | **explicit bus.publish CARD_ACTIVITY** |

### assignee.service.ts
| Mutation | records? | publish needed |
|---|---|---|
| assign (L114) | YES (skips on already-assigned no-op) | via recorder |
| unassign (L146) | YES (only when existing) | via recorder |

OK. (No-op paths intentionally don't publish — nothing changed.)

### attachment.service.ts
| Mutation | records? | publish needed |
|---|---|---|
| createAttachment / upload (L127) | YES ATTACHMENT_ADDED | via recorder -> CARD_ACTIVITY |
| deleteAttachment (L181) | YES ATTACHMENT_DELETED | via recorder -> CARD_ACTIVITY |

OK.

### board.service.ts
| Mutation | records? | publish needed |
|---|---|---|
| createBoard (L178) | **NO** | SKIP — a brand-new board has no viewers yet (P2) |
| updateBoard rename/desc/color (L223) | **NO** | **explicit bus.publish BOARD_CHANGED** (name/color render on the board view) |
| deleteBoard (L235) | **NO** | **explicit bus.publish BOARD_CHANGED** (viewers should 404; see note) |
| archiveBoard (L256) | YES | via recorder |
| restoreBoard (L277) | YES | via recorder |
| grantBoardAccess (L373) | YES MEMBER_GRANTED | via recorder |
| revokeBoardAccess (L402) | YES MEMBER_REVOKED | via recorder |

### COMPLETE set of paths needing an EXPLICIT bus.publish (recorder does NOT cover):
1. card.service.moveCard — same-column reorder (BOARD_CHANGED)
2. column.service.createColumn (BOARD_CHANGED)
3. column.service.updateColumn / rename (BOARD_CHANGED)
4. column.service.deleteColumn (BOARD_CHANGED)
5. column.service.moveColumn / reorder (BOARD_CHANGED)
6. label.service.createLabel (BOARD_CHANGED)
7. label.service.updateLabel / name+color (BOARD_CHANGED)
8. label.service.deleteLabel (BOARD_CHANGED)
9. checklist.service.updateChecklist / rename (CARD_ACTIVITY, cardId)
10. checklist.service.updateItem — text-only edit (CARD_ACTIVITY, cardId)
11. checklist.service.deleteItem (CARD_ACTIVITY, cardId)
12. checklist.service.moveItem / reorder (CARD_ACTIVITY, cardId)
13. comment.service.updateComment / edit (CARD_ACTIVITY, cardId)
14. comment.service.deleteComment (CARD_ACTIVITY, cardId)
15. board.service.updateBoard / rename+desc+color (BOARD_CHANGED)
16. board.service.deleteBoard (BOARD_CHANGED)

Everything else is covered by `activity.recorder.record`.

Note for checklist#9-12 / comment#13-14: these services hold `card_id`
(checklist.card_id / comment.card_id) at the call site, so the explicit publish
CAN carry `cardId` -> emit CARD_ACTIVITY so an open card's `activity.listForCard`
also refreshes. deleteColumn carries no single cardId -> BOARD_CHANGED only.

---

## D. Redis pub/sub pattern

### D1 — Dedicated subscriber connection. PLAN CORRECT, matches health.http precedent. [OK]
`health.http.ts` (lines 16-28) is the lazy ioredis singleton precedent:
`new Redis(env.REDIS_URL, { lazyConnect, maxRetriesPerRequest:1,
enableOfflineQueue:false })` + `redis.on("error", ()=>{})` swallow. The plan
correctly requires TWO clients (publisher + DEDICATED subscriber) — a connection
in subscribe mode cannot issue normal commands. CONFIRMED necessary. CHANGE:
plan now pins the same constructor options as health.http for both clients, and
the subscriber must NOT share the health-check client.

### D2 — Channel naming + in-proc fallback + no double-delivery. CORRECT. [OK]
`PSUBSCRIBE board:*`, `publish` -> `pub.publish("board:"+id, json)`, local Map
fans within instance, Redis fans between. When REDIS_URL empty -> in-proc
EventEmitter, `publish` calls local listeners directly (no Redis loopback). When
REDIS_URL set -> `publish` writes to Redis ONLY and the originating instance gets
its own pmessage (do not also call local listeners — avoids double-delivery).
Logic is correct. CONFIRMED.

### D3 — Graceful shutdown. GAP, acceptable for MVP. [P2]
`index.ts` has NO shutdown hook (only `app.listen`, line 140). The plan
acknowledges this and defers it. CHANGE: plan keeps it deferred BUT requires the
bus to expose a `close()` (quit both Redis clients, clear the Map, end open SSE
responses) so a future `SIGTERM` handler can call it. Document the deviation; do
not add a shutdown framework just for this.

---

## E. Self-echo

### E1 — actorId skip + frontend has user id. CONFIRMED. [OK / P2 note]
`authStore.getUser()?.id` exists: `PublicUser` has `id` (shared
auth.schema.ts L91) and BoardDetailPage already reads
`useAuthStore((s)=>s.user)` (L77). Self-echo compares `ev.actorId` to the
current user id. CHANGE: read the id through a REF inside the handler to avoid a
stale closure on the long-lived stream.
NOTE (P2, accepted): skip is by USER id, not per-connection id. So if the SAME
user edits in tab A, tab B (same user) will ALSO skip the invalidation and NOT
refresh. Acceptable for v1 (a user's own second tab is an edge case; the user
can refresh). Documented in both plans. If unacceptable later, switch to a
per-connection client id echoed back.

---

## F. Subscribe authorization + revocation + payload privacy

### F1 — Authorize on connect via loadBoardFor(view). CORRECT. [OK]
`loadBoardFor(db, user, boardId, "view")` (board.service.ts L107) throws
NOT_FOUND for a board the user can't view (no existence leak) — exactly the
attachment precedent. Route maps the thrown TRPCError to 403/404. CONFIRMED.

### F2 — Mid-connection revocation. GAP, acceptable for v1. [P2]
Check is only-on-connect. A user who loses access keeps receiving until the
stream drops/reconnects. Mitigated by F3 (payload carries no content). Plan
notes the optional heartbeat-tick re-check as deferred hardening.

### F3 — Payload privacy. MUST ENFORCE. [P1]
The event payload is `{ boardId, type, actorId, ts, cardId? }` — NO card
contents, titles, or bodies. So a stale subscriber learns only "board X changed"
and re-fetches through the NORMAL authorized `boards.getData` query (which
re-checks permission server-side and will 404 if access was revoked). CHANGE:
plan hard-states the payload schema must NEVER carry mutation content; the
`boardEventSchema` in shared enforces exactly these fields.

---

## G. Frontend EventSource / query invalidation

### G1 — Exact query keys. CONFIRMED. [OK]
- Board: `trpc.boards.getData.queryKey({ id: boardId })` — verified in
  BoardDetailPage L151. Hook MUST build the SAME key.
- Card activity: `trpc.activity.listForCard.queryKey({ cardId })` — CardActivity
  uses `trpc.activity.listForCard.queryOptions({ cardId })` (L11), same input
  shape. CONFIRMED.

### G2 — Base URL. PLAN IS WRONG ABOUT config. [P0 for the URL]
`config.apiUrl` defaults to `"/trpc"` (env.config.ts L4), NOT `/api`. There is
NO `config.apiUrl_base`. The SSE URL `config.apiUrl_base + "/boards/..."` from
the plan would not compile. CHANGE: add a NEW `config.sseUrl` (or `apiBaseUrl`)
value:
- local: `VITE_API_URL` points the tRPC client at the backend origin's `/trpc`;
  derive the SSE base by replacing the trailing `/trpc` with `/api`, OR add a
  dedicated `VITE_SSE_URL`. Simplest robust rule: `config.apiUrl.replace(/\/trpc$/, "")
  + "/api"`. Plan now specifies adding `apiBaseUrl` to env.config.ts computed
  this way, and the hook builds `\`${config.apiBaseUrl}/boards/${boardId}/events\``.

### G3 — Cleanup on unmount / board switch. CORRECT. [OK]
`useEffect` deps `[boardId]`, returns `() => es.close()`. StrictMode double-mount
is handled by the cleanup. CONFIRMED. Connection leak on disconnect is handled
on BOTH ends: backend `req.on("close")` clears heartbeat + unsubscribes
(plan §4.6); frontend effect cleanup closes the EventSource.

### G4 — Reconnect / backoff + thundering herd. [P1]
EventSource auto-reconnects (native, ~3s default backoff). On `onopen` after the
first, eagerly invalidate `boards.getData` once to catch up. CHANGE (thundering
herd): when many clients receive the same event they all invalidate at once.
TanStack already dedups concurrent refetches per client, but across many clients
the server still gets N refetches. Add a small DEBOUNCE in the hook: coalesce
multiple events arriving within ~150-250ms into a single
`invalidateQueries` per key (a board-wide drag emits several events fast). This
caps refetch storms per client and smooths the herd. Documented in frontend
plan §2. Combined with the failure-cap on errors (don't retry a dead auth
forever — tie into refreshSession per B3).

---

## Summary of severities
- P0: A2 (mount position), C (16 missing publish points), G2 (wrong config base URL).
- P1: A3 (nginx defense-in-depth), B3 (token-expiry reconnect refresh), F3
  (payload privacy), G4 (debounce / herd + auth-aware reconnect).
- P2: A1 (no compression today — keep it out), D3 (shutdown deferred), E1
  (user-id self-echo skips own 2nd tab), F2 (revocation only-on-connect),
  createBoard/createColumn-on-empty-board edge cases.

No feature code was written. Both plan files were rewritten in place with these
fixes.
