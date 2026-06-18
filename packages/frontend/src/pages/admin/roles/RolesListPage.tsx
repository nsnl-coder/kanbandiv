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
              className="font-medium text-slate-700 hover:text-slate-900"
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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Roles</h1>
        {canManage ? (
          <Link
            to="/admin/roles/new"
            className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            New role
          </Link>
        ) : null}
      </div>

      {rolesQuery.isLoading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : (
        <table className="w-full overflow-hidden rounded border border-slate-200 bg-white text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-4 py-2 font-medium">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2 text-slate-700">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-6 text-center text-slate-500"
                >
                  No roles yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      {pendingDelete ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded bg-white p-5 shadow-lg">
            <h2 className="text-lg font-semibold text-slate-800">Delete role</h2>
            <p className="mt-2 text-sm text-slate-600">
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
                className="rounded px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() =>
                  deleteMutation.mutate({ roleId: pendingDelete.id })
                }
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
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
