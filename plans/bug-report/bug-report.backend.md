# Bug Reporting — Backend Plan

Any authenticated user can file a bug report (title, description, severity, plus
auto-captured page URL + user-agent). Reports are stored in a new `bug_reports`
table and triaged by admins through a status workflow
(`open -> in_progress -> resolved -> closed`). On each NEW report, every bug-admin
is nudged in-app by reusing the EXISTING notification recorder + bell (a new
`BUG_REPORT_NEW` notification type) — no email. Submission is gated by
`protectedProcedure` + a per-IP rate limit; triage (list/get/update) is gated by a
new global permission `admin:bugs:*`. A reporter can read ONLY their own reports;
admins read all.

Mirror `features/invite` + `features/notification` + `features/backup` patterns:
`*.router.ts` / `*.service.ts` / `*.repo.ts` + `test/<endpoint>.spec.ts`, Kysely,
tRPC `protectedProcedure` / `globalProcedure(Permission.AdminBugsRead|Manage)`,
Zod from `shared`, OpenAPI `.meta`, superjson, `LogEvent` (no string literals).

> GROUNDING (every file read + verified):
> - Migrations: highest existing is `023.invite` -> next free is `024.bug-report`
>   (`packages/backend/src/migrations/`). The test DB helper
>   `features/auth/test/helpers.ts` hardcodes the `up00x..up0NN` chain and MUST
>   register `up024` or every bug-report test runs against a table-less DB.
> - Permission catalog `shared/src/rbac.schema.ts:3-27`: `Permission` const +
>   `PERMISSION_CATALOG[]` (key+label+scope) + `PERMISSION_KEYS` derived from the
>   catalog. A NEW permission MUST be added to BOTH the `Permission` object AND
>   `PERMISSION_CATALOG` (the Zod enum + the UI checklist read the catalog).
> - `globalProcedure(permission)` `trpc/trpc.ts:101-107`: superuser bypass, else
>   `hasPermission` or FORBIDDEN. This is the triage gate.
> - `protectedProcedure` `trpc/trpc.ts:85-95` yields `ctx.user` `{ id, email,
>   emailVerified, isSuperuser, permissions }`. The reporter is ALWAYS
>   `ctx.user.id` — never an input. `ctx.ip` exists (rate limiter uses it).
> - `rateLimitedProcedure(limit, windowMs)` `trpc/trpc.ts:53-54` — reuse for the
>   submit endpoint to stop spam (mirror auth).
> - Notification recorder `features/notification/notification.recorder.ts:49-77`:
>   `create(db, bus, { userId, type, payload })` — best-effort, NEVER throws,
>   `JSON.stringify`s the jsonb payload, publishes a `bus.publishUser` nudge.
>   `payload` validated by `notificationPayloadSchema` (`shared`): `{ boardId,
>   cardId?, actorHandle, title, snippet? }`. A bug-report notification has no
>   board — see §Key-decisions for the payload mapping. `bus` import:
>   `import { bus } from "../realtime/realtime.bus.js"`.
> - `NotificationType` `shared/src/notification.schema.ts:5-9` is the single source
>   of truth (3 values today). Adding `BUG_REPORT_NEW` here + a `describe.ts` case
>   on the FE is all the bell needs (it renders from payload only).
> - Recipient enumeration: NO existing "list admins" repo. `rbac.repo.listUsers`
>   (`:128-151`) lists users (paginated, not filtered by permission). A NEW
>   `listBugAdmins(db)` query is required (superuser OR role holding
>   `admin:bugs:*`) — see §3.
> - JSONB precedent (`notifications.payload`, `activities.meta`,
>   `board_views.config`): `ColumnType<T, string, string>` in `db/types.ts`, writer
>   `JSON.stringify`s; pg-mem accepts a raw object so a missing stringify passes
>   tests but corrupts prod — ALWAYS stringify. (Bug reports use plain text columns,
>   not jsonb, so this only matters for the notification payload.)
> - Router registry `trpc/router.ts:22-43`: add `bugReports: bugReportsRouter`.
> - `LogEvent` lives in `config/const.config.ts` (no string literals — backend.md).

## Key decisions (decided)

- **Reporter is always `ctx.user.id`.** Submission needs only `protectedProcedure`
  (any verified user). No `userId` input anywhere. Read isolation: a reporter sees
  only `reporter_id = ctx.user.id`; admins (`AdminBugsRead`) see all.
- **Two-tier authz.** Submit + "my reports" list/get = `protectedProcedure`.
  Triage (list-all, get-any, update status/severity/resolution) =
  `globalProcedure(Permission.AdminBugsRead)` for reads,
  `globalProcedure(Permission.AdminBugsManage)` for writes. Superusers bypass.
