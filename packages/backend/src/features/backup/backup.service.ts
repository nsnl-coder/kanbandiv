import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { Cron } from "croner";
import {
  BackupError,
  type BackupRun,
  type BackupSettings,
  type BackupStatusResult,
  type ListBackupRunsInput,
  type UpdateBackupSettingsInput,
} from "shared";
import { env } from "../../config/env.config.js";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";
import * as gdrive from "./backup.gdrive.js";
import * as job from "./backup.job.js";
import { setMaintenanceCache } from "./backup.maintenance.js";
import * as repo from "./backup.repo.js";
import type { Db } from "./backup.repo.js";

// --- refresh-token encryption at rest (AES-256-GCM) ---
function tokenKey(): Buffer {
  const secret = env.BACKUP_TOKEN_SECRET || env.JWT_REFRESH_SECRET;
  return scryptSync(secret, "backup-token-v1", 32);
}

function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

function decryptToken(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(":");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// --- row mappers ---
type SettingsRow = Awaited<ReturnType<typeof repo.getSettings>>;
type RunRow = Awaited<ReturnType<typeof repo.findRun>>;

function settingsNotFound() {
  return new TRPCError({ code: "NOT_FOUND", message: BackupError.SETTINGS_NOT_FOUND });
}

function toSettings(row: NonNullable<SettingsRow>): BackupSettings {
  return {
    enabled: row.enabled,
    scheduleKind: row.schedule_kind,
    cronExpr: row.cron_expr,
    retentionMode: row.retention_mode,
    retentionDays: row.retention_days,
    gfsDaily: row.gfs_daily,
    gfsWeekly: row.gfs_weekly,
    gfsMonthly: row.gfs_monthly,
    includeMinio: row.include_minio,
    encryptionEnabled: row.encryption_enabled,
    gdriveFolderName: row.gdrive_folder_name ?? defaultFolderName(),
    gdriveFolderId: row.gdrive_folder_id,
    maintenance: row.maintenance,
    drive: { connected: !!row.gdrive_refresh_token, email: row.gdrive_email },
    updatedAt: row.updated_at,
  };
}

function toRun(row: NonNullable<RunRow>): BackupRun {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    trigger: row.trigger,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    driveFileId: row.drive_file_id,
    fileName: row.file_name,
    checksum: row.checksum,
    error: row.error,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

async function loadSettingsRow(db: Db): Promise<NonNullable<SettingsRow>> {
  const row = await repo.getSettings(db);
  if (!row) throw settingsNotFound();
  return row;
}

// VPS timezone for human-friendly daily/weekly/monthly schedules.
export const BACKUP_TZ = "Asia/Ho_Chi_Minh";

/** Resolve a settings row to a cron expression (null = no schedule). */
export function cronExprFor(row: NonNullable<SettingsRow>): string | null {
  switch (row.schedule_kind) {
    case "daily":
      return "0 3 * * *"; // 03:00 every day
    case "weekly":
      return "0 3 * * 1"; // 03:00 Monday
    case "monthly":
      return "0 3 1 * *"; // 03:00 on the 1st
    case "cron":
      return row.cron_expr;
    default:
      return null;
  }
}

/** Next scheduled run times within `withinDays` (empty if disabled/no schedule). */
export async function getUpcoming(
  db: Db,
  withinDays = 7,
): Promise<{ runs: Date[] }> {
  const row = await loadSettingsRow(db);
  if (!row.enabled) return { runs: [] };
  const expr = cronExprFor(row);
  if (!expr) return { runs: [] };
  try {
    const cron = new Cron(expr, { timezone: BACKUP_TZ });
    const horizon = Date.now() + withinDays * 86_400_000;
    const next = cron.nextRuns(50);
    return { runs: next.filter((d) => d.getTime() <= horizon) };
  } catch {
    return { runs: [] };
  }
}

// Per-env default so local/dev/prod back up into separate Drive folders.
function defaultFolderName(): string {
  return `Trello Clone Backups (${env.VPS_ENV})`;
}

function folderNameFor(row: NonNullable<SettingsRow>): string {
  return row.gdrive_folder_name?.trim() || defaultFolderName();
}

// Resolve the upload target folder id: explicit env override > cached id >
// find-or-create by name (then cache it). Returns null only on failure (root).
async function resolveFolderId(
  db: Db,
  refreshToken: string,
  row: NonNullable<SettingsRow>,
): Promise<string | null> {
  if (env.GDRIVE_FOLDER_ID) return env.GDRIVE_FOLDER_ID;
  if (row.gdrive_folder_id) return row.gdrive_folder_id;
  const id = await gdrive.ensureBackupFolder(refreshToken, folderNameFor(row));
  if (id) await repo.setFolderId(db, id);
  return id || null;
}

// --- reschedule indirection (scheduler registers here; avoids circular import) ---
let rescheduleHook: ((db: Db) => void) | null = null;
export function onReschedule(fn: (db: Db) => void): void {
  rescheduleHook = fn;
}

// --- settings ---
export async function getSettings(db: Db): Promise<BackupSettings> {
  return toSettings(await loadSettingsRow(db));
}

export async function updateSettings(
  db: Db,
  input: UpdateBackupSettingsInput,
): Promise<BackupSettings> {
  if (input.scheduleKind === "cron" && input.cronExpr) {
    try {
      new Cron(input.cronExpr, { paused: true }).stop();
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: BackupError.INVALID_CRON });
    }
  }
  const simple = input.retentionMode === "simple";
  const updated = await repo.updateSettings(db, {
    enabled: input.enabled,
    schedule_kind: input.scheduleKind,
    cron_expr: input.scheduleKind === "cron" ? (input.cronExpr ?? null) : null,
    retention_mode: input.retentionMode,
    retention_days: simple ? (input.retentionDays ?? null) : null,
    gfs_daily: simple ? null : (input.gfsDaily ?? null),
    gfs_weekly: simple ? null : (input.gfsWeekly ?? null),
    gfs_monthly: simple ? null : (input.gfsMonthly ?? null),
    include_minio: input.includeMinio,
    encryption_enabled: input.encryptionEnabled,
    gdrive_folder_name: input.gdriveFolderName ?? null,
  });
  if (!updated) throw settingsNotFound();
  rescheduleHook?.(db);
  return toSettings(updated);
}

