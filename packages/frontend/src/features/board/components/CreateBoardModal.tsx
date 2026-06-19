import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BOARD_DESCRIPTION_MAX,
  DEFAULT_BOARD_COLOR,
  createBoardInput,
  z,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import { Modal } from "../../../components/Modal";
import { useToastStore } from "../../../hooks/useToastStore";
import { BoardFormFields, type BoardFormValues } from "./BoardFormFields";
import { boardErrorMessage } from "../errors";

const formSchema = z.object({
  name: createBoardInput.shape.name,
  description: z.string().trim().max(BOARD_DESCRIPTION_MAX).optional(),
});

interface Props {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export function CreateBoardModal({ projectId, open, onClose }: Props) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.add);
  const [color, setColor] = useState(DEFAULT_BOARD_COLOR);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BoardFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "" },
  });

  useEffect(() => {
    if (open) {
      reset({ name: "", description: "" });
      setColor(DEFAULT_BOARD_COLOR);
    }
  }, [open, reset]);

  const createMutation = useMutation(
    trpc.boards.create.mutationOptions({
      onSuccess: (created: { id: string }) => {
        queryClient.invalidateQueries({
          queryKey: trpc.boards.list.queryKey({ projectId }),
        });
        addToast("Board created");
        onClose();
        navigate(`/projects/${projectId}/boards/${created.id}`);
      },
    }),
  );

  const onSubmit = handleSubmit((values) => {
    const description = values.description?.length ? values.description : undefined;
    createMutation.mutate({ projectId, name: values.name, description, color });
  });

  return (
    <Modal open={open} onClose={onClose} title="New board" widthClassName="max-w-md">
      <form onSubmit={onSubmit} className="space-y-4">
        <BoardFormFields
          register={register}
          errors={errors}
          color={color}
          onColorChange={setColor}
        />

        {createMutation.error ? (
          <p className="text-sm text-red-600">{boardErrorMessage(createMutation.error)}</p>
        ) : null}

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
            disabled={createMutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Create board
          </button>
        </div>
      </form>
    </Modal>
  );
}
