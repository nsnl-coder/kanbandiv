import crypto from "node:crypto";
import path from "node:path";
import { PassThrough } from "node:stream";
import { TRPCError } from "@trpc/server";
import {
  ATTACHMENT_ALLOWED_MIME,
  ATTACHMENT_FILENAME_MAX,
  ATTACHMENT_MAX_BYTES,
  AttachmentError,
  type BugReport,
  type BugReportAttachment,
  type BugReportPage,
  BugReportError,
  type BugSeverityValue,
  type BugStatusValue,
  hasPermission,
  type ListBugReportsInput,
  type ListMyBugReportsInput,
  NotificationType,
  Permission,
  type SubmitBugReportInput,
  type UpdateBugReportInput,
} from "shared";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";
import { bus } from "../realtime/realtime.bus.js";
import * as notification from "../notification/notification.recorder.js";
import { handleFromEmail } from "../notification/notification.recorder.js";
import { storage as defaultStorage } from "../attachment/attachment.storage.js";
import type { Storage } from "../attachment/attachment.storage.js";
import * as repo from "./bug-report.repo.js";
import type { BugReportAttachmentRow, Db } from "./bug-report.repo.js";

export interface CtxUser {
  id: string;
  email: string;
  isSuperuser: boolean;
  permissions: Set<Permission>;
}

interface BugReportRow {
  id: string;
  reporter_id: string | null;
  reporter_email: string | null;
  title: string;
  description: string;
  severity: string;
  status: string;
  page_url: string | null;
  user_agent: string | null;
  resolution: string | null;
  created_at: Date;
  updated_at: Date;
}

function toBugReport(r: BugReportRow): BugReport {
  return {
    id: r.id,
    reporterId: r.reporter_id,
    reporterEmail: r.reporter_email,
    title: r.title,
    description: r.description,
    severity: r.severity as BugSeverityValue,
    status: r.status as BugStatusValue,
    pageUrl: r.page_url,
    userAgent: r.user_agent,
    resolution: r.resolution,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function canReadAll(user: CtxUser): boolean {
  return user.isSuperuser || hasPermission(user.permissions, Permission.AdminBugsRead);
}

export async function submit(
  db: Db,
  user: CtxUser,
  input: SubmitBugReportInput,
  userAgent: string | null,
): Promise<BugReport> {
  const created = (await repo.create(db, {
    reporterId: user.id,
    title: input.title,
    description: input.description,
    severity: input.severity,
    pageUrl: input.pageUrl ?? null,
    userAgent,
  })) as BugReportRow;
  await notifyAdmins(db, created, user);
  return toBugReport({ ...created, reporter_email: user.email });
}

// Best-effort in-app nudge to every bug-admin except the reporter. A failure here
// (list query OR recorder) must never fail the submission.
async function notifyAdmins(
  db: Db,
  report: BugReportRow,
  reporter: CtxUser,
): Promise<void> {
  try {
    const admins = await repo.listBugAdmins(db);
    for (const a of admins) {
      if (a.id === reporter.id) continue;
      await notification.create(db, bus, {
        userId: a.id,
        type: NotificationType.BUG_REPORT_NEW,
        payload: {
          bugReportId: report.id,
          title: report.title,
          actorHandle: handleFromEmail(reporter.email),
          snippet: report.description.slice(0, 140),
        },
      });
    }
  } catch (err) {
    logger.error(
      { err, event: LogEvent.BugReportNotifyFailed, bugReportId: report.id },
      LogEvent.BugReportNotifyFailed,
    );
  }
}

export async function listMine(
  db: Db,
  user: CtxUser,
  { limit, offset }: ListMyBugReportsInput,
): Promise<BugReportPage> {
  const rows = (await repo.listByReporter(db, user.id, limit, offset)) as BugReportRow[];
  const items = rows.map(toBugReport);
  const nextOffset = items.length === limit ? offset + items.length : null;
  return { items, nextOffset };
}

export async function listAll(
  db: Db,
  _user: CtxUser,
  input: ListBugReportsInput,
): Promise<BugReportPage> {
  const rows = (await repo.listAll(db, {
    status: input.status,
    severity: input.severity,
    limit: input.limit,
    offset: input.offset,
  })) as BugReportRow[];
  const items = rows.map(toBugReport);
  const nextOffset = items.length === input.limit ? input.offset + items.length : null;
  return { items, nextOffset };
}

export async function get(
  db: Db,
  user: CtxUser,
  { id }: { id: string },
): Promise<BugReport> {
  const row = (await repo.findById(db, id)) as BugReportRow | undefined;
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: BugReportError.NOT_FOUND });
  }
  if (row.reporter_id !== user.id && !canReadAll(user)) {
    throw new TRPCError({ code: "NOT_FOUND", message: BugReportError.NOT_FOUND });
  }
  return toBugReport(row);
}

export async function update(
  db: Db,
  _user: CtxUser,
  input: UpdateBugReportInput,
): Promise<BugReport> {
  const patch: { status?: string; severity?: string; resolution?: string | null } = {};
  if (input.status !== undefined) patch.status = input.status;
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.resolution !== undefined) patch.resolution = input.resolution;
  if (Object.keys(patch).length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: BugReportError.NO_FIELDS });
  }
  const updated = await repo.update(db, input.id, patch);
  if (!updated) {
    throw new TRPCError({ code: "NOT_FOUND", message: BugReportError.NOT_FOUND });
  }
  const row = (await repo.findById(db, input.id)) as BugReportRow;
  return toBugReport(row);
}

