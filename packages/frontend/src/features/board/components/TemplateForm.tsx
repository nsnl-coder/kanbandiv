import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import {
  CARD_DESCRIPTION_MAX,
  CARD_TEMPLATE_NAME_MAX,
  CHECKLIST_ITEM_TEXT_MAX,
  CHECKLIST_TITLE_MAX,
  COVER_COLORS,
  type CardTemplatePayload,
  type CoverColor,
  type Label,
} from "shared";
import { useTRPC } from "../../../lib/trpc";
import { COVER_COLOR_CLASS } from "../coverColors";
import { LabelBadge } from "./LabelBadge";

interface DraftChecklist {
  title: string;
  items: string[];
}

interface Props {
  boardId: string;
  initialName?: string;
  initialPayload?: CardTemplatePayload;
  submitLabel?: string;
  onSubmit: (values: { name: string; payload: CardTemplatePayload }) => void;
  onCancel: () => void;
}

export function TemplateForm({
  boardId,
  initialName = "",
  initialPayload,
  submitLabel = "Save template",
  onSubmit,
  onCancel,
}: Props) {
  const trpc = useTRPC();
  const labelsQuery = useQuery(trpc.labels.list.queryOptions({ boardId }));
  const boardLabels: Label[] = labelsQuery.data ?? [];

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialPayload?.description ?? "");
  const [coverColor, setCoverColor] = useState<CoverColor | null>(
    initialPayload?.coverColor ?? null,
  );
  const [labelIds, setLabelIds] = useState<string[]>(initialPayload?.labelIds ?? []);
  const [checklists, setChecklists] = useState<DraftChecklist[]>(
    (initialPayload?.checklists ?? []).map((c) => ({ title: c.title, items: [...c.items] })),
  );

  const toggleLabel = (id: string) =>
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const addChecklist = () =>
    setChecklists((prev) => [...prev, { title: "", items: [""] }]);
  const removeChecklist = (idx: number) =>
    setChecklists((prev) => prev.filter((_, i) => i !== idx));
  const setChecklistTitle = (idx: number, title: string) =>
    setChecklists((prev) => prev.map((c, i) => (i === idx ? { ...c, title } : c)));
  const addItem = (idx: number) =>
    setChecklists((prev) => prev.map((c, i) => (i === idx ? { ...c, items: [...c.items, ""] } : c)));
  const setItem = (idx: number, itemIdx: number, text: string) =>
    setChecklists((prev) =>
      prev.map((c, i) =>
        i === idx ? { ...c, items: c.items.map((t, j) => (j === itemIdx ? text : t)) } : c,
      ),
    );
  const removeItem = (idx: number, itemIdx: number) =>
    setChecklists((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, items: c.items.filter((_, j) => j !== itemIdx) } : c)),
    );

  const trimmedName = name.trim();
  const valid = trimmedName.length >= 1 && trimmedName.length <= CARD_TEMPLATE_NAME_MAX;

  const submit = () => {
    if (!valid) return;
    // Drop empty checklist titles and empty item texts (BE rejects min(1)).
    const cleanChecklists = checklists
      .map((c) => ({
        title: c.title.trim(),
        items: c.items.map((t) => t.trim()).filter((t) => t.length > 0),
      }))
      .filter((c) => c.title.length > 0);
    const payload: CardTemplatePayload = {
      description: description.trim() ? description.trim() : null,
      coverColor,
      labelIds,
      checklists: cleanChecklists,
    };
    onSubmit({ name: trimmedName, payload });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="template-name" className="text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="template-name"
          aria-label="template name"
          value={name}
          maxLength={CARD_TEMPLATE_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="Template name"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        {!valid ? <p className="text-xs text-red-600">Name is required.</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="template-description" className="text-sm font-medium text-slate-700">
          Description
        </label>
        <textarea
          id="template-description"
          aria-label="template description"
          value={description}
          maxLength={CARD_DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Labels</span>
        <div className="flex flex-wrap gap-2">
          {boardLabels.length === 0 ? (
            <span className="text-sm text-slate-500">No labels on this board.</span>
          ) : null}
          {boardLabels.map((label) => {
            const active = labelIds.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                aria-label={`toggle label ${label.name || "label"}`}
                aria-pressed={active}
                onClick={() => toggleLabel(label.id)}
                className={`rounded ${active ? "ring-2 ring-indigo-500 ring-offset-1" : "opacity-60"}`}
              >
                <LabelBadge label={label} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Cover color</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="cover color none"
            aria-pressed={coverColor === null}
            onClick={() => setCoverColor(null)}
            className={`flex h-6 w-6 items-center justify-center rounded border border-slate-300 ${coverColor === null ? "ring-2 ring-indigo-500" : ""}`}
          >
            <X className="h-3 w-3 text-slate-400" />
          </button>
          {COVER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`cover color ${c}`}
              aria-pressed={coverColor === c}
              onClick={() => setCoverColor(c)}
              className={`h-6 w-6 rounded ${COVER_COLOR_CLASS[c]} ${coverColor === c ? "ring-2 ring-indigo-500 ring-offset-1" : ""}`}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Checklists</span>
          <button
            type="button"
            aria-label="add checklist"
            onClick={addChecklist}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
          >
            <Plus className="h-4 w-4" />
            Add checklist
          </button>
        </div>
        {checklists.map((cl, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 p-2">
            <div className="flex items-center gap-2">
              <input
                aria-label={`checklist ${idx + 1} title`}
                value={cl.title}
                maxLength={CHECKLIST_TITLE_MAX}
                onChange={(e) => setChecklistTitle(idx, e.target.value)}
                placeholder="Checklist title"
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                aria-label={`remove checklist ${idx + 1}`}
                onClick={() => removeChecklist(idx)}
                className="text-slate-300 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {cl.items.map((item, itemIdx) => (
                <li key={itemIdx} className="flex items-center gap-2">
                  <input
                    aria-label={`checklist ${idx + 1} item ${itemIdx + 1}`}
                    value={item}
                    maxLength={CHECKLIST_ITEM_TEXT_MAX}
                    onChange={(e) => setItem(idx, itemIdx, e.target.value)}
                    placeholder="Item"
                    className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    aria-label={`remove checklist ${idx + 1} item ${itemIdx + 1}`}
                    onClick={() => removeItem(idx, itemIdx)}
                    className="text-slate-300 hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              aria-label={`add item to checklist ${idx + 1}`}
              onClick={() => addItem(idx)}
              className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              <Plus className="h-3 w-3" />
              Add item
            </button>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={submit}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
