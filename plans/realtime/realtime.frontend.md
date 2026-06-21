# Realtime Sync — Frontend Plan

Open an SSE stream for the currently-viewed board and invalidate the right
TanStack Query caches when a change event arrives, so the board re-renders
without a manual refresh. Ignore the user's own changes (self-echo) to avoid a
redundant refetch right after an optimistic local mutation.

> AUDIT STATUS: every referenced file was read and verified. See
> `realtime.audit.md`. Rewritten to fix: the WRONG base-URL config (config.apiUrl
> is `/trpc`, not `/api`, and `apiUrl_base` does not exist), the access-token
> expiry-on-reconnect refresh gap, and thundering-herd debounce.

Grounding (VERIFIED):
- tRPC client `packages/frontend/src/lib/trpc.ts`: `httpBatchLink` over
  `config.apiUrl` with `credentials:"include"` and the
  `x-requested-with: XMLHttpRequest` CSRF marker. `useTRPC` from
  `createTRPCContext`. Token refresh is done ONLY by the exported
  `refreshSession()` (L37-54) via `auth.refresh.mutate({})`, with a single
  in-flight dedup. **EventSource does NOT go through the tRPC refreshLink.**
- `packages/frontend/src/lib/query-client.ts`: a bare `new QueryClient()`.
- `BoardDetailPage.tsx` holds `const queryClient = useQueryClient()`,
  `const trpc = useTRPC()`, reads `boardId` from `useParams`, queries
  `trpc.boards.getData.queryOptions({ id: boardId! })`, and builds
  `const dataKey = trpc.boards.getData.queryKey({ id: boardId! })` (L151). Reads
  `currentUser = useAuthStore((s) => s.user)` (L77).
- Card activity: `CardActivity.tsx` uses
  `trpc.activity.listForCard.queryOptions({ cardId })` (L11) -> key is
  `trpc.activity.listForCard.queryKey({ cardId })`.
- `authStore.getUser()?.id` exists: `PublicUser` has `id` (shared
  auth.schema.ts L91).
- `config.apiUrl` defaults to `"/trpc"` (env.config.ts L4). There is NO
  `apiUrl_base`.

The SSE endpoint, cookie auth, and event shape come from the backend plan:
`GET /api/boards/{boardId}/events`, payload
`{ boardId, type: "BOARD_CHANGED" | "CARD_ACTIVITY", actorId, ts, cardId? }`.

## 1. Self-identity for echo suppression

- [x] read the current user id from `authStore` (`hooks/useAuthStore`). The
  handler compares `event.actorId` against the logged-in user id and SKIPS
  invalidation when they match (the originator already has fresh state from its
  own optimistic update). Keep the id in a REF inside the hook so the long-lived
  stream handler never sees a stale closure.
- [x] NOTE (accepted v1 tradeoff): the skip is by USER id, not per-connection.
  So the same user's SECOND tab will also skip and NOT auto-refresh after that
  user's own edit in the first tab. Acceptable for v1. If later unacceptable,
  switch to a per-connection client id echoed in the payload.

## 2. The hook (`features/board/hooks/useBoardRealtime.ts`)

- [x] signature: `useBoardRealtime(boardId: string | undefined): void`. No-ops
  when `boardId` is falsy.
- [x] inside: `const trpc = useTRPC()`, `const queryClient = useQueryClient()`,
  current user id (section 1). Keep user id + query keys in refs so the stream
  handler sees current values without re-opening the connection per render.
- [x] **base URL (FIX):** there is no `config.apiUrl_base`. Add an `apiBaseUrl`
  to `config/env.config.ts` (section 4) computed as
  `config.apiUrl.replace(/\/trpc$/, "") + "/api"`. Build the stream URL as
  `` `${config.apiBaseUrl}/boards/${boardId}/events` ``.
- [x] transport: native `EventSource`:
  `new EventSource(url, { withCredentials: true })`. `withCredentials` sends the
  httpOnly `access_token` cookie (same-origin in prod / credentialed CORS).
  EventSource cannot set custom headers, so no `x-requested-with` — fine, the SSE
  route is a GET and the backend applies no CSRF to it.
- [x] `es.onmessage = (e) => { const ev = JSON.parse(e.data) as BoardEvent; ... }`
  - if `ev.actorId === currentUserIdRef.current` -> return (self-echo skip).
  - else schedule a DEBOUNCED invalidation (see below).
  - `:`-comment heartbeats never fire `onmessage`.
- [x] **debounced invalidation (thundering-herd P1):** a single board drag can
  emit several events in a burst. Coalesce events arriving within ~150-250ms into
  ONE invalidation per key. Maintain a pending set:
  - always queue `trpc.boards.getData.queryKey({ id: boardId })`.
  - if `ev.type === "CARD_ACTIVITY"` and `ev.cardId`, also queue
    `trpc.activity.listForCard.queryKey({ cardId: ev.cardId })`.
  - on the debounce timer fire, run `queryClient.invalidateQueries` once per
    queued key, then clear the set. (Invalidate is safe even with no card open —
    TanStack only refetches active observers.)
