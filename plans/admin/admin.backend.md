# Admin Access Control (RBAC) - backend core

## Context

Admin-side access control must be **dynamic**: roles created/edited at runtime so we can assign and
change admin permissions without a code deploy. The earlier static `owner/editor/viewer` +
`Role -> Permission[]` map is not what we want and is reverted first.

**Scope: admin/global plane only (backend + shared).** User/project access control (project
membership, per-member permissions, project/board tables, `projectProcedure`) is **deferred**.
Frontend + tests also deferred.

Decisions:
- Named, DB-driven **global roles** created/edited by admin. A user gets **one** global role
  (`users.role_id`) that carries global (`admin:*`) permissions.
- **Code-defined permission catalog**: possible permissions are a fixed enum in code (code must
  check them); only the role->permission mapping is dynamic.
- **No system/seeded roles**: every role is admin-created. Access is bootstrapped via
  `users.is_superuser` (god-mode), not hardcoded roles.

## Step 0 - Revert existing static RBAC changes (keep plans/)
- [x] `git checkout -- packages/backend/src/db/types.ts packages/backend/src/trpc/trpc.ts packages/shared/src/index.ts`
- [x] Remove untracked: `packages/backend/src/features/rbac/`, `packages/backend/src/migrations/002.rbac.ts`,
  `packages/frontend/src/components/AdminRoute.tsx`, `packages/frontend/src/features/rbac/`, and any
  `packages/shared/src/rbac.schema.ts` / `errors/rbac.error.ts` if present.
- [x] `git status` shows only `plans/`; build to confirm clean baseline.

## Model (global plane only)

Bootstrap via identity:
- `users.is_superuser` - platform god-mode (first admin via seed/env). Bypasses all permission checks.

Data-driven:
- **roles**: `id, name, description, created_at, updated_at`. Unique `(name)`.
- **role_permissions**: `role_id (fk cascade), permission (text)`. PK `(role_id, permission)`.
- **users**: `+ is_superuser (bool, default false)`, `+ role_id (nullable fk -> roles, on delete set null)`,
  drop `role` text column. No role = no admin perms.

Resolution: `globalPerms = is_superuser ? ALL : permissions(users.role_id)`.

### Single, untouchable super admin (invariant)

Exactly one superuser, immutable via the API:
- **DB**: partial unique index guarantees at most one:
  `CREATE UNIQUE INDEX users_one_superuser ON users ((is_superuser)) WHERE is_superuser`.
- **No write path**: no endpoint sets/clears `is_superuser` (seed/script only).
- `users.assignRole`: if target `is_superuser` -> `FORBIDDEN` (role not changeable).
- No user-delete endpoint; if ever added, must refuse deleting a superuser.
- Seed/bootstrap is idempotent: promote exactly one user, never a second.

## Permission catalog (code: `packages/shared/src/rbac.schema.ts`)

Fixed `Permission` enum, global scope only for now:
- `admin:users:read`, `admin:users:manage`
- `admin:roles:read`, `admin:roles:manage`

`PERMISSION_CATALOG: { key: Permission; label: string }[]` (drives the admin UI toggles).
`hasPermission(set: Set<Permission>, perm): boolean`. (`scope` tag kept optional for future project perms.)

## Admin endpoints (tRPC router: `features/rbac/rbac.router.ts`, mounted as `admin`)

All authed; each guarded by `globalProcedure(<perm>)` (superuser bypasses). superjson + OpenApiMeta.

| endpoint | method/path | input | output | guard |
|---|---|---|---|---|
| `admin.permissions.list` | GET /admin/permissions | - | `PermissionMeta[]` | admin:roles:read |
| `admin.roles.list` | GET /admin/roles | - | `Role[]` (with perms + member count) | admin:roles:read |
| `admin.roles.get` | GET /admin/roles/{roleId} | `{roleId}` | `Role` (with `permissions[]`) | admin:roles:read |
| `admin.roles.create` | POST /admin/roles | `createRoleInput` | `Role` | admin:roles:manage |
| `admin.roles.update` | PATCH /admin/roles/{roleId} | `updateRoleInput` | `Role` | admin:roles:manage |
| `admin.roles.setPermissions` | PUT /admin/roles/{roleId}/permissions | `updateRolePermissionsInput` | `Role` | admin:roles:manage |
| `admin.roles.delete` | DELETE /admin/roles/{roleId} | `{roleId}` | `okSchema` | admin:roles:manage |
| `admin.users.list` | GET /admin/users | `listUsersInput` (paging/search) | `AdminUser[]` | admin:users:read |
| `admin.users.get` | GET /admin/users/{userId} | `{userId}` | `AdminUser` | admin:users:read |
| `admin.users.assignRole` | PUT /admin/users/{userId}/role | `assignGlobalRoleInput` `{roleId\|null}` | `AdminUser` | admin:users:manage |

