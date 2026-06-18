import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card } from "shared";

interface Props {
  card: Card;
  editable: boolean;
  onOpen: (card: Card) => void;
}

export function CardTile({ card, editable, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, data: { type: "card", columnId: card.columnId }, disabled: !editable });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(editable ? listeners : {})}
      onClick={() => onOpen(card)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(card);
      }}
      className={`rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm ${
        editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      }`}
    >
      {card.title}
    </div>
  );
}
