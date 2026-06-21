import { useEffect, useState } from "react";
import {
  CARD_DESCRIPTION_MAX,
  CARD_TITLE_MAX,
  CARD_TITLE_MIN,
  type Card,
} from "shared";
import { Modal } from "../../../components/Modal";
import { ChecklistSection } from "./ChecklistSection";
import { LabelPicker } from "./LabelPicker";
import { AssigneePicker } from "./AssigneePicker";
import { DueDatePicker } from "./DueDatePicker";
import { CommentList } from "./CommentList";
import { AttachmentList } from "./AttachmentList";
import type { MentionMember } from "../utils";

interface Props {
  card: Card;
  boardId: string;
  editable: boolean;
  isOwner: boolean;
  currentUserId: string;
  members: MentionMember[];
  error?: unknown;
  errorMessage?: (err: unknown) => string;
  onSave: (values: { title: string; description: string | null }) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function CardEditor({
  card,
  boardId,
  editable,
  isOwner,
  currentUserId,
  members,
  error,
  errorMessage,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");

  useEffect(() => {
    setTitle(card.title);
    setDescription(card.description ?? "");
  }, [card]);

  const trimmed = title.trim();
  const valid = trimmed.length >= CARD_TITLE_MIN && trimmed.length <= CARD_TITLE_MAX;

  const save = () => {
    if (!valid) return;
    onSave({ title: trimmed, description: description.trim() ? description.trim() : null });
  };

  return (
    <Modal open onClose={onClose} title={editable ? "Edit card" : "Card"} widthClassName="max-w-lg">
      <div>
        <div className="flex flex-col gap-1">
          <label htmlFor="card-title" className="text-sm font-medium text-slate-700">
            Title
          </label>
          <input
            id="card-title"
            value={title}
            disabled={!editable}
            maxLength={CARD_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-100"
          />
          {!valid ? (
            <p className="text-xs text-red-600">Title is required.</p>
          ) : null}
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor="card-description" className="text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            id="card-description"
            rows={4}
            value={description}
            disabled={!editable}
            maxLength={CARD_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-100"
          />
        </div>

        {error && errorMessage ? (
          <p className="mt-2 text-sm text-red-600">{errorMessage(error)}</p>
        ) : null}

        <LabelPicker
          boardId={boardId}
          cardId={card.id}
          labels={card.labels}
          editable={editable}
        />

        <AssigneePicker
          boardId={boardId}
          cardId={card.id}
          assignees={card.assignees}
          editable={editable}
        />

        <DueDatePicker boardId={boardId} card={card} editable={editable} />

        <ChecklistSection cardId={card.id} editable={editable} />

        <AttachmentList
          boardId={boardId}
          cardId={card.id}
          canEdit={editable}
          currentUserId={currentUserId}
          isOwner={isOwner}
        />

        <CommentList
          boardId={boardId}
          cardId={card.id}
          editable={editable}
          members={members}
          currentUserId={currentUserId}
          isOwner={isOwner}
        />

        <div className="mt-4 flex items-center justify-between gap-2">
          {editable ? (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              {editable ? "Cancel" : "Close"}
            </button>
            {editable ? (
              <button
                type="button"
                disabled={!valid}
                onClick={save}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Save
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