- [x] **reconnect + token-expiry refresh (P1):** EventSource auto-reconnects on a
  dropped connection. On reconnect (`es.onopen`, but SKIP the very first open),
  eagerly run the catch-up invalidation once so changes missed while
  disconnected are picked up.
  - `es.onerror`: EventSource hides the HTTP status. The reconnect may be failing
    because the `access_token` cookie EXPIRED -> the backend 401s `requireUser`
    -> EventSource would retry the SAME expired cookie forever (it does NOT use
    the tRPC refreshLink). Handle with a consecutive-error counter:
    - increment on each `onerror`; reset on a successful `onopen`.
    - on the Nth consecutive error (e.g. N=2), `import { refreshSession } from
      "lib/trpc"` and `await refreshSession()`. This reuses the SINGLE in-flight
      refresh dedup, so it won't race a concurrent tRPC refresh.
      - if it returns true: `es.close()` and OPEN A NEW EventSource (a fresh
        connection sends the now-refreshed cookie).
      - if it returns false (refresh token also dead): `es.close()` and STOP
        (refreshSession already cleared authStore; route guards redirect to
        /login). Do not retry.
  - Do NOT manually `es.close()` on a single transient error (that would kill
    native auto-reconnect). Only close on the refresh path or the failure cap.

## 3. Wire into `BoardDetailPage.tsx`

- [x] call `useBoardRealtime(boardId)` near the top of `BoardDetailPage`
  (alongside the existing `useQuery`/`useQueryClient`/`useParams` lines). One
  line; the hook owns the whole stream lifecycle. Invalidation drives the
  existing `boards.getData` and `activity.listForCard` queries already rendered
  by the page and `CardActivity`.
- [x] verify the optimistic move logic (`midpoint`, `DndContext` handlers, L52+)
  is not disrupted: a remote move invalidates `boards.getData` -> refetch -> the
  board re-renders from server order. The actor that performed the move is
  skipped (self-echo), so its optimistic state is not clobbered by its own echo.

## 4. Config

- [x] add `apiBaseUrl` to `config/env.config.ts`:
  `apiBaseUrl: ((env.VITE_API_URL as string | undefined) ?? "/trpc").replace(/\/trpc$/, "") + "/api"`.
  - local: `VITE_API_URL` points at the backend origin's `/trpc`; the derived
    base becomes `<backend-origin>/api`. Same-origin in prod -> `/api`.
  - alternatively expose a dedicated `VITE_SSE_URL`; the derive-from-`apiUrl`
    rule above needs no new env var, so prefer it.

## 5. Testing cases (vitest, `features/board/hooks/useBoardRealtime.test.ts` + page test)

Mock `EventSource` (jsdom has none): a fake recording the URL + `withCredentials`,
letting the test push `message`/`open`/`error` and recording `close()`. Wrap in
`QueryClientProvider` + `TRPCProvider`; spy on `queryClient.invalidateQueries`
and on `refreshSession`.

- [x] **opens the stream:** rendering with a `boardId` constructs an
  `EventSource` at `<apiBaseUrl>/boards/{boardId}/events` with
  `withCredentials: true`.
- [x] **invalidates on event (debounced):** pushing a `BOARD_CHANGED` from
  another actor calls `invalidateQueries` once with the `boards.getData` key.
- [x] **debounce coalesces:** two events within the window produce ONE
  invalidation per key.
- [x] **card activity refetch:** a `CARD_ACTIVITY` with `cardId` invalidates BOTH
  `boards.getData` AND `activity.listForCard({ cardId })`.
- [x] **self-echo ignored:** an event whose `actorId` equals the current user id
  triggers NO `invalidateQueries`.
- [x] **reconnect catch-up:** simulate `error` then re-`open`; assert the single
  error did NOT manually close the stream and the re-open triggers one catch-up
  `boards.getData` invalidation (and the first open does not).
- [x] **token-expiry refresh:** N consecutive errors call `refreshSession`; on
  true -> old EventSource closed + a new one opened; on false -> closed + no
  reopen.
- [x] **cleanup on unmount / board switch:** unmounting calls `es.close()`;
  changing `boardId` closes the old stream and opens one at the new path.
- [x] **no-op without boardId:** rendering with `undefined` constructs no EventSource.
- [x] **page integration (`BoardDetailPage.test.tsx`):** mounting opens exactly
  one stream for the routed board; a pushed remote event causes a second
  `boards.getData` fetch.

## 6. Verify
- [x] `pnpm --filter frontend test` green (EventSource faked).
- [x] manual (dev/prod VPS only, per the testing rule — e2e/realtime not run
  locally): open the same board in two browser sessions; a card move/edit/comment
  in one appears in the other within ~1s without refresh; the actor's own view
  does not flicker (self-echo skipped); killing the network and restoring it
  reconnects and catches up; an expired access token reconnect triggers a refresh
  and resumes the stream.
