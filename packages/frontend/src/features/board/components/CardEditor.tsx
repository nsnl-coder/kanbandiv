import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CARD_TITLE_MAX,
  CARD_TITLE_MIN,
  type Card,
  type CardTemplatePayload,
} from "shared";
import { Modal } from "../../../components/Modal";
import { useTRPC } from "../../../lib/trpc";
import { cardToTemplatePayload } from "../cardTemplateUtils";
import { TemplateForm } from "./TemplateForm";
import { ChecklistSection } from "./ChecklistSection";
import { LabelPicker } from "./LabelPicker";
import { AssigneePicker } from "./AssigneePicker";
import { DueDatePicker } from "./DueDatePicker";
import { CommentList } from "./CommentList";
import { CardActivity } from "./CardActivity";
import { AttachmentList } from "./AttachmentList";
import { CardCoverBanner } from "./CardCoverBanner";
import { CardCoverPicker } from "./CardCoverPicker";
import { DescriptionEditor } from "./DescriptionEditor";
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
  onArchive: () => void;
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
  onArchive,
  onClose,
}: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const checklistsQuery = useQuery(trpc.checklists.listByCard.queryOptions({ cardId: card.id }));
  const createTemplateMutation = useMutation(
    trpc.cardTemplates.create.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.cardTemplates.list.queryKey({ boardId }),
        }),
    }),
  );

  const templatePrefill: CardTemplatePayload = cardToTemplatePayload(
    card,
    checklistsQuery.data ?? [],
  );

  const attachmentsQuery = useQuery(trpc.attachments.list.queryOptions({ cardId: card.id }));
  const imageAttachments = (attachmentsQuery.data ?? []).filter((a) =>
    a.mimeType.startsWith("image/"),
  );

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
        <CardCoverBanner cover={card.cover} />
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
          <DescriptionEditor
            value={description}
            onChange={setDescription}
            editable={editable}
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

        <CardCoverPicker
          boardId={boardId}
          cardId={card.id}
          cover={card.cover}
          attachments={imageAttachments}
          editable={editable}
        />

        <CommentList
          boardId={boardId}
          cardId={card.id}
          editable={editable}
          members={members}
          currentUserId={currentUserId}
          isOwner={isOwner}
        />

        <CardActivity cardId={card.id} />

        <div className="mt-4 flex items-center justify-between gap-2">
          {editable ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onArchive}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Archive
              </button>
              <button
                type="button"
                onClick={() => setSavingTemplate(true)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Save as template
              </button>
            </div>
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

      {editable && savingTemplate ? (
        <Modal
          open
          onClose={() => setSavingTemplate(false)}
          title="Save as template"
          widthClassName="max-w-lg"
        >
          <TemplateForm
            boardId={boardId}
            initialName={card.title}
            initialPayload={templatePrefill}
            submitLabel="Create template"
            onSubmit={(values) => {
              createTemplateMutation.mutate({ boardId, ...values });
              setSavingTemplate(false);
            }}
            onCancel={() => setSavingTemplate(false)}
          />
        </Modal>
      ) : null}
    </Modal>
  );
}
