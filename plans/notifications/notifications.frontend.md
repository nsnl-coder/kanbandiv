# Notifications Center (in-app inbox) â€” Frontend Plan

A bell icon in the app shell with an unread-count badge and a dropdown list. The
badge updates live by opening a per-user SSE stream (`GET
/api/me/notifications/events`) and refetching the unread count + list when a
nudge arrives; if SSE is unavailable the bell still works via refetch-on-focus
and refetch-after-mark. Clicking a notification navigates to its board/card and
marks it read. "Mark all read" clears the badge. Read-only content otherwise (no
create from the client). Use `useTRPC()` directly (no custom API hooks â€”
`frontend.md` rule).

> GROUNDING (VERIFIED):
> - Shell: `components/Sidebar.tsx` (the persistent left rail with brand + the
>   "Search" button, `Sidebar.tsx:66-84`) is shown `md:flex` only; the mobile top
>   bar lives in `components/AppLayout.tsx:31-55` (brand + Search + Log out). The
>   bell must appear in BOTH so it is reachable on desktop and mobile.
> - SSE hook precedent: `features/board/hooks/useBoardRealtime.ts` â€” native
>   `EventSource(url, { withCredentials: true })` at `${config.apiBaseUrl}/...`,
>   user-id echo ref from `authStore.getUser()?.id`, debounced
>   `queryClient.invalidateQueries`, reconnect catch-up on `es.onopen` (skip first
>   open), consecutive-error counter -> `refreshSession()` from `lib/trpc` ->
>   close + reopen on success / stop on false. COPY this structure for the
>   per-user stream.
> - `config.apiBaseUrl` ALREADY EXISTS (`config/env.config.ts:8-12`) =
>   `apiUrl.replace(/\/trpc$/,"") + "/api"`. Stream URL =
>   `${config.apiBaseUrl}/me/notifications/events`. No new env var.
> - tRPC: `useTRPC()` from `lib/trpc`; query/mutation via
>   `useQuery(trpc.x.queryOptions(...))` / `useMutation(trpc.x.mutationOptions(...))`
>   directly in components (no api-call hooks). `useAuthStore((s) => s.user)` /
>   `authStore.getUser()` for identity.
> - Radix is available (`@radix-ui/react-dropdown-menu` / `react-popover` per
>   `frontend.md`); lucide `Bell` icon. There is NO existing dropdown component â€”
>   build a small one with Radix Popover/DropdownMenu (mirror how modals are built
>   elsewhere).
> - Shared types come from the backend plan: `Notification`, `NotificationPage`,
>   `NotificationType`, `notificationSchema.payload` =
>   `{ boardId, cardId?, actorHandle: string|null, title, snippet? }`. Prefer
>   typing components from `RouterOutputs` (matching other features) over importing
>   the schema-inferred types.

The endpoints (from the backend plan):
- `GET /me/notifications` `{limit, offset}` -> `{ items, nextOffset }`
- `GET /me/notifications/unread-count` -> `{ count }`
- `POST /me/notifications/{id}/read` -> `{ ok: true }`
- `POST /me/notifications/read-all` -> `{ updated }`
- `GET /api/me/notifications/events` (SSE nudge)

## Decisions
- **Bell lives in the shell, not per-board** â€” it is global (mention/assign/due
  come from any board), so it mounts in `Sidebar` (desktop) + `AppLayout` mobile
  bar, NOT in `BoardDetailPage`.
- **Live = nudge + refetch, never push content.** The SSE event carries no data;
  on receipt the hook invalidates the unread-count + list queries (debounced), so
  the bell re-reads through the authorized, user-scoped tRPC queries.
- **Graceful fallback** (no SSE / blocked): the unread-count query uses
  `refetchOnWindowFocus: true` + a modest `refetchInterval` (e.g. 60s) so the
  badge still updates without the stream; opening the dropdown refetches the list;
  every mark action invalidates both queries. The bell is fully functional with
  SSE off â€” the stream is an enhancement.
- **Click = navigate + mark read.** Clicking a row routes to
  `/boards/${payload.boardId}?card=${payload.cardId}` (the same link shape the
  emails use, `comment.service.cardLink`) and fires `markRead({ id })`; on success
  invalidate count + list.
- **Read-only content** â€” no edit/delete of notifications; only mark-read /
  mark-all-read.

