import { TRPCClientError } from "@trpc/client";
import { BackupError } from "shared";

const MESSAGES: Record<BackupError, string> = {
  [BackupError.SETTINGS_NOT_FOUND]: "Backup settings are unavailable.",
  [BackupError.RUN_NOT_FOUND]: "That backup no longer exists.",
  [BackupError.DRIVE_NOT_CONNECTED]: "Connect Google Drive before running a backup.",
  [BackupError.ALREADY_RUNNING]: "A backup is already in progress.",
  [BackupError.RESTORE_REQUIRES_MAINTENANCE]:
    "Turn on maintenance mode before restoring.",
  [BackupError.CHECKSUM_MISMATCH]:
    "The backup failed its integrity check and was not restored.",
  [BackupError.INVALID_CRON]: "That cron expression is invalid.",
  [BackupError.OAUTH_FAILED]: "Google Drive authorization failed.",
  [BackupError.MAINTENANCE]: "The app is in maintenance mode.",
};

export function backupErrorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const msg = err.message;
    if (msg && msg in MESSAGES) return MESSAGES[msg as BackupError];
  }
  return "Something went wrong. Please try again.";
}
