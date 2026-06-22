import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { AttachmentError, submitBugReportInput, z, type BugSeverityValue } from "shared";
import { X } from "lucide-react";
import { useTRPC } from "../../../lib/trpc";
import { Modal } from "../../../components/Modal";
import { useToastStore } from "../../../hooks/useToastStore";
import { bugAttachmentErrorMessage, bugReportErrorMessage } from "../errors";
import {
  ATTACHMENT_ACCEPT,
  formatBytes,
  isAllowedType,
  isWithinSize,
  SEVERITY_LABEL,
  severityList,
} from "../utils";
import { uploadBugReportAttachment } from "../uploadBugReportAttachment";

const formSchema = z.object({
  title: submitBugReportInput.shape.title,
  description: submitBugReportInput.shape.description,
  severity: submitBugReportInput.shape.severity,
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ReportBugModal({ open, onClose }: Props) {
  const trpc = useTRPC();
  const location = useLocation();
  const addToast = useToastStore((s) => s.add);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", description: "", severity: "medium" },
  });

  useEffect(() => {
    if (open) {
      reset({ title: "", description: "", severity: "medium" });
      setFiles([]);
      setFileError(null);
    }
  }, [open, reset]);

  const submitMutation = useMutation(trpc.bugReports.submit.mutationOptions());

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const picked = Array.from(e.target.files ?? []);
    const valid: File[] = [];
    for (const f of picked) {
      if (!isWithinSize(f)) {
        setFileError(bugAttachmentErrorMessage(AttachmentError.FILE_TOO_LARGE));
        continue;
      }
      if (!isAllowedType(f)) {
        setFileError(bugAttachmentErrorMessage(AttachmentError.UNSUPPORTED_TYPE));
        continue;
      }
      valid.push(f);
    }
    setFiles((prev) => [...prev, ...valid]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const onSubmit = handleSubmit(async (values) => {
    let created;
    try {
      created = await submitMutation.mutateAsync({
        ...values,
        pageUrl: location.pathname + location.search,
      });
    } catch {
      return; // mutation error is rendered below
    }
    for (const file of files) {
      try {
        await uploadBugReportAttachment({ bugReportId: created.id, file });
      } catch (e) {
        addToast(bugAttachmentErrorMessage(e));
      }
    }
    addToast("Bug reported, thanks");
    reset();
    setFiles([]);
    onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title="Report a bug" widthClassName="max-w-md">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="bug-title" className="mb-1 block text-sm font-medium text-foreground">
            Title
          </label>
          <input
            id="bug-title"
            type="text"
            {...register("title")}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-500"
          />
          {errors.title ? (
            <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="bug-description" className="mb-1 block text-sm font-medium text-foreground">
            Description
          </label>
          <textarea
            id="bug-description"
            rows={5}
            {...register("description")}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-500"
          />
          {errors.description ? (
            <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="bug-severity" className="mb-1 block text-sm font-medium text-foreground">
            Severity
          </label>
          <select
            id="bug-severity"
            {...register("severity")}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            {severityList.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s as BugSeverityValue]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-foreground">
            Attachments <span className="text-muted">(optional)</span>
          </span>
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground/80 hover:bg-canvas">
            Add files
            <input
              ref={fileInputRef}
              type="file"
              multiple
              aria-label="attach files"
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={onPickFiles}
            />
          </label>
          {files.length ? (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-2 py-1 text-xs"
                >
                  <span className="truncate text-foreground/80">
                    {f.name} <span className="text-muted">({formatBytes(f.size)})</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`remove ${f.name}`}
                    onClick={() => removeFile(i)}
                    className="shrink-0 rounded p-0.5 text-muted hover:bg-surface hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {fileError ? <p className="mt-1 text-xs text-red-600">{fileError}</p> : null}
        </div>

        {submitMutation.error ? (
          <p className="text-sm text-red-600">
            {bugReportErrorMessage(submitMutation.error)}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-foreground/70 hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitMutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Submit report
          </button>
        </div>
      </form>
    </Modal>
  );
}
