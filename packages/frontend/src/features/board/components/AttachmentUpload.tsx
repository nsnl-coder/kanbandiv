import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AttachmentError, type Attachment, type BoardData } from "shared";
import { useTRPC } from "../../../lib/trpc";
import { attachmentErrorMessage } from "../attachmentErrors";
import { isAllowedType, isWithinSize } from "../utils";
import { uploadAttachment } from "../uploadAttachment";
import { ATTACHMENT_ALLOWED_MIME } from "../types";

interface Props {
  boardId: string;
  cardId: string;
}

const ACCEPT = ATTACHMENT_ALLOWED_MIME.join(",");

export function AttachmentUpload({ boardId, cardId }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listKey = trpc.attachments.list.queryKey({ cardId });
  const dataKey = trpc.boards.getData.queryKey({ id: boardId });

  const bumpCount = (delta: number) =>
    queryClient.setQueryData<BoardData>(dataKey, (prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((c) => ({
              ...c,
              cards: c.cards.map((cd) =>
                cd.id === cardId
                  ? { ...cd, attachmentCount: Math.max(0, cd.attachmentCount + delta) }
                  : cd,
              ),
            })),
          }
        : prev,
    );

  const reset = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const onSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (!isWithinSize(file)) {
      setError(attachmentErrorMessage(AttachmentError.FILE_TOO_LARGE));
      reset();
      return;
    }
    if (!isAllowedType(file)) {
      setError(attachmentErrorMessage(AttachmentError.UNSUPPORTED_TYPE));
      reset();
      return;
    }

    const dataSnapshot = queryClient.getQueryData<BoardData>(dataKey);
    setProgress(0);
    bumpCount(1);
    try {
      const created = await uploadAttachment({ cardId, file, onProgress: setProgress });
      queryClient.setQueryData<Attachment[]>(listKey, (prev) =>
        prev ? [...prev, created] : prev,
      );
      await queryClient.invalidateQueries({ queryKey: listKey });
    } catch (code) {
      if (dataSnapshot) queryClient.setQueryData(dataKey, dataSnapshot);
      setError(attachmentErrorMessage(code));
    } finally {
      setProgress(null);
      reset();
    }
  };

  return (
    <div className="mt-2">
      <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Add attachment
        <input
          ref={inputRef}
          type="file"
          aria-label="upload attachment"
          accept={ACCEPT}
          className="hidden"
          onChange={onSelect}
        />
      </label>

      {progress !== null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-200">
          <div
            role="progressbar"
            aria-valuenow={progress}
            className="h-full bg-indigo-600 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
