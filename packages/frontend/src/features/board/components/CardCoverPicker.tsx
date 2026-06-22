import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image, X } from "lucide-react";
import type { Attachment, BoardData, Card, CardCover, CoverColor } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { cardCoverErrorMessage } from "../cardCoverErrors";
import { COVER_COLOR_CLASS, coverColorList } from "../coverColors";
import { SectionHeading } from "./SectionHeading";

interface Props {
  boardId: string;
  cardId: string;
  cover: CardCover | null;
  attachments: Attachment[];
  editable: boolean;
}

export function CardCoverPicker({ boardId, cardId, cover, attachments, editable }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const dataKey = trpc.boards.getData.queryKey({ id: boardId });
  const patchCard = (next: CardCover | null) =>
    queryClient.setQueryData<BoardData>(dataKey, (prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((c) => ({
              ...c,
              cards: c.cards.map((cd) =>
                cd.id === cardId ? ({ ...cd, cover: next } as Card) : cd,
              ),
            })),
          }
        : prev,
    );

  const updateMutation = useMutation(trpc.cards.update.mutationOptions());

  const apply = (
    patch: { coverColor: CoverColor | null } | { coverAttachmentId: string },
    optimistic: CardCover | null,
  ) => {
    const snapshot = queryClient.getQueryData<BoardData>(dataKey);
    patchCard(optimistic);
    updateMutation.mutate(
      { id: cardId, ...patch },
      {
        onError: () => {
          if (snapshot) queryClient.setQueryData(dataKey, snapshot);
        },
      },
    );
  };

  const pickColor = (color: CoverColor) =>
    apply({ coverColor: color }, { type: "color", color });

  const pickImage = (att: Attachment) =>
    apply(
      { coverAttachmentId: att.id },
      { type: "image", attachmentId: att.id, downloadUrl: att.downloadUrl },
    );

  const removeCover = () => apply({ coverColor: null }, null);

  if (!editable) return null;

  const activeColor = cover?.type === "color" ? cover.color : null;
  const activeAttachmentId = cover?.type === "image" ? cover.attachmentId : null;

  return (
    <section className="mt-4">
      <SectionHeading icon={Image}>Cover</SectionHeading>
      {updateMutation.error ? (
        <p className="mt-1 text-xs text-red-600">{cardCoverErrorMessage(updateMutation.error)}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {coverColorList.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`cover color ${color}`}
            aria-pressed={activeColor === color}
            onClick={() => pickColor(color)}
            className={`h-7 w-7 rounded ${COVER_COLOR_CLASS[color]} ${
              activeColor === color ? "ring-2 ring-slate-800 ring-offset-1" : ""
            }`}
          />
        ))}
        {cover ? (
          <button
            type="button"
            aria-label="remove cover"
            onClick={removeCover}
            className="flex items-center gap-0.5 rounded px-1.5 py-1 text-xs font-medium text-muted hover:bg-surface-muted"
          >
            <X className="h-3.5 w-3.5" />
            Remove cover
          </button>
        ) : null}
      </div>

      {attachments.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((att) => (
            <button
              key={att.id}
              type="button"
              aria-label={`cover image ${att.filename}`}
              aria-pressed={activeAttachmentId === att.id}
              onClick={() => pickImage(att)}
              className={`h-12 w-16 overflow-hidden rounded ${
                activeAttachmentId === att.id ? "ring-2 ring-slate-800 ring-offset-1" : ""
              }`}
            >
              <img
                src={att.downloadUrl}
                alt={att.filename}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Upload an image attachment to use it as a cover.
        </p>
      )}
    </section>
  );
}