Endpoint rules:
- `roles.create` / `setPermissions`: validate each permission against the catalog -> `UNKNOWN_PERMISSION`.
- `roles.create` / `roles.update` name: enforce unique -> `ROLE_NAME_TAKEN`; missing role -> `ROLE_NOT_FOUND`.
- `roles.delete`: FK `on delete set null` clears `users.role_id`; safe even if assigned.
- `users.assignRole`: `roleId=null` removes the role; non-existent role -> `ROLE_NOT_FOUND`.
- `AdminUser` shape: `{ id, email, emailVerified, isSuperuser, role: { id, name } | null }` (no password_hash).
- `is_superuser` is not editable via these endpoints (seed/script only).

## Tasks

### shared (`packages/shared/src`)
- [x] `rbac.schema.ts`: `Permission` enum, `PERMISSION_CATALOG`, `hasPermission()`; zod:
  `createRoleInput {name, description?, permissions?:Permission[]}`,
  `updateRoleInput {name?, description?}`, `updateRolePermissionsInput {permissions:Permission[]}`,
  `assignGlobalRoleInput {roleId: string|null}`, `roleSchema`/`adminUserSchema` output shapes.
- [x] `errors/rbac.error.ts`: `FORBIDDEN`, `ROLE_NOT_FOUND`, `ROLE_NAME_TAKEN`, `UNKNOWN_PERMISSION`.
- [x] `index.ts`: export both.
- [x] `auth.schema.ts`: `PublicUser` carries `isSuperuser` (+ optional `roleId`) instead of `role`;
  drop `roleSchema` from the public user shape.

### backend (`packages/backend/src`)
- [x] `migrations/002.rbac.ts`: `roles`, `role_permissions`; `users` += `is_superuser` + `role_id`
  (fk roles, on delete set null), drop `users.role`; index `role_permissions_role_idx`; with `down`.
- [x] `db/types.ts`: add `RolesTable`, `RolePermissionsTable`; update `UsersTable`
  (`is_superuser`, `role_id`, drop `role`); register in `Database`.
- [x] `features/rbac/rbac.repo.ts`: `findUserGlobalPerms(userId) -> {isSuperuser, perms:Set}`;
  role CRUD (`createRole`, `listRoles`, `findRoleById`, `updateRole`, `deleteRole`,
  `setRolePermissions`, `findRolePermissions`); `assignUserRole(userId, roleId|null)`;
  `listUsers`, `findAdminUserById`.
- [x] `features/rbac/rbac.service.ts`: validation (catalog check, unique name), shape mapping to
  `Role` / `AdminUser`.
- [x] `features/rbac/rbac.router.ts`: the endpoints above; mount in `trpc/router.ts` as `admin`.
- [x] `features/auth/auth.repo.ts`: `PUBLIC_USER` / `findPublicUserById` return `is_superuser` +
  `role_id` instead of `role`; `createUser` drops the `role` arg.
- [x] `features/auth/auth.service.ts`: `AccessPayload`, `signAccessToken`/`verifyAccessToken`,
  `toPublicUser` updated to `isSuperuser`/`roleId` (no `role`).
- [x] `trpc/trpc.ts`: `protectedProcedure` injects `ctx.user.{isSuperuser, permissions:Set}` (loads
  global perms via `findUserGlobalPerms`); `globalProcedure(permission)` = protected + superuser
  bypass else require the permission, else `FORBIDDEN`.

## Deferred (next sessions)
- User/project access control: `projects` (+ owner_id), `boards`, `project_members`,
  `project_member_permissions`, `projectProcedure`, project perms in the catalog.
- Frontend: `useCan`, `Can`, `AdminRoute`/`ProtectedRoute` permission guards; admin role-management UI.
- Tests: `features/rbac/test/*.spec.ts` (endpoint matrix); fix auth tests referencing `role`.
- Seed/bootstrap script to set the first `is_superuser` user.
- Permission-set caching with invalidation on role edit.

## Verification (this session)
- [x] `cd packages/shared && pnpm build`.
- [x] `cd packages/backend && pnpm build` (typecheck + migration + router + middleware compile).
- Note: auth tests reference `user.role` and will break here; fixed in the next session's test task.
  Confirm only that shared + backend **compile**.
