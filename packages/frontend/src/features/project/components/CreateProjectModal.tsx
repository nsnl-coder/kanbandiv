import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
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
import { Modal } from "../../../components/Modal";
import { useToastStore } from "../../../hooks/useToastStore";
import { ProjectFormFields, type ProjectFormValues } from "./ProjectFormFields";
import { projectErrorMessage } from "../errors";

const formSchema = z.object({
  name: createProjectInput.shape.name,
  description: z.string().trim().max(PROJECT_DESCRIPTION_MAX).optional(),
  visibility: projectVisibilitySchema,
});

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateProjectModal({ open, onClose }: Props) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.add);
  const [color, setColor] = useState(DEFAULT_PROJECT_COLOR);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "", visibility: ProjectVisibility.Private },
  });

  useEffect(() => {
    if (open) {
      reset({ name: "", description: "", visibility: ProjectVisibility.Private });
      setColor(DEFAULT_PROJECT_COLOR);
    }
  }, [open, reset]);

  const createMutation = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: (created: { id: string }) => {
        queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });
        addToast("Project created");
        onClose();
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
    <Modal open={open} onClose={onClose} title="New project" widthClassName="max-w-md">
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

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-foreground/70 hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}
