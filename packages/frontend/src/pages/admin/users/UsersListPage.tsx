import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Permission, type AdminUser } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { useCan } from "../../../features/rbac/hooks/useCan";
import { rbacErrorMessage } from "../../../features/rbac/errors";

const PAGE_SIZE = 20;

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-border/70">
      <div className="h-11 border-b border-border bg-canvas/80" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-t border-border px-4 py-3">
          <div className="h-3 w-48 animate-pulse rounded bg-surface-muted" />
          <div className="ml-auto h-3 w-16 animate-pulse rounded bg-surface-muted" />
          <div className="h-6 w-28 animate-pulse rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}

export function UsersListPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canManage = useCan(Permission.AdminUsersManage);

  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const usersQuery = useQuery(
    trpc.admin.usersList.queryOptions({
      search: search.trim() || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
  );

  // Role options for the assign select. Requires admin:roles:read; only
  // attempted when the admin can actually manage users.
  const rolesQuery = useQuery({
    ...trpc.admin.rolesList.queryOptions({}),
    enabled: canManage,
  });

  const assignMutation = useMutation(
    trpc.admin.usersAssignRole.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.admin.usersList.queryKey(),
        }),
    }),
  );

  const onAssign = (user: AdminUser, roleId: string) => {
    assignMutation.mutate({ userId: user.id, roleId: roleId || null });
  };

  const users = usersQuery.data ?? [];
  const roles = rolesQuery.data ?? [];

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Users
        </h1>
        <p className="mt-1 text-sm text-muted">
          Review accounts and assign roles.
        </p>
      </header>

      <input
        type="search"
        placeholder="Search by email..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOffset(0);
        }}
        className="mb-4 w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-500"
      />

      {assignMutation.error ? (
        <p className="mb-2 text-sm text-red-600">
          {rbacErrorMessage(assignMutation.error)}
        </p>
      ) : null}

      {usersQuery.isLoading ? (
        <TableSkeleton />
      ) : (
        <table className="w-full overflow-hidden rounded-xl bg-surface text-sm shadow-sm ring-1 ring-border/70">
          <thead className="border-b border-border bg-canvas/80 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Verified</th>
              <th className="px-4 py-3 font-semibold">Superuser</th>
              <th className="px-4 py-3 font-semibold">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className="border-t border-border text-foreground/80 transition-colors hover:bg-canvas/60"
              >
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.emailVerified ? "Yes" : "No"}</td>
                <td className="px-4 py-2">
                  {u.isSuperuser ? (
                    <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Superuser
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-2">
                  {canManage && !u.isSuperuser ? (
                    <select
                      value={u.role?.id ?? ""}
                      disabled={assignMutation.isPending}
                      onChange={(e) => onAssign(u, e.target.value)}
                      className="rounded-lg border border-border px-2 py-1 text-sm"
                    >
                      <option value="">No role</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (u.role?.name ?? "-")
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted">
                  No users match this search.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      <div className="mt-4 flex items-center gap-3 text-sm">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground/80 hover:bg-surface-muted disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-muted">
          {offset + 1}-{offset + users.length}
        </span>
        <button
          type="button"
          disabled={users.length < PAGE_SIZE}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground/80 hover:bg-surface-muted disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
