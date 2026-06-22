# Bug Reporting — Frontend Plan

Two surfaces: (1) a "Report a bug" modal reachable from anywhere (user side +
admin layout), capturing the current route as `pageUrl`; (2) an admin triage page
at `/admin/bugs` (list + filter + status/severity/resolution editing), gated by the
new `admin:bugs:read` permission. New-report in-app nudges already arrive through
the EXISTING `NotificationBell` — only a `describe.ts` case + a click target are
added. All API calls go through `trpc.bugReports.*` directly in components
(frontend.md: no per-call hooks).

> GROUNDING (verified):
> - tRPC client `lib/trpc.ts`; calls via `useQuery/useMutation(
>   trpc.<feature>.<endpoint>.queryOptions())` directly in components (frontend.md).
> - Admin routes `App.tsx:104-121`: `/admin` -> `PermissionRoute anyOf=
>   ADMIN_READ_PERMS` -> `AdminLayout` -> per-section `PermissionRoute perm={...}`.
>   A new section adds a `<Route element={<PermissionRoute
>   perm={Permission.AdminBugsRead} />}><Route path="bugs" .../></Route>` AND
>   `ADMIN_READ_PERMS` must include `AdminBugsRead` (verify the const where it is
>   defined — search `ADMIN_READ_PERMS`).
> - Admin nav `pages/admin/AdminLayout.tsx:34-56` `NAV_ITEMS[]` (to/label/hint/
>   icon/perm) gated by `<Can perm>`. Add a `Bugs` item (`perm:
>   Permission.AdminBugsRead`, icon e.g. `Bug` from lucide-react).
> - `<Can perm>` `features/rbac/components/Can.tsx` + `useCan` gate UI by
>   permission. `Permission` enum from `shared` (extended with `AdminBugs*` in the
>   backend plan).
> - Notification describe `features/notification/describe.ts:18-27` switch over
>   `NotificationType`; bell renders icon+text from payload only. Add a
>   `BUG_REPORT_NEW` case. Bell click navigation keys off payload (`boardId`/
>   `cardId` today) — add a `bugReportId` -> `/admin/bugs` branch and NULL-CHECK
>   `boardId` since it is now optional (backend plan §2).
> - Admin page pattern: `pages/admin/users/UsersListPage.tsx` (table + filters via
>   `@tanstack/react-table`, query through tRPC). Mirror it for the bugs page.
> - Forms: react-hook-form + zod (frontend.md). Modal over route (frontend.md).
>   Toasts via `useToastStore`.

## Key decisions (decided)
- **Report-bug is a MODAL, not a route** (frontend.md preference). Triggered from a
  shared `ReportBugButton` placed in the user shell + admin layout. The modal reads
  the current location (`useLocation().pathname + search`) and sends it as
  `pageUrl`; user-agent is server-stamped (not sent).
- **Triage list uses `@tanstack/react-table`** (mirror UsersListPage): columns
  title / severity (badge) / status (badge) / reporter email / created; row click
  opens a detail/edit drawer or modal. Status + severity + resolution edited inline
  via `trpc.bugReports.update`; `Can perm={AdminBugsManage}` gates the edit
  controls (read-only admins still see the list).
- **Filters** = status + severity dropdowns driving `trpc.bugReports.list` input;
  pagination via `nextOffset` (mirror notification/activity infinite or
  offset paging used elsewhere).
- **Optimistic-free, refetch on mutate.** After submit / update / delete,
  invalidate the relevant `bugReports` query keys (mirror existing mutate ->
  `queryClient.invalidateQueries` usage). Keep it simple; no optimistic cache edits.

## 1. Shared report-bug modal (`features/bug-report/`)
- [ ] `features/bug-report/components/ReportBugModal.tsx` — Radix dialog;
  react-hook-form + `submitBugReportInput` (zod resolver) fields: title,
  description (textarea), severity (select: low/medium/high/critical). On submit:
  `useMutation(trpc.bugReports.submit.mutationOptions())` with
  `{ ...values, pageUrl: location.pathname + location.search }`; on success toast
  "Bug reported, thanks" + close + reset; on error map via `errors.ts`.
- [ ] `features/bug-report/components/ReportBugButton.tsx` — button that opens the
  modal (controlled `open` state). Place in the user shell header AND the admin
  layout footer/header (small `<Bug/>` button). Verify the user shell layout file
  name before wiring (search the existing app header component).