## 1. Live hook (`features/notification/hooks/useNotificationsRealtime.ts`)
- [x] Signature: `useNotificationsRealtime(): void`. Opens ONE per-user SSE stream
  for the logged-in user; no-ops when there is no user (logged out).
- [x] COPY the lifecycle from `useBoardRealtime` but for the user channel:
  - URL: `${config.apiBaseUrl}/me/notifications/events`.
  - `new EventSource(url, { withCredentials: true })` (cookie auth; GET, no CSRF).
  - `es.onmessage`: parse the `UserEvent` nudge; ignore content (there is none);
    DEBOUNCE-invalidate `trpc.notifications.unreadCount.queryKey()` AND
    `trpc.notifications.list.queryKey({...})` (invalidate the list root so any
    open dropdown refetches). Coalesce bursts (~200ms) into one invalidation per
    key, mirroring `useBoardRealtime`.
  - DROP the self-echo skip when mirroring: `useBoardRealtime.ts:92` skips
    `ev.actorId === me`, but the user nudge carries NO `actorId` and the recipient
    is by definition never the actor (no self-notify, backend Â§4) â€” do NOT copy that
    branch or every nudge would be a no-op.
  - reconnect catch-up on `es.onopen` (skip the very first open) -> invalidate the
    count once (pick up anything missed while disconnected).
  - `es.onerror`: consecutive-error counter -> on the Nth (e.g. 2) call
    `refreshSession()` from `lib/trpc`; true -> close + reopen (fresh cookie);
    false -> close + stop (route guards redirect to /login). Do NOT close on a
    single transient error.
  - cleanup on unmount: `es.close()`.
- [x] Mount it ONCE near the app root so the stream lives across navigation. Best
  place: inside `AppLayout` (it wraps all signed-in pages). Call
  `useNotificationsRealtime()` at the top of `AppLayout` (one line) so a single
  stream is shared by the desktop + mobile bell.

## 2. Bell + dropdown (`features/notification/components/NotificationBell.tsx`)
- [x] `NotificationBell` â€” a lucide `Bell` button with an unread badge.
  - `const trpc = useTRPC();`
  - `const unreadQuery = useQuery(trpc.notifications.unreadCount.queryOptions(undefined, { refetchOnWindowFocus: true, refetchInterval: 60_000 }));`
    (the fallback path â€” works with SSE off).
  - Badge: render a small count pill when `unreadQuery.data?.count > 0` (cap
    display at `99+`); `aria-label` like `"Notifications, N unread"`.
- [x] Dropdown via Radix `Popover` (or `DropdownMenu`) anchored on the bell:
  - On open, render the list query:
    `const listQuery = useQuery(trpc.notifications.list.queryOptions({ limit: 20, offset: 0 }));`
    (enable on open, or always-enabled with the popover controlling visibility â€”
    prefer `enabled: open` to avoid a fetch until first open).
  - Header row: title "Notifications" + a "Mark all read" button (disabled when
    `unreadCount === 0`).
  - Body: loading state, empty state ("You're all caught up."), else
    `listQuery.data.items.map((n) => <NotificationItem notification={n} onNavigate={close} />)`.
  - (MVP: a single page of 20 newest; "Load more" with `nextOffset` is OPTIONAL â€”
    add only if needed, mirroring the activity feed offset approach. Keep it to one
    page for the bell to stay light.)
- [x] "Mark all read":
  `const markAll = useMutation(trpc.notifications.markAllRead.mutationOptions({ onSuccess: () => { invalidate unreadCount + list } }));`
  call `markAll.mutate()`.

