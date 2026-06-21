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
import { SlidersHorizontal, Users, Check } from "lucide-react";
import { useTRPC } from "../../../lib/trpc";
import { Modal } from "../../../components/Modal";
import { useToastStore } from "../../../hooks/useToastStore";
import { ProjectFormFields, type ProjectFormValues } from "./ProjectFormFields";
import { AccessPanel } from "./AccessPanel";
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

type Tab = "details" | "access";

// Project settings + member access in one modal. Owners get both tabs; editors
// see details only.
export function ProjectSettingsModal({ project, open, onClose }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.add);
  const [color, setColor] = useState(project.color);
  const [tab, setTab] = useState<Tab>("details");

  const readOnly = !canEdit(project);
  const owner = isOwner(project);

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
      setTab("details");
    }
  }, [open, project, reset]);

  const updateMutation = useMutation(
    trpc.projects.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.projects.get.queryKey({ id: project.id }) });
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
      ...(owner ? { visibility: values.visibility } : {}),
    });
  });

  const tabClass = (active: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <Modal open={open} onClose={onClose} title="Project settings" widthClassName="max-w-lg">
      {owner ? (
        <div className="mb-4 flex items-center gap-1 rounded-xl border border-slate-200 p-1">
          <button type="button" onClick={() => setTab("details")} className={tabClass(tab === "details")}>
            <SlidersHorizontal className="h-4 w-4" />
            Details
          </button>
          <button type="button" onClick={() => setTab("access")} className={tabClass(tab === "access")}>
            <Users className="h-4 w-4" />
            Access
          </button>
        </div>
      ) : null}

      {tab === "details" ? (
        <form onSubmit={onSubmit} className="space-y-4">
          <ProjectFormFields
            register={register}
            errors={errors}
            color={color}
            onColorChange={setColor}
            disabled={readOnly}
            visibilityDisabled={!owner}
          />

          {updateMutation.error ? (
            <p className="text-sm text-red-600">{projectErrorMessage(updateMutation.error)}</p>
          ) : null}

          {!readOnly ? (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                Save
              </button>
            </div>
          ) : null}
        </form>
      ) : (
        <AccessPanel projectId={project.id} />
      )}
    </Modal>
  );
}
