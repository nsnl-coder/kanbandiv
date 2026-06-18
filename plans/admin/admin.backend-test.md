# Admin RBAC - backend test PLAN

Scope: admin/global plane only. Project/member access control deferred (no tests here).
Harness mirrors `features/auth/test`. In-memory Postgres (pg-mem), run migrations, call tRPC
procedures via `createCaller`, assert `TRPCError` `code`/`message`.

## Test helpers needed (new: `features/rbac/test/helpers.ts`)

Reuse from `features/auth/test/helpers.ts`: `newTestDb`, `makeContext`, `createCaller`, `resSpy`.
After Step-0 revert, `newTestDb` must run BOTH `001.auth` + `002.rbac` `up`; `seedUser` drops the
`role` arg and accepts `isSuperuser`/`roleId`.

- [x] `newTestDb()` runs `001.auth` then `002.rbac` migrations (extend auth helper or add local).
- [x] `seedUser(db, {email?, isSuperuser?, roleId?, verified?})` -> user row (no `role` column).
- [x] `seedRole(db, {name, description?, permissions?:Permission[]})` -> role row + role_permissions.
- [x] `seedUserWithRole(db, {email, permissions:Permission[]})` -> creates role, assigns user, returns `{user, role}`.
- [x] `authedCaller(db, userId)` = `createCaller(makeContext({db, userId}))` (auth via ctx.userId like `me.spec.ts`).
- [x] `superuserCaller(db)` = seed user `isSuperuser=true`, return authed caller.
- [x] `noPermsCaller(db)` = seed verified user with no role, return authed caller.

Auth convention reused: authenticate by `makeContext({db, userId})`; unauthenticated by `userId:null`.

---

## `migrations/002.rbac.spec.ts` (mirror `001.auth.spec.ts`)

Arrange: `freshDb()` then `up(db)` (after `001.auth` up, since `users` must pre-exist).

- [x] `up` creates `roles`, `role_permissions` tables (select 1 succeeds).
- [x] `up` adds `users.is_superuser` (default false) and `users.role_id` (nullable) columns.
- [x] `up` drops `users.role` column (insert without `role` succeeds; select `role` rejects).
- [x] `role_permissions` PK `(role_id, permission)`: duplicate insert rejects.
- [x] FK cascade: delete a role -> its `role_permissions` rows removed.
- [x] FK set-null: delete a role assigned to a user -> that user's `role_id` becomes null (user kept).
- [x] index `role_permissions_role_idx` exists (optional; query pg_indexes).
- [x] `down` drops `roles` + `role_permissions`, restores/keeps `users` (select on dropped tables rejects).

---

## shared unit test `packages/shared/src/rbac.schema.spec.ts`

Pure logic, no DB.

- [x] `hasPermission(set, perm)` true when perm in set.
- [x] `hasPermission(set, perm)` false when perm absent.
- [x] `hasPermission(emptySet, perm)` false.
- [x] `PERMISSION_CATALOG` integrity: every `key` is a valid `Permission` enum value.
- [x] `PERMISSION_CATALOG` covers all enum members (no missing permission).
- [x] `PERMISSION_CATALOG` keys are unique; each has a non-empty `label`.
- [x] zod `createRoleInput` accepts `{name, description?, permissions?}`; rejects empty name.
- [x] zod `assignGlobalRoleInput` accepts `{roleId:string}` and `{roleId:null}`.
- [x] zod `updateRolePermissionsInput` rejects an unknown permission string.

---

## middleware `features/rbac/test/middleware.spec.ts`

Tests `protectedProcedure` (injects `isSuperuser` + `permissions:Set`) and `globalProcedure(perm)`.
Use any guarded admin endpoint as the probe (e.g. `admin.permissions.list`, guard `admin:roles:read`).

protectedProcedure:
- [x] unauthenticated (`userId:null`) -> `code UNAUTHORIZED`, `message SESSION_EXPIRED`.
- [x] token user not in DB -> `UNAUTHORIZED` / `SESSION_EXPIRED`.
- [x] unverified user -> `UNAUTHORIZED` / `SESSION_EXPIRED`.
- [x] verified user -> ctx gets `isSuperuser` + `permissions` set (assert via a probe endpoint succeeding/failing).

globalProcedure(permission):
- [x] superuser -> bypass, allowed regardless of role/permissions.
- [x] user whose role HAS the required permission -> allowed.
- [x] user whose role LACKS it -> `code FORBIDDEN`, `message FORBIDDEN`.
- [x] user with no role at all -> `FORBIDDEN`.

---

## Endpoint specs (under `features/rbac/test/`)

