import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pencil, Archive, Plus, LayoutTemplate } from "lucide-react";
import { COLUMN_NAME_MAX, COLUMN_NAME_MIN, type Card, type Column as ColumnType } from "shared";
import { sortByPosition } from "../utils";
import { CardTile } from "./CardTile";
import { TemplatePicker } from "./TemplatePicker";

interface Props {
  column: ColumnType;
  boardId: string;
  editable: boolean;
  onRename: (name: string) => void;
  onArchive: () => void;
  onAddCard: (title: string) => void;
  onAddFromTemplate: (templateId: string) => void;
  onOpenCard: (card: Card) => void;
}

export function Column({
  column,
  boardId,
  editable,
  onRename,
  onArchive,
  onAddCard,
  onAddFromTemplate,
  onOpenCard,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [picking, setPicking] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: column.id,
    data: { type: "column" },
    disabled: !editable,
  });

  const style = { transform: CSS.Translate.toString(transform), transition };

  const cards = sortByPosition(column.cards);

  const submitRename = () => {
    const trimmed = name.trim();
    if (trimmed.length >= COLUMN_NAME_MIN && trimmed.length <= COLUMN_NAME_MAX) {
      onRename(trimmed);
    }
    setRenaming(false);
  };

  const submitAdd = () => {
    const trimmed = title.trim();
    if (trimmed) {
      onAddCard(trimmed);
      setTitle("");
    }
    setAdding(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex w-72 shrink-0 flex-col gap-2 rounded-2xl border border-slate-200/70 bg-white/55 p-3 shadow-[0_2px_10px_-4px_rgb(30_41_59/0.12)] backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <input
            autoFocus
            aria-label="column name"
            value={name}
            maxLength={COLUMN_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") {
                setName(column.name);
                setRenaming(false);
              }
            }}
            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
          />
        ) : (
          <h3
            {...(editable ? { ...attributes, ...listeners } : {})}
            className={`truncate font-semibold tracking-tight text-slate-800 ${editable ? "cursor-grab" : ""}`}
          >
            {column.name}
          </h3>
        )}
        {editable && !renaming ? (
          <div className="flex shrink-0 items-center gap-1 text-xs">
            <button
              type="button"
              aria-label={`rename ${column.name}`}
              onClick={() => {
                setName(column.name);
                setRenaming(true);
              }}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`archive ${column.name}`}
              onClick={onArchive}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {cards.map((card) => (
            <CardTile key={card.id} card={card} editable={editable} onOpen={onOpenCard} />
          ))}
        </div>
      </SortableContext>

      {editable ? (
        adding ? (
          <div className="flex flex-col gap-1">
            <input
              autoFocus
              aria-label="card title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={submitAdd}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
                if (e.key === "Escape") {
                  setTitle("");
                  setAdding(false);
                }
              }}
              placeholder="Card title"
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        ) : picking ? (
          <TemplatePicker
            boardId={boardId}
            onPick={(templateId) => {
              onAddFromTemplate(templateId);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex flex-1 items-center gap-1 rounded-lg px-2 py-1 text-left text-sm font-medium text-slate-500 hover:bg-slate-200"
            >
              <Plus className="h-4 w-4" />
              Add card
            </button>
            <button
              type="button"
              aria-label={`add card from template to ${column.name}`}
              title="From template"
              onClick={() => setPicking(true)}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200"
            >
              <LayoutTemplate className="h-4 w-4" />
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
