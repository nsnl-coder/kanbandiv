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
import { Nav } from "../../../components/Nav";
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
  const isEdit = Boolean(boardId);

  const [color, setColor] = useState(DEFAULT_BOARD_COLOR);

  const boardQuery = useQuery({
    ...trpc.boards.get.queryOptions({ id: boardId! }),
    enabled: isEdit,
  });

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
  const readOnly = isEdit && !!board && !canEdit(board);

  useEffect(() => {
    if (board) {
      reset({ name: board.name, description: board.description ?? "" });
      setColor(board.color);
    }
  }, [board, reset]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.boards.list.queryKey({ projectId: id }) });
    if (boardId) {
      queryClient.invalidateQueries({ queryKey: trpc.boards.get.queryKey({ id: boardId }) });
    }
  };

  const createMutation = useMutation(
    trpc.boards.create.mutationOptions({
      onSuccess: (created: { id: string }) => {
        invalidate();
        navigate(`/projects/${id}/boards/${created.id}`);
      },
    }),
  );

  const updateMutation = useMutation(
    trpc.boards.update.mutationOptions({
      onSuccess: () => {
        invalidate();
        navigate(`/projects/${id}/boards/${boardId}`);
      },
    }),
  );

  const onSubmit = handleSubmit((values) => {
    const description = values.description?.length ? values.description : undefined;
    if (isEdit) {
      updateMutation.mutate({
        id: boardId!,
        name: values.name,
        description: description ?? null,
        color,
      });
    } else {
      createMutation.mutate({
        projectId: id!,
        name: values.name,
        description,
        color,
      });
    }
  });

  const error = createMutation.error ?? updateMutation.error;

  if (isEdit && boardQuery.error) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Nav />
        <main className="mx-auto max-w-2xl p-6">
          <p className="text-sm text-slate-600">Board not found or no access.</p>
          <Link
            to={`/projects/${id}`}
            className="text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            Back to project
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-4 text-2xl font-bold text-slate-800">
          {isEdit ? (readOnly ? "Board" : "Edit board") : "New board"}
        </h1>

        <form onSubmit={onSubmit} className="space-y-4">
          <BoardFormFields
            register={register}
            errors={errors}
            color={color}
            onColorChange={setColor}
            disabled={readOnly}
          />

          {error ? <p className="text-sm text-red-600">{boardErrorMessage(error)}</p> : null}

          {!readOnly ? (
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {isEdit ? "Save" : "Create board"}
              </button>
              <Link
                to={isEdit ? `/projects/${id}/boards/${boardId}` : `/projects/${id}`}
                className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </Link>
            </div>
          ) : null}
        </form>
      </main>
    </div>
  );
}
