import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BOARD_DESCRIPTION_MAX,
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
  board: { id: string; name: string; description: string | null; color: string };
  open: boolean;
  onClose: () => void;
}

export function EditBoardModal({ projectId, board, open, onClose }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.add);
  const [color, setColor] = useState(board.color);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BoardFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: board.name, description: board.description ?? "" },
  });

  // Reseed from the latest board each time the modal opens.
  useEffect(() => {
    if (open) {
      reset({ name: board.name, description: board.description ?? "" });
      setColor(board.color);
    }
  }, [open, board, reset]);

  const updateMutation = useMutation(
    trpc.boards.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.boards.getData.queryKey({ id: board.id }) });
        queryClient.invalidateQueries({ queryKey: trpc.boards.get.queryKey({ id: board.id }) });
        queryClient.invalidateQueries({ queryKey: trpc.boards.list.queryKey({ projectId }) });
        addToast("Board updated");
        onClose();
      },
    }),
  );

  const onSubmit = handleSubmit((values) => {
    const description = values.description?.length ? values.description : undefined;
    updateMutation.mutate({
      id: board.id,
      name: values.name,
      description: description ?? null,
      color,
    });
  });

  return (
    <Modal open={open} onClose={onClose} title="Edit board details" widthClassName="max-w-md">
      <form onSubmit={onSubmit} className="space-y-4">
        <BoardFormFields
          register={register}
          errors={errors}
          color={color}
          onColorChange={setColor}
        />

        {updateMutation.error ? (
          <p className="text-sm text-red-600">{boardErrorMessage(updateMutation.error)}</p>
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
            disabled={updateMutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}
