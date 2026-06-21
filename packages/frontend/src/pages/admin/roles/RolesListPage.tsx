import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Permission, type Role } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { useCan } from "../../../features/rbac/hooks/useCan";
import { rbacErrorMessage } from "../../../features/rbac/errors";

const col = createColumnHelper<Role>();

export function RolesListPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canManage = useCan(Permission.AdminRolesManage);
  const [pendingDelete, setPendingDelete] = useState<Role | null>(null);

  const rolesQuery = useQuery(trpc.admin.rolesList.queryOptions({}));

  const deleteMutation = useMutation(
    trpc.admin.rolesDelete.mutationOptions({
      onSuccess: () => {
        setPendingDelete(null);
        queryClient.invalidateQueries({
          queryKey: trpc.admin.rolesList.queryKey(),
        });
      },
    }),
  );

  const columns = useMemo(
    () => [
      col.accessor("name", { header: "Name" }),
      col.accessor("description", {
        header: "Description",
        cell: (c) => c.getValue() ?? "-",
      }),
      col.accessor("memberCount", { header: "Members" }),
      col.accessor((r) => r.permissions.length, {
        id: "permCount",
        header: "Permissions",
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <div className="flex justify-end gap-2 text-sm">
            <Link
              to={`/admin/roles/${c.row.original.id}`}
              className="font-medium text-foreground/80 hover:text-foreground"
            >
              {canManage ? "Edit" : "View"}
            </Link>
            {canManage ? (
              <button
                type="button"
                onClick={() => setPendingDelete(c.row.original)}
                className="font-medium text-red-600 hover:text-red-700"
              >
                Delete
              </button>
            ) : null}
          </div>
        ),
      }),
    ],
    [canManage],
  );

  const table = useReactTable({
    data: rolesQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Roles
          </h1>
          <p className="mt-1 text-sm text-muted">
            Define permission sets and assign them to members.
          </p>
        </div>
        {canManage ? (
          <Link
            to="/admin/roles/new"
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 active:translate-y-px"
          >
            New role
          </Link>
        ) : null}
      </div>

      {rolesQuery.isLoading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : (
        <table className="w-full overflow-hidden rounded-xl bg-surface text-sm shadow-sm ring-1 ring-border/70">
          <thead className="border-b border-border bg-canvas/80 text-left text-xs uppercase tracking-wide text-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-4 py-3 font-semibold">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-border transition-colors hover:bg-canvas/60"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2 text-foreground/80">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-muted"
                >
                  No roles yet. Create one to get started.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      {pendingDelete ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl shadow-slate-900/10 ring-1 ring-border">
            <h2 className="text-lg font-semibold text-foreground">Delete role</h2>
            <p className="mt-2 text-sm text-foreground/70">
              Delete <strong>{pendingDelete.name}</strong>? Members keep their
              accounts but lose this role.
            </p>
            {deleteMutation.error ? (
              <p className="mt-2 text-sm text-red-600">
                {rbacErrorMessage(deleteMutation.error)}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() =>
                  deleteMutation.mutate({ roleId: pendingDelete.id })
                }
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