export async function remove(
  db: Db,
  _user: CtxUser,
  { id }: { id: string },
): Promise<{ ok: true }> {
  const n = await repo.remove(db, id);
  if (n === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: BugReportError.NOT_FOUND });
  }
  // Best-effort: the rows cascade-delete with the report; remove the orphaned
  // storage objects too. A no-op when storage is disabled (tests / no MinIO).
  await defaultStorage
    .removePrefix(`bug-reports/${id}/`)
    .catch((err) => logger.error({ err, bugReportId: id }, "bug-report attachment cleanup failed"));
  return { ok: true };
}

// --- attachments ---

function attErr(code: AttachmentError, status: TRPCError["code"]): TRPCError {
  return new TRPCError({ code: status, message: code });
}

function toAttachment(row: BugReportAttachmentRow): BugReportAttachment {
  return {
    id: row.id,
    bugReportId: row.bug_report_id,
    uploaderId: row.uploader_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    downloadUrl: `/api/bug-report-attachments/${row.id}/download`,
  };
}

// Sanitized key: bug-reports/{reportId}/{uuid}{ext}. The raw filename never
// enters the key (no path traversal / NUL).
function buildStorageKey(bugReportId: string, id: string, filename: string): string {
  const raw = path.extname(filename).toLowerCase();
  const ext = /^\.[a-z0-9]+$/.test(raw) ? raw : "";
  return `bug-reports/${bugReportId}/${id}${ext}`;
}

// Load a report + enforce owner-or-admin access; NOT_FOUND with no existence leak.
async function loadReportFor(db: Db, user: CtxUser, bugReportId: string): Promise<void> {
  const row = (await repo.findById(db, bugReportId)) as BugReportRow | undefined;
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: BugReportError.NOT_FOUND });
  if (row.reporter_id !== user.id && !canReadAll(user)) {
    throw new TRPCError({ code: "NOT_FOUND", message: BugReportError.NOT_FOUND });
  }
}

export async function createAttachment(
  db: Db,
  storage: Storage,
  user: CtxUser,
  input: { bugReportId: string; filename: string; mimeType: string; stream: NodeJS.ReadableStream },
): Promise<BugReportAttachment> {
  if (!storage.isEnabled()) throw attErr(AttachmentError.STORAGE_UNAVAILABLE, "INTERNAL_SERVER_ERROR");
  await loadReportFor(db, user, input.bugReportId);
  if (input.filename.length > ATTACHMENT_FILENAME_MAX) {
    throw attErr(AttachmentError.FILENAME_TOO_LONG, "BAD_REQUEST");
  }
  if (!(ATTACHMENT_ALLOWED_MIME as readonly string[]).includes(input.mimeType)) {
    throw attErr(AttachmentError.UNSUPPORTED_TYPE, "BAD_REQUEST");
  }

  const id = crypto.randomUUID();
  const key = buildStorageKey(input.bugReportId, id, input.filename);

  // The DB size is the real streamed byte count, never a client-claimed length.
  let sizeBytes = 0;
  const counter = new PassThrough();
  input.stream.on("data", (chunk: Buffer) => {
    sizeBytes += chunk.length;
  });
  input.stream.pipe(counter);
  await storage.putObject(key, counter, undefined, input.mimeType);

  if (sizeBytes > ATTACHMENT_MAX_BYTES) {
    await storage.removeObject(key).catch((rmErr) => logger.error({ err: rmErr, key }, "oversize bug attachment cleanup failed"));
    throw attErr(AttachmentError.FILE_TOO_LARGE, "BAD_REQUEST");
  }

  try {
    const row = await repo.createAttachment(db, {
      id,
      bugReportId: input.bugReportId,
      uploaderId: user.id,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes,
      storageKey: key,
    });
    return toAttachment(row as BugReportAttachmentRow);
  } catch (e) {
    await storage.removeObject(key).catch((rmErr) => logger.error({ err: rmErr, key }, "orphan bug attachment cleanup failed"));
    throw e;
  }
}

export async function listAttachments(
  db: Db,
  user: CtxUser,
  { bugReportId }: { bugReportId: string },
): Promise<BugReportAttachment[]> {
  await loadReportFor(db, user, bugReportId);
  const rows = (await repo.listAttachmentsByReport(db, bugReportId)) as BugReportAttachmentRow[];
  return rows.map(toAttachment);
}

// Load an attachment + enforce read access on its parent report (download path).
export async function loadAttachmentFor(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<{ row: BugReportAttachmentRow }> {
  const row = (await repo.findAttachmentById(db, id)) as BugReportAttachmentRow | undefined;
  if (!row) throw attErr(AttachmentError.ATTACHMENT_NOT_FOUND, "NOT_FOUND");
  await loadReportFor(db, user, row.bug_report_id);
  return { row };
}

export async function deleteAttachment(
  db: Db,
  storage: Storage,
  user: CtxUser,
  { id }: { id: string },
): Promise<{ ok: true }> {
  const row = (await repo.findAttachmentById(db, id)) as BugReportAttachmentRow | undefined;
  if (!row) throw attErr(AttachmentError.ATTACHMENT_NOT_FOUND, "NOT_FOUND");
  const canManage = user.isSuperuser || hasPermission(user.permissions, Permission.AdminBugsManage);
  if (row.uploader_id !== user.id && !canManage) {
    throw attErr(AttachmentError.FORBIDDEN, "FORBIDDEN");
  }
  await storage
    .removeObject(row.storage_key)
    .catch((rmErr) => logger.error({ err: rmErr, key: row.storage_key }, "bug attachment object remove failed"));
  await repo.deleteAttachmentById(db, id);
  return { ok: true };
}
