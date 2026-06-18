import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Permission, type AdminUser } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { useCan } from "../../../features/rbac/hooks/useCan";
import { rbacErrorMessage } from "../../../features/rbac/errors";

const PAGE_SIZE = 20;

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
      <h1 className="mb-4 text-2xl font-bold text-slate-800">Users</h1>

      <input
        type="search"
        placeholder="Search by email..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOffset(0);
        }}
        className="mb-4 w-full max-w-sm rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
      />

      {assignMutation.error ? (
        <p className="mb-2 text-sm text-red-600">
          {rbacErrorMessage(assignMutation.error)}
        </p>
      ) : null}

      {usersQuery.isLoading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : (
        <table className="w-full overflow-hidden rounded border border-slate-200 bg-white text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Verified</th>
              <th className="px-4 py-2 font-medium">Superuser</th>
              <th className="px-4 py-2 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 text-slate-700">
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.emailVerified ? "Yes" : "No"}</td>
                <td className="px-4 py-2">
                  {u.isSuperuser ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
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
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
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
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  No users found.
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
          className="rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-slate-500">
          {offset + 1}-{offset + users.length}
        </span>
        <button
          type="button"
          disabled={users.length < PAGE_SIZE}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          className="rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
