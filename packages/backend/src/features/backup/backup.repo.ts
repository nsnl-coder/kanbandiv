import type { Kysely } from "kysely";
import type {
  BackupStatus,
  BackupTrigger,
  RetentionMode,
  ScheduleKind,
} from "shared";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

const SETTINGS_ID = 1;

export function getSettings(db: Db) {
  return db
    .selectFrom("backup_settings")
    .selectAll()
    .where("id", "=", SETTINGS_ID)
    .executeTakeFirst();
}

export interface SettingsPatch {
  enabled: boolean;
  schedule_kind: ScheduleKind;
  cron_expr: string | null;
  retention_mode: RetentionMode;
  retention_days: number | null;
  gfs_daily: number | null;
  gfs_weekly: number | null;
  gfs_monthly: number | null;
  include_minio: boolean;
  encryption_enabled: boolean;
  gdrive_folder_name: string | null;
}

export function updateSettings(db: Db, patch: SettingsPatch) {
  return db
    .updateTable("backup_settings")
    // Invalidate the cached folder id so a renamed folder is re-resolved.
    .set({ ...patch, gdrive_folder_id: null, updated_at: new Date() })
    .where("id", "=", SETTINGS_ID)
    .returningAll()
    .executeTakeFirst();
}

export function setDriveConnection(
  db: Db,
  v: { email: string; refreshToken: string; folderId: string | null },
) {
  return db
    .updateTable("backup_settings")
    .set({
      gdrive_email: v.email,
      gdrive_refresh_token: v.refreshToken,
      gdrive_folder_id: v.folderId,
      updated_at: new Date(),
    })
    .where("id", "=", SETTINGS_ID)
    .returningAll()
    .executeTakeFirst();
}

export function clearDriveConnection(db: Db) {
  return db
    .updateTable("backup_settings")
    .set({ gdrive_email: null, gdrive_refresh_token: null, updated_at: new Date() })
    .where("id", "=", SETTINGS_ID)
    .returningAll()
    .executeTakeFirst();
}

export function setFolderId(db: Db, id: string) {
  return db
    .updateTable("backup_settings")
    .set({ gdrive_folder_id: id })
    .where("id", "=", SETTINGS_ID)
    .execute();
}

export function setMaintenance(db: Db, on: boolean) {
  return db
    .updateTable("backup_settings")
    .set({ maintenance: on, updated_at: new Date() })
    .where("id", "=", SETTINGS_ID)
    .returningAll()
    .executeTakeFirst();
}

export function insertRun(
  db: Db,
  v: { trigger: BackupTrigger; file_name: string },
) {
  return db
    .insertInto("backup_runs")
    .values({ status: "running", trigger: v.trigger, file_name: v.file_name })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface FinishRunPatch {
  status: BackupStatus;
  file_name?: string;
  size_bytes?: number | null;
  drive_file_id?: string | null;
  checksum?: string | null;
  error?: string | null;
  expires_at?: Date | null;
}

export function finishRun(db: Db, id: string, patch: FinishRunPatch) {
  return db
    .updateTable("backup_runs")
    .set({ ...patch, finished_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();
}

export function findRun(db: Db, id: string) {
  return db
    .selectFrom("backup_runs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export function findRunning(db: Db) {
  return db
    .selectFrom("backup_runs")
    .selectAll()
    .where("status", "=", "running")
    .orderBy("started_at", "desc")
    .executeTakeFirst();
}

export interface ListFilter {
  status?: BackupStatus;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export function listRuns(db: Db, f: ListFilter) {
  let q = db.selectFrom("backup_runs").selectAll();
  if (f.status) q = q.where("status", "=", f.status);
  if (f.from) q = q.where("started_at", ">=", f.from);
  if (f.to) q = q.where("started_at", "<=", f.to);
  return q.orderBy("started_at", "desc").limit(f.limit).offset(f.offset).execute();
}

/** Successful runs with a drive file, newest first - used by retention. */
export function listSuccessfulRuns(db: Db) {
  return db
    .selectFrom("backup_runs")
    .selectAll()
    .where("status", "=", "success")
    .orderBy("started_at", "desc")
    .execute();
}

export function deleteRun(db: Db, id: string) {
  return db.deleteFrom("backup_runs").where("id", "=", id).execute();
}
