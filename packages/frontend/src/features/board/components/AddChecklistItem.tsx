import { useState } from "react";
import { Plus } from "lucide-react";
import { CHECKLIST_ITEM_TEXT_MAX } from "shared";

interface Props {
  onAdd: (text: string) => void;
}

export function AddChecklistItem({ onAdd }: Props) {
  const [text, setText] = useState("");

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setText("");
  };

  return (
    <div className="mt-1 flex items-center gap-2">
      <Plus className="h-4 w-4 text-muted" />
      <input
        aria-label="add item"
        value={text}
        placeholder="Add an item"
        maxLength={CHECKLIST_ITEM_TEXT_MAX}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        className="flex-1 rounded border border-border px-2 py-1 text-sm outline-none focus:border-indigo-500"
      />
    </div>
  );
}
