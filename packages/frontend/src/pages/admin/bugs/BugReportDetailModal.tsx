import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Permission,
  type BugReport,
  type BugSeverityValue,
  type BugStatusValue,
} from "shared";
import { Download, Image as ImageIcon, Trash2 } from "lucide-react";
import { useTRPC } from "../../../lib/trpc";
import { Modal } from "../../../components/Modal";
import { Can } from "../../../features/rbac/components/Can";
import { useToastStore } from "../../../hooks/useToastStore";
import {
  bugAttachmentErrorMessage,
  bugReportErrorMessage,
} from "../../../features/bug-report/errors";
import {
  formatBytes,
  SEVERITY_LABEL,
  STATUS_LABEL,
  severityList,
  statusList,
} from "../../../features/bug-report/utils";

interface Props {
  report: BugReport;
  open: boolean;
  onClose: () => void;
}

export function BugReportDetailModal({ report, open, onClose }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.add);

  const [status, setStatus] = useState<BugStatusValue>(report.status);
  const [severity, setSeverity] = useState<BugSeverityValue>(report.severity);
  const [resolution, setResolution] = useState(report.resolution ?? "");

  useEffect(() => {
    if (open) {
      setStatus(report.status);
      setSeverity(report.severity);
      setResolution(report.resolution ?? "");
    }
  }, [open, report]);

  const attachmentsKey = trpc.bugReports.listAttachments.queryKey({
    bugReportId: report.id,
  });
  const attachmentsQuery = useQuery(
    trpc.bugReports.listAttachments.queryOptions(
      { bugReportId: report.id },
      { enabled: open },
    ),
  );

  const removeAttachmentMutation = useMutation(
    trpc.bugReports.removeAttachment.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: attachmentsKey });
        addToast("Attachment deleted");
      },
      onError: (e) => addToast(bugAttachmentErrorMessage(e)),
    }),
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.bugReports.list.queryKey() });

  const updateMutation = useMutation(
    trpc.bugReports.update.mutationOptions({
      onSuccess: () => {
        invalidate();
        addToast("Bug report updated");
        onClose();
      },
    }),
  );

  const removeMutation = useMutation(
    trpc.bugReports.remove.mutationOptions({
      onSuccess: () => {
        invalidate();
        addToast("Bug report deleted");
        onClose();
      },
    }),
  );

  const onSave = () => {
    const nextResolution = resolution.trim() ? resolution : null;
    updateMutation.mutate({
      id: report.id,
      status,
      severity,
      resolution: nextResolution,
    });
  };

  const onDelete = () => {
    if (!window.confirm("Delete this bug report permanently?")) return;
    removeMutation.mutate({ id: report.id });
  };

  const error = updateMutation.error ?? removeMutation.error;

  return (
    <Modal open={open} onClose={onClose} title={report.title} widthClassName="max-w-lg">
      <div className="space-y-4 text-sm">
        <div>
          <span className="block text-xs font-medium uppercase tracking-wide text-muted">
            Description
          </span>
          <p className="mt-1 whitespace-pre-wrap text-foreground/80">{report.description}</p>
        </div>

        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Reporter</dt>
            <dd className="mt-0.5 break-all text-foreground/80">{report.reporterEmail ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Page URL</dt>
            <dd className="mt-0.5 break-all text-foreground/80">{report.pageUrl ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Created</dt>
            <dd className="mt-0.5 text-foreground/80">{report.createdAt.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Updated</dt>
            <dd className="mt-0.5 text-foreground/80">{report.updatedAt.toLocaleString()}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">User agent</dt>
            <dd className="mt-0.5 break-all text-foreground/80">{report.userAgent ?? "-"}</dd>
          </div>
        </dl>

        <div className="border-t border-border pt-4">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted">
            Attachments
          </span>
          {attachmentsQuery.isLoading ? (
            <p className="mt-1 text-foreground/60">Loading...</p>
          ) : attachmentsQuery.data && attachmentsQuery.data.length ? (
            <ul className="mt-2 space-y-1">
              {attachmentsQuery.data.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-2 py-1.5"
                >
                  {a.mimeType.startsWith("image/") ? (
                    <a
                      href={a.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 items-center gap-1.5 text-indigo-600 hover:underline"
                    >
                      <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{a.filename}</span>
                      <span className="shrink-0 text-muted">({formatBytes(a.sizeBytes)})</span>
                    </a>
                  ) : (
                    <a
                      href={a.downloadUrl}
                      className="flex min-w-0 items-center gap-1.5 text-indigo-600 hover:underline"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{a.filename}</span>
                      <span className="shrink-0 text-muted">({formatBytes(a.sizeBytes)})</span>
                    </a>
                  )}
                  <Can perm={Permission.AdminBugsManage}>
                    <button
                      type="button"
                      aria-label={`delete ${a.filename}`}
                      disabled={removeAttachmentMutation.isPending}
                      onClick={() => removeAttachmentMutation.mutate({ id: a.id })}
                      className="shrink-0 rounded p-1 text-muted hover:bg-surface hover:text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Can>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-foreground/60">None</p>
          )}
        </div>

        <Can
          perm={Permission.AdminBugsManage}
          fallback={
            <dl className="grid grid-cols-2 gap-3 border-t border-border pt-4">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">Status</dt>
                <dd className="mt-0.5 text-foreground/80">{STATUS_LABEL[report.status]}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">Severity</dt>
                <dd className="mt-0.5 text-foreground/80">{SEVERITY_LABEL[report.severity]}</dd>
              </div>
              {report.resolution ? (
                <div className="col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                    Resolution
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-foreground/80">
                    {report.resolution}
                  </dd>
                </div>
              ) : null}
            </dl>
          }
        >
          <div className="space-y-3 border-t border-border pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="bug-edit-status" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                  Status
                </label>
                <select
                  id="bug-edit-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as BugStatusValue)}
                  className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                >
                  {statusList.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="bug-edit-severity" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                  Severity
                </label>
                <select
                  id="bug-edit-severity"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as BugSeverityValue)}
                  className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                >
                  {severityList.map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="bug-edit-resolution" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                Resolution
              </label>
              <textarea
                id="bug-edit-resolution"
                rows={3}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-500"
              />
            </div>

            {error ? <p className="text-sm text-red-600">{bugReportErrorMessage(error)}</p> : null}

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onDelete}
                disabled={removeMutation.isPending}
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Delete
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-foreground/70 hover:bg-surface-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={updateMutation.isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Save changes
                </button>
              </div>
            </div>
          </div>
        </Can>
      </div>
    </Modal>
  );
}
