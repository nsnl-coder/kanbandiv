import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PERMISSION_CATALOG,
  Permission,
  createRoleInput,
  updateRoleInput,
  z,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import { useCan } from "../../../features/rbac/hooks/useCan";
import { rbacErrorMessage } from "../../../features/rbac/errors";

const formSchema = createRoleInput.pick({ name: true }).extend({
  description: z.string().trim().max(500).optional(),
});
type FormValues = z.infer<typeof formSchema>;

export function RoleFormPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { roleId } = useParams<{ roleId: string }>();
  const isEdit = Boolean(roleId);
  const canManage = useCan(Permission.AdminRolesManage);

  const [selected, setSelected] = useState<Set<Permission>>(new Set());

  const roleQuery = useQuery({
    ...trpc.admin.rolesGet.queryOptions({ roleId: roleId! }),
    enabled: isEdit,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  useEffect(() => {
    if (roleQuery.data) {
      reset({
        name: roleQuery.data.name,
        description: roleQuery.data.description ?? "",
      });
      setSelected(new Set(roleQuery.data.permissions));
    }
  }, [roleQuery.data, reset]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.admin.rolesList.queryKey() });
    if (roleId) {
      queryClient.invalidateQueries({
        queryKey: trpc.admin.rolesGet.queryKey({ roleId }),
      });
    }
  };

  const createMutation = useMutation(
    trpc.admin.rolesCreate.mutationOptions({
      onSuccess: () => {
        invalidate();
        navigate("/admin/roles");
      },
    }),
  );

  const updateMutation = useMutation(
    trpc.admin.rolesUpdate.mutationOptions({ onSuccess: invalidate }),
  );

  const setPermsMutation = useMutation(
    trpc.admin.rolesSetPermissions.mutationOptions({ onSuccess: invalidate }),
  );

  const toggle = (perm: Permission) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  };

  const onSubmit = handleSubmit((values) => {
    const description = values.description?.length ? values.description : undefined;
    if (isEdit) {
      updateMutation.mutate({
        roleId: roleId!,
        name: values.name,
        description: description ?? null,
      });
    } else {
      createMutation.mutate({
        name: values.name,
        description,
        permissions: [...selected],
      });
    }
  });

  const savePermissions = () => {
    if (!roleId) return;
    setPermsMutation.mutate({ roleId, permissions: [...selected] });
  };

  const detailsError = createMutation.error ?? updateMutation.error;
  const disabled = !canManage;

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {isEdit ? (canManage ? "Edit role" : "Role") : "New role"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {canManage
            ? "Name the role and choose what its members can do."
            : "Read-only view of this role and its permissions."}
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-xl bg-surface p-6 shadow-sm ring-1 ring-border/70"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium text-foreground/80">
            Name
          </label>
          <input
            id="name"
            disabled={disabled}
            {...register("name")}
            className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:bg-surface-muted"
          />
          {errors.name ? (
            <p className="text-xs text-red-600">{errors.name.message}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="description"
            className="text-sm font-medium text-foreground/80"
          >
            Description
          </label>
          <textarea
            id="description"
            rows={2}
            disabled={disabled}
            {...register("description")}
            className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:bg-surface-muted"
          />
        </div>

        {detailsError ? (
          <p className="text-sm text-red-600">{rbacErrorMessage(detailsError)}</p>
        ) : null}

        {canManage ? (
          <button
            type="submit"
            disabled={createMutation.isPending || updateMutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isEdit ? "Save details" : "Create role"}
          </button>
        ) : null}
      </form>

      <section className="mt-6 rounded-xl bg-surface p-6 shadow-sm ring-1 ring-border/70">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Permissions
        </h2>
        <div className="mt-3 space-y-2">
          {PERMISSION_CATALOG.map((p) => (
            <label
              key={p.key}
              className="flex items-center gap-2 text-sm text-foreground/80"
            >
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.has(p.key)}
                onChange={() => toggle(p.key)}
              />
              {p.label}
              <span className="text-xs text-muted">({p.key})</span>
            </label>
          ))}
        </div>

        {setPermsMutation.error ? (
          <p className="mt-2 text-sm text-red-600">
            {rbacErrorMessage(setPermsMutation.error)}
          </p>
        ) : null}

        {isEdit && canManage ? (
          <button
            type="button"
            onClick={savePermissions}
            disabled={setPermsMutation.isPending}
            className="mt-3 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-surface-muted disabled:opacity-50"
          >
            Save permissions
          </button>
        ) : null}
        {!isEdit ? (
          <p className="mt-2 text-xs text-muted">
            Permissions are saved together with the new role.
          </p>
        ) : null}
      </section>
    </div>
  );
}