// --- OAuth state: HMAC-signed {uid, exp}, binds the callback to the admin who
// started the flow (SameSite=strict cookies aren't sent on Google's redirect). ---
function stateSecret(): string {
  return env.BACKUP_TOKEN_SECRET || env.JWT_REFRESH_SECRET;
}

function sign(payload: string): string {
  return createHmac("sha256", stateSecret()).update(payload).digest("base64url");
}

export function createOAuthState(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + 10 * 60_000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyOAuthState(state: string): string | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof uid !== "string" || typeof exp !== "number" || Date.now() > exp) {
      return null;
    }
    return uid;
  } catch {
    return null;
  }
}

// --- Google Drive connection ---
export function authUrl(userId: string): { url: string } {
  return { url: gdrive.buildAuthUrl(createOAuthState(userId)) };
}

export async function connectDrive(db: Db, code: string): Promise<void> {
  const { refreshToken, email } = await gdrive.exchangeCode(code);
  const row = await loadSettingsRow(db);
  await repo.setDriveConnection(db, {
    email,
    refreshToken: encryptToken(refreshToken),
    folderId: null,
  });
  // Create the named folder now so it shows up immediately; ignore failures
  // (the next backup will retry and fall back to Drive root if needed).
  try {
    await resolveFolderId(db, refreshToken, row);
  } catch (err) {
    logger.warn({ err }, "could not pre-create backup folder");
  }
  logger.info({ event: LogEvent.BackupDriveConnected, email }, "drive connected");
}

export async function disconnectDrive(db: Db): Promise<{ ok: true }> {
  const row = await loadSettingsRow(db);
  if (row.gdrive_refresh_token) {
    try {
      await gdrive.revokeToken(decryptToken(row.gdrive_refresh_token));
    } catch (err) {
      // Revoke failures shouldn't block clearing our copy of the token.
      logger.warn({ err }, "drive token revoke failed");
    }
  }
  await repo.clearDriveConnection(db);
  logger.info({ event: LogEvent.BackupDriveDisconnected }, "drive disconnected");
  return { ok: true };
}

// --- backup run ---
function expiryFor(row: NonNullable<SettingsRow>, startedAt: Date): Date | null {
  if (row.retention_mode === "simple" && row.retention_days) {
    return new Date(startedAt.getTime() + row.retention_days * 86_400_000);
  }
  return null;
}