## 3. Notification row (`features/notification/components/NotificationItem.tsx`)
- [x] Props `{ notification: Notification; onNavigate: () => void }`.
- [x] Render from `payload` ONLY (self-contained â€” no extra query):
  - icon by `notification.type` (lucide): `MENTION` -> `AtSign`,
    `CARD_ASSIGNED` -> `UserPlus`, `CARD_DUE_SOON` -> `Clock`. A tiny
    `describeNotification(n)` helper (mirror activity's `describeActivity`) returns
    `{ icon, text }`:
    - `MENTION` -> `${actorHandle} mentioned you on "${title}"` (+ snippet line)
    - `CARD_ASSIGNED` -> `${actorHandle} assigned you to "${title}"`
    - `CARD_DUE_SOON` -> `"${title}" is due soon` (no actor)
    - `default` -> a generic line so an unknown future type never crashes.
  - relative time from `notification.createdAt` (reuse `relativeTime` from
    `features/board/utils`, as the activity/comment components do).
  - unread styling: a dot / bolder text when `readAt === null`.
- [x] Click handler: `useNavigate()` to
  `/boards/${payload.boardId}?card=${payload.cardId}` (omit `?card=` when no
  `cardId`); fire
  `markRead.mutate({ id: notification.id })`
  (`useMutation(trpc.notifications.markRead.mutationOptions({ onSuccess: invalidate count + list }))`);
  call `onNavigate()` to close the dropdown.
  - Marking does NOT block navigation (fire-and-forget; the onSuccess refetch
    updates the badge).

## 4. Wire the bell into the shell
- [x] `components/Sidebar.tsx` â€” add `<NotificationBell />` in the brand block next
  to the "Search" button (`Sidebar.tsx:76-83`), so it sits in the desktop rail.
- [x] `components/AppLayout.tsx` â€” add `<NotificationBell />` in the mobile top bar
  alongside the Search + Log out buttons (`AppLayout.tsx:36-54`), so mobile users
  get the bell too. Call `useNotificationsRealtime()` once at the top of
  `AppLayout` (Â§1).
- [x] Both placements render the SAME component; the single shared stream + the
  TanStack cache keep both bells' badges in sync.

## 5. Tests (vitest, mirror `useBoardRealtime.test.ts` + `CommentList.test.tsx`)
Mock `EventSource` (jsdom has none): a fake recording URL + `withCredentials`,
exposing push of `message`/`open`/`error` + recording `close()`. Wrap in
`QueryClientProvider` + `TRPCProvider`; mock the tRPC notification queries/mutations
(mirror how `CommentList.test.tsx` mocks tRPC); spy `queryClient.invalidateQueries`
+ `refreshSession`.

### live hook
- [x] **opens the stream:** rendering (with a logged-in user) constructs an
  `EventSource` at `${apiBaseUrl}/me/notifications/events` with
  `withCredentials: true`; no user -> no EventSource.
- [x] **nudge invalidates (debounced):** pushing a `notification` event invalidates
  `notifications.unreadCount` AND `notifications.list` once each; two events in the
  window coalesce to one invalidation per key.
- [x] **reconnect catch-up:** error then re-open -> the single error does NOT
  manually close; re-open triggers one count invalidation (first open does not).
- [x] **token-expiry refresh:** N consecutive errors call `refreshSession`; true ->
  old stream closed + new opened; false -> closed + no reopen.
- [x] **cleanup on unmount:** unmount calls `es.close()`.

### bell + items
- [x] **badge:** `unreadCount` of 3 renders a badge "3"; 0 renders no badge;
  `>99` renders "99+".
- [x] **dropdown list:** opening shows the returned items via `NotificationItem`;
  empty -> "You're all caught up."; loading state shown.
- [x] **describeNotification:** each `NotificationType` produces a non-empty line +
  an icon; unknown type hits `default` without throwing (iterate
  `Object.values(NotificationType)` so a new type without a case fails the test).
- [x] **click row:** navigates to `/boards/{boardId}?card={cardId}`, calls
  `markRead({ id })`, and closes the dropdown; a payload with no `cardId` navigates
  to `/boards/{boardId}` (no `?card=`).
- [x] **mark all read:** clicking "Mark all read" calls `markAllRead` and (on
  success) invalidates count + list; button disabled when count is 0.
- [x] **fallback path:** with NO stream (EventSource never emits), focus refetch /
  the mark-action invalidations still update the badge (assert the count query is
  configured with `refetchOnWindowFocus` and that a mark mutation invalidates it).

### shell integration
- [x] `NotificationBell` is rendered in `Sidebar` (desktop) and in `AppLayout`
  mobile bar; mounting `AppLayout` opens exactly one user stream.

## 6. Verify
- [x] `pnpm --filter frontend test` green (EventSource + tRPC faked).
- [x] `pnpm --filter frontend build` (types from `shared` resolve;
  `describeNotification` switch is exhaustive over `NotificationType`).
- [x] Manual (dev/prod VPS only, per the testing rule â€” not local): mention /
  assign / due to a second user shows their bell badge increment within ~1s; the
  dropdown lists the items linking to the right card; click marks read + navigates;
  "Mark all read" clears the badge; with the stream blocked, the badge still
  updates on window focus.