Authz matrix abbreviations applied to EVERY guarded endpoint:
- SU = superuser allowed (bypass)
- HAS = user whose role has `<guard perm>` allowed
- LACKS = user without it -> `FORBIDDEN`/`FORBIDDEN`
- ANON = `userId:null` -> `UNAUTHORIZED`/`SESSION_EXPIRED`

### `permissions.list.spec.ts` (guard admin:roles:read)
- [x] happy: returns `PermissionMeta[]` equal to `PERMISSION_CATALOG`.
- [x] authz: SU, HAS, LACKS, ANON.

### `roles.list.spec.ts` (guard admin:roles:read)
- [x] happy: returns `Role[]` with `permissions[]` and member count per role.
- [x] empty DB -> `[]`.
- [x] member count correct (seed 2 users on one role -> count 2).
- [x] authz: SU, HAS, LACKS, ANON.

### `roles.get.spec.ts` (guard admin:roles:read)
- [x] happy: existing roleId -> `Role` with `permissions[]`.
- [x] missing roleId (random uuid) -> `ROLE_NOT_FOUND`.
- [x] authz: SU, HAS, LACKS, ANON.

### `roles.create.spec.ts` (guard admin:roles:manage)
- [x] happy: `{name, description, permissions:[valid]}` -> `Role` returned; row + role_permissions persisted.
- [x] happy: create with empty permission set -> role with `permissions:[]`.
- [x] duplicate name -> `ROLE_NAME_TAKEN`.
- [x] permission not in catalog -> `UNKNOWN_PERMISSION` (caught pre-insert; no row created).
- [x] zod: empty `name` -> `TRPCError` (BAD_REQUEST).
- [x] authz: SU, HAS, LACKS, ANON.

### `roles.update.spec.ts` (guard admin:roles:manage)
- [x] happy: rename + change description -> updated `Role`; `updated_at` changes.
- [x] missing roleId -> `ROLE_NOT_FOUND`.
- [x] rename to a name owned by another role -> `ROLE_NAME_TAKEN`.
- [x] rename to its own current name -> allowed (no false `ROLE_NAME_TAKEN`).
- [x] authz: SU, HAS, LACKS, ANON.

### `roles.setPermissions.spec.ts` (guard admin:roles:manage)
- [x] happy: replace permission set -> returned `Role.permissions` equals input; old rows gone.
- [x] empty permissions array -> role left with `permissions:[]`.
- [x] unknown permission -> `UNKNOWN_PERMISSION`; existing permissions unchanged.
- [x] missing roleId -> `ROLE_NOT_FOUND`.
- [x] idempotent: setting same set twice -> no duplicate rows (PK holds).
- [x] authz: SU, HAS, LACKS, ANON.

### `roles.delete.spec.ts` (guard admin:roles:manage)
- [x] happy: delete unassigned role -> `okSchema`; row gone; role_permissions gone (cascade).
- [x] delete role assigned to users -> succeeds; affected users' `role_id` set null (FK set null).
- [x] delete missing roleId -> `ROLE_NOT_FOUND` (or `okSchema` if idempotent; assert per plan = NOT_FOUND).
- [x] authz: SU, HAS, LACKS, ANON.

### `users.list.spec.ts` (guard admin:users:read)
- [x] happy: returns `AdminUser[]`; each excludes `password_hash`.
- [x] shape: `{id,email,emailVerified,isSuperuser,role:{id,name}|null}`; user with no role -> `role:null`.
- [x] paging/search (`listUsersInput`): search by email filters; limit/offset respected.
- [x] authz: SU, HAS, LACKS, ANON.

### `users.get.spec.ts` (guard admin:users:read)
- [x] happy: existing userId -> `AdminUser` (no `password_hash`).
- [x] user with assigned role -> `role:{id,name}` populated.
- [x] missing userId -> NOT_FOUND (per plan; assert code/message used by repo).
- [x] authz: SU, HAS, LACKS, ANON.

### `users.assignRole.spec.ts` (guard admin:users:manage)
- [x] happy: `{roleId}` valid -> user `role_id` set; returned `AdminUser.role` populated.
- [x] unassign: `{roleId:null}` -> user `role_id` cleared; `AdminUser.role:null`.
- [x] non-existent role -> `ROLE_NOT_FOUND`; user unchanged.
- [x] re-assign over an existing role -> overwrites, single role_id.
- [x] `is_superuser` not editable here (no input field; assigning role does not flip it).
- [x] authz: SU, HAS, LACKS, ANON.

---

## Notes
- After Step-0 revert, existing auth specs referencing `user.role` break; fix `seedUser`/`me.spec`
  to `isSuperuser`/`roleId` as part of this task (plan line 111/118).
- ANON message is `SESSION_EXPIRED` per `protectedProcedure` (UNAUTHORIZED code).
- Assert error `message` against `RbacError` enum constants, `code` against TRPC codes (mirror `login.spec.ts`).
