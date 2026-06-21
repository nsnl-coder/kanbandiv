import { z } from "zod";

export const ScheduleKind = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly",
  Cron: "cron",
} as const;
export type ScheduleKind = (typeof ScheduleKind)[keyof typeof ScheduleKind];

export const RetentionMode = {
  Simple: "simple",
  Gfs: "gfs",
} as const;
export type RetentionMode = (typeof RetentionMode)[keyof typeof RetentionMode];

export const BackupStatus = {
  Running: "running",
  Success: "success",
  Failed: "failed",
} as const;
export type BackupStatus = (typeof BackupStatus)[keyof typeof BackupStatus];

export const BackupTrigger = {
  Scheduled: "scheduled",
  Manual: "manual",
} as const;
export type BackupTrigger = (typeof BackupTrigger)[keyof typeof BackupTrigger];

const scheduleKindSchema = z.enum(["daily", "weekly", "monthly", "cron"]);
const retentionModeSchema = z.enum(["simple", "gfs"]);
const positiveInt = z.number().int().positive();

// Update payload. Cross-field rules: cron kind needs cronExpr; retention mode
// needs its matching counts. Refined so the API rejects inconsistent settings.
export const updateBackupSettingsInput = z
  .object({
    enabled: z.boolean(),
    scheduleKind: scheduleKindSchema,
    cronExpr: z.string().trim().min(1).max(120).nullable().optional(),
    retentionMode: retentionModeSchema,
    retentionDays: positiveInt.max(3650).nullable().optional(),
    gfsDaily: positiveInt.max(365).nullable().optional(),
    gfsWeekly: positiveInt.max(520).nullable().optional(),
    gfsMonthly: positiveInt.max(120).nullable().optional(),
    includeMinio: z.boolean(),
    encryptionEnabled: z.boolean(),
    gdriveFolderName: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.scheduleKind === "cron" && !v.cronExpr) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cronExpr"],
        message: "cronExpr is required when scheduleKind is cron",
      });
    }
    if (v.retentionMode === "simple" && v.retentionDays == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retentionDays"],
        message: "retentionDays is required for simple retention",
      });
    }
    if (
      v.retentionMode === "gfs" &&
      v.gfsDaily == null &&
      v.gfsWeekly == null &&
      v.gfsMonthly == null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gfsDaily"],
        message: "at least one GFS count is required for gfs retention",
      });
    }
  });
export type UpdateBackupSettingsInput = z.infer<typeof updateBackupSettingsInput>;

export const driveStatusSchema = z.object({
  connected: z.boolean(),
  email: z.string().nullable(),
});
export type DriveStatus = z.infer<typeof driveStatusSchema>;

export const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  scheduleKind: scheduleKindSchema,
  cronExpr: z.string().nullable(),
  retentionMode: retentionModeSchema,
  retentionDays: z.number().nullable(),
  gfsDaily: z.number().nullable(),
  gfsWeekly: z.number().nullable(),
  gfsMonthly: z.number().nullable(),
  includeMinio: z.boolean(),
  encryptionEnabled: z.boolean(),
  gdriveFolderName: z.string().nullable(),
  // Resolved Drive folder id (read-only; used to build the folder link).
  gdriveFolderId: z.string().nullable(),
  maintenance: z.boolean(),
  drive: driveStatusSchema,
  updatedAt: z.date(),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export const backupRunSchema = z.object({
  id: z.string(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  status: z.enum(["running", "success", "failed"]),
  trigger: z.enum(["scheduled", "manual"]),
  sizeBytes: z.number().nullable(),
  driveFileId: z.string().nullable(),
  fileName: z.string(),
  checksum: z.string().nullable(),
  error: z.string().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
});
export type BackupRun = z.infer<typeof backupRunSchema>;

export const listBackupRunsInput = z.object({
  status: z.enum(["running", "success", "failed"]).optional(),
  from: z.date().optional(),
  to: z.date().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type ListBackupRunsInput = z.infer<typeof listBackupRunsInput>;

export const backupRunIdInput = z.object({ runId: z.string() });
export type BackupRunIdInput = z.infer<typeof backupRunIdInput>;

export const authUrlSchema = z.object({ url: z.string() });
export type AuthUrl = z.infer<typeof authUrlSchema>;

export const maintenanceInput = z.object({ on: z.boolean() });
export type MaintenanceInput = z.infer<typeof maintenanceInput>;

export const backupStatusSchema = z.object({
  maintenance: z.boolean(),
  running: backupRunSchema.nullable(),
});
export type BackupStatusResult = z.infer<typeof backupStatusSchema>;

export const backupUpcomingSchema = z.object({ runs: z.array(z.date()) });
export type BackupUpcoming = z.infer<typeof backupUpcomingSchema>;
