import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { CHECKLIST_ITEM_TEXT_MAX, type ChecklistItem } from "shared";

interface Props {
  item: ChecklistItem;
  editable: boolean;
  onToggle: (isDone: boolean) => void;
  onRename: (text: string) => void;
  onDelete: () => void;
}

export function ChecklistItemRow({ item, editable, onToggle, onRename, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id, data: { type: "checklist-item" }, disabled: !editable });
  const [text, setText] = useState(item.text);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setText(item.text);
  }, [item.text]);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const commit = () => {
    const trimmed = text.trim();
    setEditing(false);
    if (trimmed && trimmed !== item.text) onRename(trimmed);
    else setText(item.text);
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 py-0.5">
      {editable ? (
        <button
          type="button"
          aria-label="reorder item"
          className="cursor-grab text-muted hover:text-muted active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      <input
        type="checkbox"
        checked={item.isDone}
        disabled={!editable}
        aria-label={`toggle ${item.text}`}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4 rounded border-border"
      />
      {editing && editable ? (
        <input
          aria-label="item text"
          value={text}
          autoFocus
          maxLength={CHECKLIST_ITEM_TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setText(item.text);
              setEditing(false);
            }
          }}
          className="flex-1 rounded border border-border px-2 py-0.5 text-sm outline-none focus:border-indigo-500"
        />
      ) : (
        <span
          onClick={() => editable && setEditing(true)}
          className={`flex-1 text-sm ${item.isDone ? "text-muted line-through" : "text-foreground/80"} ${editable ? "cursor-text" : ""}`}
        >
          {item.text}
        </span>
      )}
      {editable ? (
        <button
          type="button"
          aria-label={`delete ${item.text}`}
          onClick={onDelete}
          className="text-muted hover:text-red-500"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