/**
 * Run a backup. Manual triggers throw ALREADY_RUNNING when one is in flight;
 * scheduled triggers silently skip. Returns the finished run (or null if skipped).
 */
export async function runBackup(
  db: Db,
  trigger: "manual" | "scheduled",
): Promise<BackupRun | null> {
  const running = await repo.findRunning(db);
  if (running) {
    if (trigger === "manual") {
      throw new TRPCError({ code: "CONFLICT", message: BackupError.ALREADY_RUNNING });
    }
    return null;
  }

  const settings = await loadSettingsRow(db);
  if (!settings.gdrive_refresh_token) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: BackupError.DRIVE_NOT_CONNECTED,
    });
  }

  const startedAt = new Date();
  const provisional = `backup-${startedAt.toISOString().replace(/[:.]/g, "-")}.tar.gz`;
  const run = await repo.insertRun(db, { trigger, file_name: provisional });
  logger.info({ event: LogEvent.BackupStarted, runId: run.id, trigger }, "backup started");

  try {
    const archive = await job.createArchive({
      includeMinio: settings.include_minio,
      encrypt: settings.encryption_enabled,
    });
    try {
      const token = decryptToken(settings.gdrive_refresh_token);
      const folderId = await resolveFolderId(db, token, settings);
      const uploaded = await gdrive.uploadFile(token, {
        filePath: archive.filePath,
        name: archive.fileName,
        folderId,
      });
      const finished = await repo.finishRun(db, run.id, {
        status: "success",
        file_name: archive.fileName,
        size_bytes: archive.sizeBytes,
        drive_file_id: uploaded.id,
        checksum: archive.checksum,
        expires_at: expiryFor(settings, startedAt),
      });
      logger.info(
        { event: LogEvent.BackupSucceeded, runId: run.id, sizeBytes: archive.sizeBytes },
        "backup succeeded",
      );
      await runRetention(db).catch((err) =>
        logger.error({ err, event: LogEvent.BackupRetentionPruned }, "retention failed"),
      );
      return finished ? toRun(finished) : null;
    } finally {
      await archive.cleanup();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repo.finishRun(db, run.id, { status: "failed", error: message });
    logger.error({ event: LogEvent.BackupFailed, runId: run.id, err }, "backup failed");
    if (trigger === "manual") {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }
    return null;
  }
}

// --- retention ---
function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

/** Compute which successful-run ids to keep under a GFS policy. */
export function gfsKeepIds(
  runs: { id: string; started_at: Date }[],
  counts: { daily: number; weekly: number; monthly: number },
): Set<string> {
  const keep = new Set<string>();
  const sorted = [...runs].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
  // Keep the newest run in each of the most-recent `limit` distinct buckets.
  const pick = (key: (d: Date) => string, limit: number) => {
    if (limit <= 0) return;
    const seen = new Set<string>();
    for (const r of sorted) {
      const k = key(new Date(r.started_at));
      if (seen.has(k)) continue;
      seen.add(k);
      keep.add(r.id);
      if (seen.size >= limit) break;
    }
  };
  const byDay = (d: Date) => d.toISOString().slice(0, 10);
  const byMonth = (d: Date) => d.toISOString().slice(0, 7);
  pick(byDay, counts.daily);
  pick(isoWeek, counts.weekly);
  pick(byMonth, counts.monthly);
  return keep;
}

export async function runRetention(db: Db): Promise<number> {
  const settings = await loadSettingsRow(db);
  const runs = await repo.listSuccessfulRuns(db);
  let toDelete: typeof runs = [];

  if (settings.retention_mode === "simple" && settings.retention_days) {
    const cutoff = Date.now() - settings.retention_days * 86_400_000;
    toDelete = runs.filter((r) => new Date(r.started_at).getTime() < cutoff);
  } else if (settings.retention_mode === "gfs") {
    const keep = gfsKeepIds(
      runs.map((r) => ({ id: r.id, started_at: new Date(r.started_at) })),
      {
        daily: settings.gfs_daily ?? 0,
        weekly: settings.gfs_weekly ?? 0,
        monthly: settings.gfs_monthly ?? 0,
      },
    );
    toDelete = runs.filter((r) => !keep.has(r.id));
  }

  const token = settings.gdrive_refresh_token
    ? decryptToken(settings.gdrive_refresh_token)
    : null;
  let deleted = 0;
  for (const r of toDelete) {
    if (r.drive_file_id && token) {
      try {
        await gdrive.deleteFile(token, r.drive_file_id);
      } catch (err) {
        logger.warn({ err, runId: r.id }, "drive delete failed during retention");
      }
    }
    await repo.deleteRun(db, r.id);
    deleted++;
  }
  if (deleted > 0) {
    logger.info({ event: LogEvent.BackupRetentionPruned, deleted }, "retention pruned");
  }
  return deleted;
}

