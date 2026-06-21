import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PROJECT_DESCRIPTION_MAX,
  createProjectInput,
  projectVisibilitySchema,
  z,
  type Project,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import { Modal } from "../../../components/Modal";
import { useToastStore } from "../../../hooks/useToastStore";
import { ProjectFormFields, type ProjectFormValues } from "./ProjectFormFields";
import { canEdit, isOwner } from "../utils";
import { projectErrorMessage } from "../errors";

const formSchema = z.object({
  name: createProjectInput.shape.name,
  description: z.string().trim().max(PROJECT_DESCRIPTION_MAX).optional(),
  visibility: projectVisibilitySchema,
});

interface Props {
  project: Project;
  open: boolean;
  onClose: () => void;
}

export function EditProjectModal({ project, open, onClose }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.add);
  const [color, setColor] = useState(project.color);

  const readOnly = !canEdit(project);
  const visibilityDisabled = !isOwner(project);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: project.name,
      description: project.description ?? "",
      visibility: project.visibility,
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: project.name,
        description: project.description ?? "",
        visibility: project.visibility,
      });
      setColor(project.color);
    }
  }, [open, project, reset]);

  const updateMutation = useMutation(
    trpc.projects.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });
        queryClient.invalidateQueries({
          queryKey: trpc.projects.get.queryKey({ id: project.id }),
        });
        addToast("Project updated");
        onClose();
      },
    }),
  );

  const onSubmit = handleSubmit((values) => {
    const description = values.description?.length ? values.description : undefined;
    updateMutation.mutate({
      id: project.id,
      name: values.name,
      description: description ?? null,
      color,
      ...(isOwner(project) ? { visibility: values.visibility } : {}),
    });
  });

  return (
    <Modal open={open} onClose={onClose} title="Edit project" widthClassName="max-w-md">
      <form onSubmit={onSubmit} className="space-y-4">
        <ProjectFormFields
          register={register}
          errors={errors}
          color={color}
          onColorChange={setColor}
          disabled={readOnly}
          visibilityDisabled={visibilityDisabled}
        />

        {updateMutation.error ? (
          <p className="text-sm text-red-600">{projectErrorMessage(updateMutation.error)}</p>
        ) : null}

        {!readOnly ? (
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
              disabled={updateMutation.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