- **Status is a fixed lifecycle enum**: `open | in_progress | resolved | closed`.
  New reports start `open`. Transitions are unrestricted among admins (no state
  machine enforcement for MVP) but the value is validated against the enum.
  Severity: `low | medium | high | critical`, set by the reporter, editable by
  admins.
- **Captured context is client-supplied + server-stamped.** Reporter's client
  sends `pageUrl` (the route they were on) and the server stamps `user_agent` from
  the request header and `reporter_id`/`created_at`. `pageUrl` is validated as a
  bounded string (NOT a strict URL — it may be an in-app relative path).
- **Admin notify reuses the notification recorder, in-app only, best-effort.** On
  a successful insert, enumerate bug-admins (`listBugAdmins`) and call
  `notification.create(db, bus, { userId: admin.id, type: BUG_REPORT_NEW, payload })`
  for each — EXCLUDING the reporter if they happen to be an admin (no self-nudge).
  Wrapped so a notify failure never fails the submission (the recorder already
  swallows its own errors; the admin-list query gets its own try/catch). NO email.
- **Notification payload mapping (no board).** The shared `notificationPayloadSchema`
  requires `boardId` + `title` and allows `actorHandle` (nullable) + optional
  `cardId`/`snippet`. A bug report has no board/card. DECISION: extend the shared
  payload so `boardId` is OPTIONAL and add an optional `bugReportId` field (see
  §2). `BUG_REPORT_NEW` payload = `{ bugReportId, title: <report title>,
  actorHandle: <reporter handle>, snippet: <description preview> }`. The FE
  `describe.ts` case + the bell click target key off `bugReportId` -> `/admin/bugs`.
  (Verified the 3 existing types always set `boardId`; making it optional is
  additive and the existing FE link code must null-check it — noted in the FE plan.)
