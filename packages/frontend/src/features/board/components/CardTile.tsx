import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card } from "shared";
import { ChecklistProgressBadge } from "./ChecklistProgressBadge";
import { LabelBadge } from "./LabelBadge";
import { DueDateBadge } from "./DueDateBadge";
import { CommentCountBadge } from "./CommentCountBadge";
import { AttachmentCountBadge } from "./AttachmentCountBadge";
import { AssigneeStack } from "./AssigneeStack";

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
      className={`rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm ${
        editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      }`}
    >
      {card.labels.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.labels.map((label) => (
            <LabelBadge key={label.id} label={label} compact />
          ))}
        </div>
      ) : null}
      {card.title}
      <DueDateBadge card={card} />
      <ChecklistProgressBadge progress={card.checklistProgress} />
      <CommentCountBadge count={card.commentCount} />
      <AttachmentCountBadge count={card.attachmentCount} />
      {card.assignees?.length ? (
        <div className="mt-1.5">
          <AssigneeStack assignees={card.assignees} />
        </div>
      ) : null}
    </div>
  );
}
