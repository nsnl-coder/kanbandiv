export const BackupError = {
  SETTINGS_NOT_FOUND: "SETTINGS_NOT_FOUND",
  RUN_NOT_FOUND: "RUN_NOT_FOUND",
  DRIVE_NOT_CONNECTED: "DRIVE_NOT_CONNECTED",
  ALREADY_RUNNING: "ALREADY_RUNNING",
  RESTORE_REQUIRES_MAINTENANCE: "RESTORE_REQUIRES_MAINTENANCE",
  CHECKSUM_MISMATCH: "CHECKSUM_MISMATCH",
  INVALID_CRON: "INVALID_CRON",
  OAUTH_FAILED: "OAUTH_FAILED",
  // Returned by the maintenance guard to non-superusers while maintenance is on.
  MAINTENANCE: "MAINTENANCE",
} as const;
export type BackupError = (typeof BackupError)[keyof typeof BackupError];
