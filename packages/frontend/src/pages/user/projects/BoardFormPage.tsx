import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BOARD_DESCRIPTION_MAX,
  DEFAULT_BOARD_COLOR,
  createBoardInput,
  z,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import {
  BoardFormFields,
  type BoardFormValues,
} from "../../../features/board/components/BoardFormFields";
import { canEdit } from "../../../features/board/utils";
import { boardErrorMessage } from "../../../features/board/errors";

const formSchema = z.object({
  name: createBoardInput.shape.name,
  description: z.string().trim().max(BOARD_DESCRIPTION_MAX).optional(),
});

export function BoardFormPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id, boardId } = useParams<{ id: string; boardId: string }>();

  const [color, setColor] = useState(DEFAULT_BOARD_COLOR);

  const boardQuery = useQuery(trpc.boards.get.queryOptions({ id: boardId! }));

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BoardFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "" },
  });

  const board = boardQuery.data;
  const readOnly = !!board && !canEdit(board);

  useEffect(() => {
    if (board) {
      reset({ name: board.name, description: board.description ?? "" });
      setColor(board.color);
    }
  }, [board, reset]);

  const updateMutation = useMutation(
    trpc.boards.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.boards.list.queryKey({ projectId: id }) });
        queryClient.invalidateQueries({ queryKey: trpc.boards.get.queryKey({ id: boardId }) });
        navigate(`/projects/${id}/boards/${boardId}`);
      },
    }),
  );

  const onSubmit = handleSubmit((values) => {
    const description = values.description?.length ? values.description : undefined;
    updateMutation.mutate({
      id: boardId!,
      name: values.name,
      description: description ?? null,
      color,
    });
  });

  if (boardQuery.error) {
    return (
      <main className="max-w-2xl p-6">
        <p className="text-sm text-foreground/70">Board not found or no access.</p>
        <Link
          to={`/projects/${id}`}
          className="text-sm font-medium text-foreground/80 hover:text-foreground"
        >
          Back to project
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-bold text-foreground">
        {readOnly ? "Board" : "Edit board"}
      </h1>

      <form onSubmit={onSubmit} className="space-y-4">
        <BoardFormFields
          register={register}
          errors={errors}
          color={color}
          onColorChange={setColor}
          disabled={readOnly}
        />

        {updateMutation.error ? (
          <p className="text-sm text-red-600">{boardErrorMessage(updateMutation.error)}</p>
        ) : null}

        {!readOnly ? (
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save
            </button>
            <Link
              to={`/projects/${id}/boards/${boardId}`}
              className="rounded-lg px-4 py-2 text-sm font-medium text-foreground/70 hover:bg-surface-muted"
            >
              Cancel
            </Link>
          </div>
        ) : null}
      </form>
    </main>
  );
}
