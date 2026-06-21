import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ProjectPermission,
  grantAccessInput,
  type GrantAccessInput,
  type ProjectAccessEntry,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import { projectErrorMessage } from "../errors";

export function AccessPanel({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [permission, setPermission] = useState<ProjectPermission>(ProjectPermission.View);

  const accessQuery = useQuery(trpc.projects.accessList.queryOptions({ id: projectId }));

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.projects.accessList.queryKey({ id: projectId }),
    });

  const grantMutation = useMutation(
    trpc.projects.accessGrant.mutationOptions({ onSuccess: invalidate }),
  );
  const revokeMutation = useMutation(
    trpc.projects.accessRevoke.mutationOptions({ onSuccess: invalidate }),
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GrantAccessInput>({
    resolver: zodResolver(grantAccessInput),
    defaultValues: { email: "", permission: ProjectPermission.View },
  });

  const onGrant = handleSubmit((values) => {
    grantMutation.mutate(
      { id: projectId, email: values.email, permission },
      { onSuccess: () => reset({ email: "", permission }) },
    );
  });

  const onChangePermission = (entry: ProjectAccessEntry, next: ProjectPermission) => {
    grantMutation.mutate({ id: projectId, email: entry.email, permission: next });
  };

  const entries = accessQuery.data ?? [];

  return (
    <section className="mt-4">
      <form onSubmit={onGrant} className="flex flex-wrap items-start gap-2">
        <div className="flex flex-col gap-1">
          <input
            type="email"
            placeholder="user@example.com"
            {...register("email")}
            className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          {errors.email ? (
            <p className="text-xs text-red-600">{errors.email.message}</p>
          ) : null}
        </div>
        <select
          aria-label="permission"
          value={permission}
          onChange={(e) => setPermission(e.target.value as ProjectPermission)}
          className="rounded-lg border border-border px-2 py-2 text-sm"
        >
          <option value={ProjectPermission.View}>Viewer</option>
          <option value={ProjectPermission.Edit}>Editor</option>
        </select>
        <button
          type="submit"
          disabled={grantMutation.isPending}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Share
        </button>
      </form>

      {grantMutation.error ? (
        <p className="mt-2 text-sm text-red-600">{projectErrorMessage(grantMutation.error)}</p>
      ) : null}

      <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
        {entries.map((entry) => (
          <li key={entry.userId} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <span className="truncate text-foreground/80">{entry.email}</span>
            <div className="flex items-center gap-2">
              <select
                aria-label={`permission for ${entry.email}`}
                value={entry.permission}
                onChange={(e) =>
                  onChangePermission(entry, e.target.value as ProjectPermission)
                }
                className="rounded-lg border border-border px-2 py-1 text-sm"
              >
                <option value={ProjectPermission.View}>Viewer</option>
                <option value={ProjectPermission.Edit}>Editor</option>
              </select>
              <button
                type="button"
                onClick={() => revokeMutation.mutate({ id: projectId, userId: entry.userId })}
                className="font-medium text-red-600 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
        {entries.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted">Not shared with anyone yet.</li>
        ) : null}
      </ul>
    </section>
  );
}