- [ ] `features/bug-report/errors.ts` (+ `.test.ts`) — map `BugReportError`
  codes (`NOT_FOUND`, `NO_FIELDS`) to UI messages (mirror
  `features/board/commentErrors.ts`).
- [ ] `features/bug-report/utils.ts` — severity/status -> label + badge color
  maps; a `formatStatus` helper (mirror `coverColors.ts` / label utils).

## 2. Admin triage page (`pages/admin/bugs/`)
- [ ] `pages/admin/bugs/BugReportsPage.tsx` — `useQuery(trpc.bugReports.list
  .queryOptions({ status, severity, limit, offset }))`; `@tanstack/react-table`
  table (columns above) with severity/status badge cells; status + severity filter
  dropdowns above the table; pagination control using `nextOffset`. Empty + loading
  + error states (mirror UsersListPage).
- [ ] Detail/edit: row click opens `BugReportDetailModal.tsx` showing full
  description, page URL, user-agent, reporter email, timestamps; admin edit
  controls (status select, severity select, resolution textarea) wrapped in
  `<Can perm={Permission.AdminBugsManage}>`; Save -> `trpc.bugReports.update`;
  Delete button (Manage) -> `trpc.bugReports.remove` with confirm. On success
  invalidate the list query + close.
- [ ] `App.tsx` — add the route under `/admin`:
  `<Route element={<PermissionRoute perm={Permission.AdminBugsRead} />}>
   <Route path="bugs" element={<BugReportsPage />} /></Route>`; import the page;
  add `AdminBugsRead` to `ADMIN_READ_PERMS` so `/admin` landing + guard include it.
- [ ] `AdminLayout.tsx` — add a `Bugs` entry to `NAV_ITEMS` (`to: "/admin/bugs"`,
  `label: "Bugs"`, `hint: "Reports & triage"`, `icon: Bug`, `perm:
  Permission.AdminBugsRead`).
- [ ] (Optional) `/admin` landing redirect (`App.tsx:40-44`) — extend the
  first-section-you-can-read fallback to consider `AdminBugsRead`.

## 3. Notification bell integration (`features/notification/`)
- [ ] `describe.ts` — add a `case NotificationType.BUG_REPORT_NEW:` ->
  `{ icon: Bug, text: \`${actor} reported a bug: "${title}"\` }`.
- [ ] Bell click navigation — where the item builds its link from payload, add:
  if `payload.bugReportId` -> navigate to `/admin/bugs` (optionally
  `?focus=<bugReportId>`); GUARD the existing board link with a null-check on
  `payload.boardId` (now optional). Verify the click handler location
  (`NotificationItem.tsx`) before editing.
- [ ] `describe.test.ts` — add a case asserting the `BUG_REPORT_NEW` text + icon.

## 4. Tests (vitest, mirror existing component tests)
- [ ] `ReportBugModal.test.tsx`: renders fields; validation blocks empty
  title/description; successful submit calls the mutation with `pageUrl` from the
  router location and shows the success toast; server error shows the mapped
  message.
- [ ] `BugReportsPage.test.tsx`: renders rows from a mocked `list` query; status +
  severity filter change the query input; pagination advances offset; edit controls
  hidden without `AdminBugsManage` (mock `useCan`), visible with it.
- [ ] `BugReportDetailModal.test.tsx`: shows full report; Save calls `update` with
  the changed fields; Delete (with confirm) calls `remove`; both invalidate the
  list query on success.
- [ ] `describe.test.ts`: `BUG_REPORT_NEW` -> expected icon + text.
- [ ] `errors.test.ts`: each `BugReportError` code maps to its message.
- [ ] Permission gating: `/admin/bugs` route is not reachable without
  `AdminBugsRead` (mirror `rbac.test.tsx` / `UsersListPage.test.tsx`).

## 5. E2E (e2e/frontend/bug-report/, live site — see frontend.md testing rule)
- [ ] `submit.e2e.spec.ts`: pre-seeded user opens the Report-bug modal, fills + submits,
  sees the success toast; (admin account) the report appears in `/admin/bugs`.
- [ ] Keep destructive cleanup out of real data — submit with a recognizable
  throwaway title and have the admin delete it at the end (mirror existing e2e
  cleanup conventions).

## 6. Verify
- [ ] `pnpm --filter frontend test` green.
- [ ] `pnpm --filter frontend build` (type-check passes with the extended
  `Permission` + optional `boardId` payload).
- [ ] Manual: submit a bug as a normal user; confirm an admin's bell shows the
  `BUG_REPORT_NEW` nudge and `/admin/bugs` lists + lets the admin change status.
