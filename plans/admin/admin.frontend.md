# Admin Access Control (RBAC) - frontend

## Context

Depends on the backend plan (`admin.backend.md`). Backend now exposes dynamic global
roles + a code-defined permission catalog, mounted as the `admin` tRPC router.
This plan covers: permission-aware route guards, a role-management admin UI, and a
user-management admin UI.

Key contract change from backend:
- `PublicUser` dropped `role`; now carries `isSuperuser` + nullable `roleId`.
  So the current `ProtectedRoute role="admin"` and `user.role` checks
  (`App.tsx:59`, `ProtectedRoute.tsx:24-26`) **no longer compile** and must change.

### Blocking dependency: how the client learns its effective permissions

`PublicUser` has no permissions, only `isSuperuser` + `roleId`. The client cannot
resolve `roleId -> permissions` on its own (mapping is server-side). So gating UI
needs the backend to return the resolved permission set for the current user.

Decision (recommended): backend adds the resolved global permissions to the auth
payload. Extend `publicUserSchema` with `permissions: Permission[]` (or expose
`auth.me` returning `{ ...PublicUser, permissions }`). `toPublicUser` already loads
perms via `findUserGlobalPerms`. Until that lands, frontend can only gate on
`isSuperuser`. Confirm this with backend before starting Phase 2+.

## Phase 0 - Fix the build break (must come with backend merge)

- [ ] `ProtectedRoute.tsx`: drop `role`/`AuthRole` logic that reads `user.role`.
  Replace with permission/superuser guard (see Phase 1).
- [ ] `App.tsx`: replace `<Route element={<ProtectedRoute role="admin" />}>` with
  the new admin guard.
- [ ] Grep for any other `user.role` / `AuthRole` usage in `packages/frontend`.
- [ ] `pnpm --filter frontend build` compiles.

## Phase 1 - Permission primitives (`features/rbac/`)

- [ ] `features/rbac/hooks/usePermissions.ts`: derive `{ isSuperuser, permissions:
  Set<Permission> }` from `useAuthStore().user`. Empty set when logged out.
- [ ] `features/rbac/hooks/useCan.ts`: `useCan(perm: Permission): boolean` =
  `isSuperuser || hasPermission(set, perm)` (reuse `hasPermission` from shared).
- [ ] `features/rbac/components/Can.tsx`: `<Can perm={...} fallback={null}>` wrapper
  that renders children only when `useCan(perm)` is true.
- [ ] `components/PermissionRoute.tsx`: route guard. Not logged in -> redirect
  `/login?next=`. Logged in but missing perm -> redirect home (or a `/403`).
  Props: `perm?: Permission` (omit = any authenticated user).
- [ ] Replace `ProtectedRoute role="admin"` usages with
  `<PermissionRoute perm="admin:roles:read" />` (or a coarser "is admin" check;
  pick the lowest admin-read perm as the gate).

## Phase 2 - Admin shell + nav

- [ ] `pages/admin/AdminLayout.tsx`: admin nav (Roles, Users) + `<Outlet/>`,
  reusing `Nav`. Mount admin routes under `/admin/*` behind `PermissionRoute`.
- [ ] `Nav.tsx`: show an "Admin" link only when the user has any `admin:*:read`
  perm (use `useCan`).

## Phase 3 - Roles UI (`pages/admin/roles/`, perm `admin:roles:*`)

tRPC: `trpc.admin.roles.*`, `trpc.admin.permissions.list`. Read with `useQuery`,
mutate with `useMutation` + invalidate the roles query (per frontend rules, call
`trpc.*.queryOptions()` directly in components; no api-call hooks).

- [ ] `RolesListPage.tsx`: `@tanstack/react-table` list of roles
  (name, description, memberCount, permission count). "New role" button gated by
  `admin:roles:manage`.
- [ ] `RoleFormPage.tsx` (create + edit): react-hook-form + zod
  (`createRoleInput` / `updateRoleInput` from shared). Permission picker = toggles
  driven by `PERMISSION_CATALOG` (label + key); selected set -> `permissions[]`.
  - create -> `roles.create`; edit name/desc -> `roles.update`;
    permission toggles -> `roles.setPermissions` (`updateRolePermissionsInput`).
- [ ] Delete: confirm dialog -> `roles.delete`; invalidate list.
- [ ] Surface backend errors by message: `ROLE_NAME_TAKEN`, `ROLE_NOT_FOUND`,
  `UNKNOWN_PERMISSION` (map from `RbacError` constants in shared).

## Phase 4 - Users UI (`pages/admin/users/`, perm `admin:users:*`)

tRPC: `trpc.admin.users.*`.

- [ ] `UsersListPage.tsx`: `@tanstack/react-table` with search + paging
  (`listUsersInput` {search, limit, offset}). Columns: email, emailVerified,
  superuser badge, current role name. Server-side paging via query input.
- [ ] Assign role: inline `<select>` of roles (from `roles.list`) +
  "No role" option -> `users.assignRole` (`assignGlobalRoleInput` {roleId|null}).
  Gated by `admin:users:manage`; read-only otherwise.
- [ ] `is_superuser` shown read-only (not editable here, per backend rules).
- [ ] Superuser row: badge + role `<select>` and all actions disabled (single,
  untouchable super admin - backend also rejects `assignRole` on it with
  `FORBIDDEN`). This is UX only; the DB/endpoint guards are the real enforcement.

## Phase 5 - Routing wiring (`App.tsx`)

```
/admin                      -> PermissionRoute(any admin read) > AdminLayout
  /admin/roles              -> RolesListPage           (admin:roles:read)
  /admin/roles/new          -> RoleFormPage            (admin:roles:manage)
  /admin/roles/:roleId      -> RoleFormPage            (admin:roles:read/manage)
  /admin/users              -> UsersListPage           (admin:users:read)
```
- [ ] Per-leaf `PermissionRoute perm=...` so a read-only admin can't reach manage
  screens.

## Tests (`vitest`, mock tRPC)

- [ ] `useCan` / `PermissionRoute`: superuser bypass, has-perm, missing-perm redirect.
- [ ] `Can`: renders/hides on perm.
- [ ] Role form: catalog toggles map to `permissions[]`; error messages surface.
- [ ] Users list: paging/search input wiring; assignRole mutation called with
  correct `{roleId|null}`.
- [ ] Never hit real DB; mock the tRPC client.

## Verification

- [ ] `pnpm --filter shared build && pnpm --filter frontend build`.
- [ ] Manual: superuser sees all admin screens; a role with only
  `admin:roles:read` sees Roles read-only, no Users link, no New/Delete.

## Open questions / confirm with backend

1. Permissions delivery: extend `publicUserSchema` with `permissions[]` vs a
   separate `auth.me`. (Phase 1 depends on this.)
2. Is `AuthRole` (`auth.schema.ts`) still used anywhere post-RBAC, or fully removed?
3. Need a `/403` page, or just redirect home on missing perm?
