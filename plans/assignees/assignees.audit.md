# Assignees Plan — Production-Readiness Audit

Audited the two plan files against the actual codebase. Every referenced file/
function was read. Findings below, by severity. Both plan files were rewritten in
place with the fixes.

## Verified-correct (no change needed)

- `loadBoardFor(db, user, id, min)` signature + behavior: confirmed
  (`board.service.ts:95`). Throws `boardNotFound()` (NOT_FOUND) when `min==="view"`
  and perm too low; throws `forbidden()` (FORBIDDEN) when `min==="edit"/"owner"`
  and perm too low. So mapping board NOT_FOUND -> `CARD_NOT_FOUND` hides existence,
  while an edit-level shortfall correctly surfaces FORBIDDEN. Matches plan intent.
- `comment.service.resolveCardBoard` pattern (`comment.service.ts:50`): card ->
  column -> `loadBoardFor`, catch TRPCError NOT_FOUND -> `cardNotFound()`. Copy is valid.
- `nameFromEmail = email.split("@")[0]` (`comment.service.ts:42`). Confirmed.
- `PublicUser` shape (`auth.schema.ts:90`): `id, email, isSuperuser, roleId?,
  emailVerified, permissions`. NO `name`, NO `avatar`. Plan's display note correct.
- `card.enrich.ts` batch pattern (`enrichCards`, line 25): all enrichers are one
  batched call each; `commentRepo.countByCards` empty-guard at `comment.repo.ts:142`.
- `email.service.ts` `EmailPort` + `noticeTemplate` + `sendCommentMention`
  structure: confirmed; `esc()` applied inside templates.
- `board.service.revokeBoardAccess` (line 274) calls `repo.deleteBoardAccess`
  (`board.repo.ts:140`). Loads board at `"owner"` min, so the revoke + cleanup
  cannot be reached by a non-owner.
- Cascade: `card_id`/`user_id` FK `onDelete("cascade")` is the right pattern
  (mirrors `012.comment.ts`). `board_access` deletion does NOT cascade card
  assignees (no FK from card_assignees to board_access) -> explicit cleanup needed.
  Plan's "DB cascade only fires on user/card delete" claim is correct.
- Live migration runner auto-discovers files (`scripts/migrate.script.ts:13`,
  globs the folder, skips `.spec.`). Plan's "auto-discovers 014" is correct.
- Migration spec style (`013.attachment.spec.ts`): pg-mem + register
  `gen_random_uuid`, run prior ups, assert insert/cascade/down. Valid model.
- Idempotent insert via `onConflict(...).doNothing()`: matches
  `comment.repo.insertMentions` (`comment.repo.ts:84`).

## Issues found

### CRITICAL

1. **Test bootstrap is hardcoded, not auto-discovered (backend plan omits this).**
   `auth/test/helpers.ts` (`newTestDb`, lines 10-53) imports and runs `up001..up013`
   one by one. Adding migration 014 to the test DB REQUIRES editing this file to
   import `up as up014` and call it. The plan only mentions the live runner
   auto-discovers; the tests will silently run against a DB with no `card_assignees`
   table and every assignee test will fail. FIX: added an explicit task to register
   `up014` in `auth/test/helpers.ts`.

2. **FakeEmail / EmailPort fake not updated (backend plan omits this).**
   `EmailPort` is a TypeScript interface. Adding `sendCardAssigned` to it makes the
   existing `fakeEmail()` in `auth/test/helpers.ts` (line 71) AND the `SentEmail`
   union (line 56) a compile error until `sendCardAssigned` + an `"assigned"` type
   are added. The plan said "use a FAKE injected EmailPort (mock like comment tests)"
   but did not state the shared fake must be extended. FIX: added explicit tasks to
   extend `SentEmail` (`type: "assigned"`) and `fakeEmail()`; tests assert
   `email.sent.filter((e) => e.type === "assigned")` (mirrors comment test line 137).

3. **Router does not import `emailService`; it uses `ctx.email`.**
   Backend plan said: "Mirror comment.router's ... how it imports `emailService`
   (or accepts it from context)." `comment.router.ts:32` passes `ctx.email`, never
   imports `emailService`. The service signature is `(db, user, email, input)` and
   the email is supplied by context (so tests can inject the fake). FIX: plan now
   says `assign(ctx.db, user(ctx), ctx.email, input)` — NOT `emailService`. Using
   the singleton would make the email un-mockable and break the email-once tests.

### HIGH