// --- delete a single backup ---
export async function deleteBackup(db: Db, runId: string): Promise<{ ok: true }> {
  const run = await repo.findRun(db, runId);
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: BackupError.RUN_NOT_FOUND });
  if (run.status === "running") {
    throw new TRPCError({ code: "CONFLICT", message: BackupError.ALREADY_RUNNING });
  }
  if (run.drive_file_id) {
    const settings = await loadSettingsRow(db);
    if (settings.gdrive_refresh_token) {
      try {
        await gdrive.deleteFile(decryptToken(settings.gdrive_refresh_token), run.drive_file_id);
      } catch (err) {
        logger.warn({ err, runId }, "drive delete failed");
      }
    }
  }
  await repo.deleteRun(db, runId);
  logger.info({ event: LogEvent.BackupDeleted, runId }, "backup deleted");
  return { ok: true };
}

// --- runs queries ---
export async function listRuns(db: Db, input: ListBackupRunsInput): Promise<BackupRun[]> {
  const rows = await repo.listRuns(db, {
    status: input.status,
    from: input.from,
    to: input.to,
    limit: input.limit,
    offset: input.offset,
  });
  return rows.map(toRun);
}

export async function getRun(db: Db, runId: string): Promise<BackupRun> {
  const run = await repo.findRun(db, runId);
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: BackupError.RUN_NOT_FOUND });
  return toRun(run);
}

export async function getStatus(db: Db): Promise<BackupStatusResult> {
  const settings = await loadSettingsRow(db);
  const running = await repo.findRunning(db);
  return { maintenance: settings.maintenance, running: running ? toRun(running) : null };
}

// --- maintenance ---
export async function setMaintenance(db: Db, on: boolean): Promise<BackupSettings> {
  const updated = await repo.setMaintenance(db, on);
  if (!updated) throw settingsNotFound();
  setMaintenanceCache(on);
  logger.info({ event: LogEvent.BackupMaintenanceToggled, on }, "maintenance toggled");
  return toSettings(updated);
}

/** Boot-time: hydrate the in-memory maintenance flag from the DB. */
export async function loadMaintenanceFlag(db: Db): Promise<void> {
  const row = await repo.getSettings(db);
  setMaintenanceCache(!!row?.maintenance);
}

// --- restore ---
export async function restore(db: Db, runId: string): Promise<{ ok: true }> {
  const settings = await loadSettingsRow(db);
  if (!settings.maintenance) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: BackupError.RESTORE_REQUIRES_MAINTENANCE,
    });
  }
  const run = await repo.findRun(db, runId);
  if (!run || run.status !== "success" || !run.drive_file_id) {
    throw new TRPCError({ code: "NOT_FOUND", message: BackupError.RUN_NOT_FOUND });
  }
  if (!settings.gdrive_refresh_token) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: BackupError.DRIVE_NOT_CONNECTED,
    });
  }

  logger.info({ event: LogEvent.BackupRestoreStarted, runId }, "restore started");
  const dir = await mkdtemp(path.join(env.BACKUP_WORK_DIR || os.tmpdir(), "dl-"));
  const filePath = path.join(dir, run.file_name);
  try {
    await gdrive.downloadFile(
      decryptToken(settings.gdrive_refresh_token),
      run.drive_file_id,
      filePath,
    );
    await job.restoreArchive({
      filePath,
      expectedChecksum: run.checksum,
      encrypted: run.file_name.endsWith(".gpg"),
      includeMinio: settings.include_minio,
    });
    logger.info({ event: LogEvent.BackupRestoreSucceeded, runId }, "restore succeeded");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ event: LogEvent.BackupRestoreFailed, runId, err }, "restore failed");
    if (message === "CHECKSUM_MISMATCH") {
      throw new TRPCError({ code: "BAD_REQUEST", message: BackupError.CHECKSUM_MISMATCH });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
