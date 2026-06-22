import { type Kysely } from "kysely";
import { Permission } from "shared";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

export interface CreateBugReport {
  reporterId: string;
  title: string;
  description: string;
  severity: string;
  pageUrl?: string | null;
  userAgent?: string | null;
}

export function create(db: Db, input: CreateBugReport) {
  return db
    .insertInto("bug_reports")
    .values({
      reporter_id: input.reporterId,
      title: input.title,
      description: input.description,
      severity: input.severity,
      page_url: input.pageUrl ?? null,
      user_agent: input.userAgent ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

const SELECT_WITH_REPORTER = [
  "bug_reports.id as id",
  "bug_reports.reporter_id as reporter_id",
  "users.email as reporter_email",
  "bug_reports.title as title",
  "bug_reports.description as description",
  "bug_reports.severity as severity",
  "bug_reports.status as status",
  "bug_reports.page_url as page_url",
  "bug_reports.user_agent as user_agent",
  "bug_reports.resolution as resolution",
  "bug_reports.created_at as created_at",
  "bug_reports.updated_at as updated_at",
] as const;

export function listByReporter(
  db: Db,
  reporterId: string,
  limit: number,
  offset: number,
) {
  return db
    .selectFrom("bug_reports")
    .leftJoin("users", "users.id", "bug_reports.reporter_id")
    .select(SELECT_WITH_REPORTER)
    .where("bug_reports.reporter_id", "=", reporterId)
    .orderBy("bug_reports.created_at", "desc")
    .limit(limit)
    .offset(offset)
    .execute();
}

export function listAll(
  db: Db,
  opts: { status?: string; severity?: string; limit: number; offset: number },
) {
  let q = db
    .selectFrom("bug_reports")
    .leftJoin("users", "users.id", "bug_reports.reporter_id")
    .select(SELECT_WITH_REPORTER)
    .orderBy("bug_reports.created_at", "desc")
    .limit(opts.limit)
    .offset(opts.offset);
  if (opts.status) q = q.where("bug_reports.status", "=", opts.status);
  if (opts.severity) q = q.where("bug_reports.severity", "=", opts.severity);
  return q.execute();
}

export function findById(db: Db, id: string) {
  return db
    .selectFrom("bug_reports")
    .leftJoin("users", "users.id", "bug_reports.reporter_id")
    .select(SELECT_WITH_REPORTER)
    .where("bug_reports.id", "=", id)
    .executeTakeFirst();
}

export function update(
  db: Db,
  id: string,
  patch: { status?: string; severity?: string; resolution?: string | null },
) {
  return db
    .updateTable("bug_reports")
    .set({ ...patch, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export async function remove(db: Db, id: string): Promise<number> {
  const res = await db
    .deleteFrom("bug_reports")
    .where("id", "=", id)
    .executeTakeFirst();
  return Number(res.numDeletedRows);
}

export type BugReportAttachmentRow = {
  id: string;
  bug_report_id: string;
  uploader_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: string;
  storage_key: string;
  created_at: Date;
};

export function createAttachment(
  db: Db,
  row: {
    id: string;
    bugReportId: string;
    uploaderId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
  },
) {
  return db
    .insertInto("bug_report_attachments")
    .values({
      id: row.id,
      bug_report_id: row.bugReportId,
      uploader_id: row.uploaderId,
      filename: row.filename,
      mime_type: row.mimeType,
      size_bytes: row.sizeBytes,
      storage_key: row.storageKey,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findAttachmentById(db: Db, id: string) {
  return db
    .selectFrom("bug_report_attachments")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export function listAttachmentsByReport(db: Db, bugReportId: string) {
  return db
    .selectFrom("bug_report_attachments")
    .selectAll()
    .where("bug_report_id", "=", bugReportId)
    .orderBy("created_at", "asc")
    .execute();
}

export function deleteAttachmentById(db: Db, id: string) {
  return db.deleteFrom("bug_report_attachments").where("id", "=", id).execute();
}

// Recipients for the new-report nudge: superusers OR users whose role grants
// admin:bugs:read / admin:bugs:manage. DISTINCT ids only.
export async function listBugAdmins(db: Db): Promise<{ id: string }[]> {
  const rows = await db
    .selectFrom("users")
    .leftJoin("role_permissions", "role_permissions.role_id", "users.role_id")
    .select("users.id as id")
    .distinct()
    .where((eb) =>
      eb.or([
        eb("users.is_superuser", "=", true),
        eb("role_permissions.permission", "in", [
          Permission.AdminBugsRead,
          Permission.AdminBugsManage,
        ]),
      ]),
    )
    .execute();
  return rows;
}