4. **"public-project viewers" are NOT in the assignable set.**
   Backend plan intro claims the assignable set = "...public-project viewers,
   superuser". But the chosen resolver `comment.repo.listBoardMembers`
   (`comment.repo.ts:104`) enumerates only board owner + project owner +
   `board_access` + `project_access` rows. It cannot enumerate anonymous/public
   viewers (no row exists) and does not add the superuser. So a public-project
   viewer with no explicit grant is NOT returned and CANNOT be assigned, and the
   membership-validation step would reject them as `NOT_BOARD_MEMBER`. FIX:
   corrected the plan's definition of "assignable member" to match the actual
   `listBoardMembers` output (explicit grantees + owners only). Documented that
   public viewers / superuser-by-flag are intentionally not assignable, with a
   test asserting a public-project viewer (no grant) -> `NOT_BOARD_MEMBER`.

5. **`assigneeColor` is not deterministic across server/client and must key off a
   stable field.** FE plan says "deterministic color from the id/email hash". Fine,
   but flagged: key off `id` (immutable) not `email` so the chip color is stable if
   email ever changes. Minor; FIX applied in FE plan wording.

### MEDIUM

6. **FE error-helper file naming + signature wrong.**
   FE plan says add `errors.ts` with `assigneeErrorMessage(code)`. Actual convention
   is per-feature `<feature>Errors.ts` (`commentErrors.ts`, `labelErrors.ts`) and
   the function takes `err: unknown`, narrows `TRPCClientError`, and reads
   `err.message` (the error CODE is sent as the TRPC message). See
   `commentErrors.ts:13`. FIX: plan now specifies `assigneeErrors.ts` with
   `assigneeErrorMessage(err: unknown)` mirroring `commentErrorMessage`.

7. **FE filter utils belong in the existing `utils.ts`, not a new file, and OR vs
   AND semantics must be explicit.** `cardMatchesLabels` (`utils.ts:62`) is an
   AND-match (`.every`). The plan wants assignee filter as OR (`.some`). That is a
   deliberate difference and is now stated explicitly so the implementer does not
   copy `.every`. Helpers added to the existing `features/board/utils.ts`.

8. **Current-user source is `useAuthStore`, not "the auth/session source the page
   already uses" (vague).** `BoardDetailPage.tsx:49` reads
   `useAuthStore((s) => s.user)`. FIX: FE plan now names it. `currentUser?.id` may
   be empty; the "assigned to me" toggle must no-op/disable when there is no id.

9. **`assigneeSchema` placement / barrel export.** `shared/src/index.ts` is an
   explicit barrel (lines 1-23). New files must be added there (plan already says
   this — confirmed correct). `cardSchema` lives at `card.schema.ts:46` and is the
   shape `boardDataSchema` reuses — extending it is the right single touch-point.
   No change, confirmed.

### LOW / clarifications

10. **`cardTitleById` vs inline select.** `comment.service` does an inline
    `selectFrom("cards").select(["title"])` (line 191), not a repo helper. Plan
    offered either; FIX: standardized on the inline select to match comment.service
    exactly and avoid an unused repo function.

11. **`listBoardMembers` already returns `{id,email}`** (`comment.repo.ts:134-138`)
    so the service maps straight to `assigneeSchema`. To avoid duplicating the
    ~35-line resolver, the plan now reuses `commentRepo.listBoardMembers` directly
    rather than reimplementing in `assignee.repo`. (Cross-feature repo import is
    already done: `card.enrich.ts:4` imports `commentRepo`.)

12. **Self-assign-no-email decision** is sound and matches comment's "never email
    the author". Kept, with explicit test.

13. **Re-grant does not restore old assignments** — confirmed: revoke deletes the
    `card_assignees` rows (hard delete), so a later re-grant starts empty. No
    soft-delete/restore path exists. Plan claim correct; added an explicit test.

## Summary of changes made to the plans

- Backend: added tasks to (a) register `up014` in `auth/test/helpers.ts`,
  (b) extend `SentEmail` + `fakeEmail` with `assigned`/`sendCardAssigned`,
  (c) pass `ctx.email` (not `emailService`) in the router, (d) correct the
  assignable-set definition (no public viewers/superuser-by-flag), (e) reuse
  `commentRepo.listBoardMembers` directly, (f) inline card-title select.
- Frontend: renamed `errors.ts` -> `assigneeErrors.ts` with `(err: unknown)`
  signature, moved filter helpers into existing `utils.ts` with explicit OR vs AND
  semantics, named `useAuthStore` as the current-user source with an empty-id
  guard, keyed avatar color off `id`.
</content>
</invoke>
