import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_PROJECT_COLOR,
  PROJECT_DESCRIPTION_MAX,
  ProjectVisibility,
  createProjectInput,
  projectVisibilitySchema,
  z,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import {
  ProjectFormFields,
  type ProjectFormValues,
} from "../../../features/project/components/ProjectFormFields";
import { projectErrorMessage } from "../../../features/project/errors";

const formSchema = z.object({
  name: createProjectInput.shape.name,
  description: z.string().trim().max(PROJECT_DESCRIPTION_MAX).optional(),
  visibility: projectVisibilitySchema,
});

export function ProjectFormPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [color, setColor] = useState(DEFAULT_PROJECT_COLOR);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "", visibility: ProjectVisibility.Private },
  });

  const createMutation = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: (created) => {
        queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });
        navigate(`/projects/${created.id}`);
      },
    }),
  );

  const onSubmit = handleSubmit((values) => {
    const description = values.description?.length ? values.description : undefined;
    createMutation.mutate({
      name: values.name,
      description,
      color,
      visibility: values.visibility,
    });
  });

  return (
    <main className="max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-bold text-slate-800">New project</h1>

      <form onSubmit={onSubmit} className="space-y-4">
        <ProjectFormFields
          register={register}
          errors={errors}
          color={color}
          onColorChange={setColor}
        />

        {createMutation.error ? (
          <p className="text-sm text-red-600">{projectErrorMessage(createMutation.error)}</p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Create project
          </button>
          <Link
            to="/projects"
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