- **Soft constraints, hard-deleted.** No soft delete for MVP. An admin
  `delete` (Manage) hard-deletes a report. `reporter_id` FKs `users.id ON DELETE
  SET NULL` (keep the report if the reporter's account is removed; show "deleted
  user").

## API endpoints
- [ ] `POST /bug-reports` — submit a bug report (any verified user; rate-limited); body title/description/severity/pageUrl
- [ ] `GET /bug-reports/mine` — list the caller's OWN reports, newest-first, paginated
- [ ] `GET /bug-reports` — admin: list ALL reports, filter by status/severity, paginated (AdminBugsRead)
- [ ] `GET /bug-reports/{id}` — get one report; owner OR admin (AdminBugsRead) only
- [ ] `PATCH /bug-reports/{id}` — admin: update status / severity / resolution note (AdminBugsManage)
- [ ] `DELETE /bug-reports/{id}` — admin: hard-delete a report (AdminBugsManage)

## 1. Database (migration + db types)
- [ ] `migrations/024.bug-report.ts` (next free number; mirror `023.invite.ts`
  style — `sql` import, `gen_random_uuid()` default, `timestamptz` + `now()`).
  Create `bug_reports`:
  - `id uuid pk default gen_random_uuid()`
  - `reporter_id uuid references users.id on delete set null` (nullable; keep the
    report if the account is deleted)
  - `title text notnull`
  - `description text notnull`
  - `severity text notnull` (enum value; default `'medium'` at app layer)
  - `status text notnull default 'open'`
  - `page_url text` (nullable; client route at report time)
  - `user_agent text` (nullable; server-stamped)
  - `resolution text` (nullable; admin note set on resolve/close)
  - `created_at timestamptz notnull default now()`
  - `updated_at timestamptz notnull default now()`
  - Indexes:
    - `bug_reports_reporter_created_idx` on `(reporter_id, created_at desc)` — the
      "my reports" list.
    - `bug_reports_status_created_idx` on `(status, created_at desc)` — the admin
      list filtered by status.
  - `down` drops the table `.ifExists()`.
- [ ] `db/types.ts` — add `BugReportsTable` (all plain columns, NO jsonb):
  ```ts
  export interface BugReportsTable {
    id: Generated<string>;
    reporter_id: string | null;
    title: string;
    description: string;
    severity: string;
    status: string;
    page_url: string | null;
    user_agent: string | null;
    resolution: string | null;
    created_at: GeneratedTimestamp;
    updated_at: GeneratedTimestamp;
  }
  ```
  Register `bug_reports: BugReportsTable` in the `Database` interface. Reuse the
  existing `Generated` / `GeneratedTimestamp` aliases.
- [ ] `migrations/024.bug-report.spec.ts` (LIVES IN `src/migrations/`, mirror
  `023.invite` / `016.activity` migration specs): pg-mem + register
  `gen_random_uuid`, run `up001` (auth, for the `users` FK) then `up024`. Assert:
  up creates the table + both indexes; insert a row works; deleting the reporter
  user sets `reporter_id` NULL (NOT cascade-deletes the report); `down` drops.

## 2. Shared schemas + enums + errors (`packages/shared`)
- [ ] `src/bug-report.schema.ts`:
  - `BugSeverity` const `as const`: `LOW: "low", MEDIUM: "medium", HIGH: "high",
    CRITICAL: "critical"`; `type BugSeverityValue`.
  - `BugStatus` const `as const`: `OPEN: "open", IN_PROGRESS: "in_progress",
    RESOLVED: "resolved", CLOSED: "closed"`; `type BugStatusValue`.
  - `severityEnum = z.enum([...Object.values(BugSeverity)] as [...])`,
    `statusEnum` likewise.
  - `submitBugReportInput` = `{ title: z.string().min(3).max(140),
    description: z.string().min(5).max(5000),
    severity: severityEnum.default("medium"),
    pageUrl: z.string().max(2048).optional() }`. (NO status/reporter — server-set.)
  - `listMyBugReportsInput` = `{ limit: 1..50 default 20, offset: >=0 default 0 }`.
  - `listBugReportsInput` (admin) = `{ status: statusEnum.optional(),
    severity: severityEnum.optional(), limit, offset }`.
  - `getBugReportInput` / `deleteBugReportInput` = `{ id: z.string() }`.
  - `updateBugReportInput` = `{ id: z.string(), status: statusEnum.optional(),
    severity: severityEnum.optional(), resolution: z.string().max(5000).nullable().optional() }`
    (at least one field; refine that not ALL three are undefined).
  - output `bugReportSchema` = `{ id, reporterId: z.string().nullable(),
    reporterEmail: z.string().nullable(), title, description, severity: statusEnum?
    -> severityEnum, status: statusEnum, pageUrl: z.string().nullable(),
    userAgent: z.string().nullable(), resolution: z.string().nullable(),
    createdAt: z.date(), updatedAt: z.date() }`.
    (`reporterEmail` joined for admin display; null for own-list of a deleted
    account — for the owner list it is their own email.)
  - output `bugReportPageSchema` = `{ items: z.array(bugReportSchema),
    nextOffset: z.number().nullable() }` (mirror notification page).
  - Export inferred types: `BugReport`, `BugReportPage`, the input types.
- [ ] `src/notification.schema.ts` — EXTEND additively:
  - Add `BUG_REPORT_NEW: "BUG_REPORT_NEW"` to `NotificationType`.
  - Make `boardId` OPTIONAL and add `bugReportId: z.string().optional()` to
    `notificationPayloadSchema` (additive — existing 3 types still pass; the FE
    link code must null-check `boardId`). Document the per-type payload:
    `BUG_REPORT_NEW: { bugReportId, actorHandle, title, snippet? }`.
- [ ] `src/rbac.schema.ts` — add to `Permission`: `AdminBugsRead:
  "admin:bugs:read"`, `AdminBugsManage: "admin:bugs:manage"`; add the two matching
  `PERMISSION_CATALOG` entries (`label: "Read bug reports"` / `"Manage bug
  reports"`, `scope: "global"`). (The Zod enum + UI checklist derive from the
  catalog — adding here is sufficient.)
- [ ] `src/errors/bug-report.error.ts` — `BugReportError` const `as const` (mirror
  `invite.error`): `NOT_FOUND` (unknown id OR not the caller's and caller is not an
  admin — same message, no existence leak), `NO_FIELDS` (update with no changed
  field).
- [ ] `src/index.ts` — add `export * from "./bug-report.schema.js";` and
  `export * from "./errors/bug-report.error.js";` (barrel is explicit).
- [ ] `pnpm --filter shared build`.

## 3. Repo (`features/bug-report/bug-report.repo.ts`)
- [ ] `create(db, { reporterId, title, description, severity, pageUrl, userAgent })`
  — `insertInto("bug_reports").values({...}).returningAll().executeTakeFirstOrThrow()`.
- [ ] `listByReporter(db, reporterId, limit, offset)` — left join `users` for
  email; `.where("reporter_id","=",reporterId).orderBy("created_at","desc")
  .limit().offset()`.
- [ ] `listAll(db, { status?, severity?, limit, offset })` — left join `users`;
  conditional `.where("status","=",status)` / `.where("severity","=",severity)`
  when provided; newest-first; limit/offset.
- [ ] `findById(db, id)` — left join `users` for `reporter_email`; single row.
- [ ] `update(db, id, patch: { status?, severity?, resolution? })` — set provided
  fields + `updated_at: new Date()`; `.where("id","=",id).returningAll()
  .executeTakeFirst()` (undefined => row not found).
- [ ] `remove(db, id)` — `deleteFrom("bug_reports").where("id","=",id)
  .executeTakeFirst()`; return `Number(numDeletedRows)`.
- [ ] `listBugAdmins(db)` — recipients for the new-report nudge: users who are
  `is_superuser = true` OR whose role grants `admin:bugs:read` / `admin:bugs:manage`.
  Join `users -> roles -> role_permissions` (verify the exact RBAC join columns
  against `rbac.repo.findUserGlobalPerms` `:7-27` before writing) filtering
  `permission in ('admin:bugs:read','admin:bugs:manage')`, UNION users where
  `is_superuser`. Select `id` (+ `email` if needed); DISTINCT. Used only by the
  service notify step.

## 4. Service (`features/bug-report/bug-report.service.ts`)
Functions take `(db, user, input)`; `user` is the authed `ctx.user`.
- [ ] `submit(db, user, input, userAgent)` — `repo.create(db, { reporterId:
  user.id, ...input, userAgent })`; then BEST-EFFORT `notifyAdmins(db, created,
  user)` (own try/catch, logs `LogEvent.BugReportNotifyFailed`, never throws);
  map + return `bugReportSchema`.
- [ ] `notifyAdmins(db, report, reporter)` — `const admins = await
  repo.listBugAdmins(db)`; for each `a` where `a.id !== reporter.id`,
  `await notification.create(db, bus, { userId: a.id, type:
  NotificationType.BUG_REPORT_NEW, payload: { bugReportId: report.id, title:
  report.title, actorHandle: handleFromEmail(reporter.email), snippet:
  report.description.slice(0,140) } })`. (`handleFromEmail` is exported from
  `notification.recorder.ts:41`.)
- [ ] `listMine(db, user, { limit, offset })` — `repo.listByReporter`; map; compute
  `nextOffset` (mirror notification list).
- [ ] `listAll(db, _user, input)` — `repo.listAll`; map; `nextOffset`. (Authz is on
  the router via `globalProcedure`; the service trusts the caller.)
- [ ] `get(db, user, { id })` — `const row = await repo.findById(db, id)`; if `!row`
  -> `TRPCError NOT_FOUND`; if `row.reporter_id !== user.id` AND NOT
  (`user.isSuperuser || hasPermission(user.permissions, AdminBugsRead)`) ->
  `NOT_FOUND` (no existence leak); else map + return.
- [ ] `update(db, _user, input)` — guard `NO_FIELDS` if status/severity/resolution
  all undefined; `const row = await repo.update(db, input.id, {...})`; if `!row` ->
  `NOT_FOUND`; map + return. (Manage gate on the router.)
- [ ] `remove(db, _user, { id })` — `const n = await repo.remove(db, id)`; if
  `n === 0` -> `NOT_FOUND`; return `{ ok: true }`.

## 5. Router (`features/bug-report/bug-report.router.ts`)
- [ ] tRPC `bugReportsRouter`. Mirror the notification router `.meta` openapi shape.
  `submit` should use a rate-limited + protected procedure (compose
  `rateLimitedProcedure(N).use(<auth>)` OR apply the limit then reuse the protected
  chain — verify how `rateLimitedProcedure` composes with auth in `auth.router.ts`
  before writing; simplest: `protectedProcedure` + an explicit per-IP guard, or
  reuse the existing rate-limit middleware).
  - `submit` — POST `/bug-reports`, input `submitBugReportInput`, output
    `bugReportSchema`, `.mutation` -> `submit(ctx.db, ctx.user, input,
    ctx.userAgent ?? null)`. (Pass the UA from context — verify `ctx` exposes the
    request headers; if not, read it in the router from `ctx.req` like the SSE
    routes, or add `userAgent` to the tRPC context. Confirm before writing.)
  - `listMine` — `protectedProcedure`, GET `/bug-reports/mine`, input
    `listMyBugReportsInput`, output `bugReportPageSchema`, `.query` -> `listMine`.
  - `list` — `globalProcedure(Permission.AdminBugsRead)`, GET `/bug-reports`, input
    `listBugReportsInput`, output `bugReportPageSchema`, `.query` -> `listAll`.
  - `get` — `protectedProcedure`, GET `/bug-reports/{id}`, input `getBugReportInput`,
    output `bugReportSchema`, `.query` -> `get` (service does owner-or-admin check).
  - `update` — `globalProcedure(Permission.AdminBugsManage)`, PATCH
    `/bug-reports/{id}`, input `updateBugReportInput`, output `bugReportSchema`,
    `.mutation` -> `update`.
  - `remove` — `globalProcedure(Permission.AdminBugsManage)`, DELETE
    `/bug-reports/{id}`, input `deleteBugReportInput`, output
    `z.object({ ok: z.literal(true) })`, `.mutation` -> `remove`.
- [ ] Register `bugReports: bugReportsRouter` in `trpc/router.ts`.
- [ ] `config/const.config.ts` — add `BugReportNotifyFailed:
  "bug-report.notify.failed"` to `LogEvent`.

## 6. Test-harness wiring (REQUIRED)
- [ ] `features/auth/test/helpers.ts` — register `up024` in the migration chain
  (import + call after the current last `up`). WITHOUT this every bug-report test
  runs against a table-less DB.
- [ ] Notify tests: the submit path publishes to the bus singleton via the
  notification recorder. Spy `bus.publishUser` OR inject a fake; assert one nudge
  per admin (minus the reporter). Reuse the in-proc bus (REDIS_URL empty).

## 7. Tests (pg-mem, mirror `features/invite/test` + `features/notification/test`)
Reuse `seedUser` / `authedCaller` / `makeContext` helpers + a permission-seed
helper (mirror `rbac/test/authz.ts` to grant `admin:bugs:*`).

### submit
- [ ] verified user submits -> one `bug_reports` row, `reporter_id = caller`,
  `status = "open"`, severity as sent, `page_url` stored, `user_agent` stamped
  from the request, `created_at` set; output matches `bugReportSchema`.
- [ ] invalid input (title < 3, description empty, bad severity enum) -> input
  validation rejects.
- [ ] each NEW report nudges every bug-admin in-app EXCEPT the reporter:
  seed 2 admins (one via role perm, one superuser) + 1 plain user; the plain user
  submits -> a `BUG_REPORT_NEW` notification row for BOTH admins, none for the
  reporter; `payload.bugReportId` = report id, `actorHandle` = reporter handle.
- [ ] an admin submitting their own report does NOT nudge themselves (self
  excluded), but DOES nudge the OTHER admin.
- [ ] notify is best-effort: force `listBugAdmins` / the recorder to throw (mock)
  -> submit still SUCCEEDS and returns the row; error logged
  (`LogEvent.BugReportNotifyFailed`); no exception propagates.

### my reports / isolation
- [ ] `listMine` returns ONLY the caller's reports, newest-first, paginated
  (`nextOffset`); a second user's reports never appear.
- [ ] `get` on the caller's own report -> returns it; `get` on another user's
  report by a non-admin -> `NOT_FOUND`; by an admin -> returns it.

### admin list / filter
- [ ] `list` without `AdminBugsRead` (and not superuser) -> FORBIDDEN.
- [ ] `list` as admin returns ALL reports; `status` filter and `severity` filter
  each narrow the set; combined filter ANDs; pagination via `nextOffset`.

### update
- [ ] `update` without `AdminBugsManage` -> FORBIDDEN.
- [ ] admin sets `status: "in_progress"` -> persisted, `updated_at` advances;
  setting `resolution` + `status: "resolved"` persists both.
- [ ] `update` with no changed field -> `NO_FIELDS`.
- [ ] `update` on unknown id -> `NOT_FOUND`. Bad enum value -> input rejected.

### delete
- [ ] `remove` without `AdminBugsManage` -> FORBIDDEN.
- [ ] admin `remove` deletes the row (`ok:true`); a second `remove` -> `NOT_FOUND`.

### reporter account deletion
- [ ] delete the reporter user -> their reports survive with `reporter_id` NULL;
  admin `get`/`list` shows `reporterEmail` null (migration spec + a service map
  test).

### migration
- [ ] `024.bug-report.spec.ts`: up creates the table + both indexes; insert works;
  reporter-delete sets NULL (not cascade); down drops.

## 8. Verify
- [ ] `pnpm --filter shared build`
- [ ] `pnpm --filter backend test` green (bus in-proc / spied; no email path).
- [ ] `pnpm --filter backend migrate` auto-discovers `024.bug-report`.
- [ ] Swagger shows the 6 `/bug-reports*` routes with correct auth tags.
- [ ] New permissions `admin:bugs:read` / `admin:bugs:manage` appear in the RBAC
  permission catalog (role editor lists them).
