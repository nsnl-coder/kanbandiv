// Centralized log-event names. Use these instead of string literals so log
// queries (Loki/Grafana) and alert rules have a stable, greppable vocabulary.
export const LogEvent = {
  BackupStarted: "backup.started",
  BackupSucceeded: "backup.succeeded",
  BackupFailed: "backup.failed",
  BackupDeleted: "backup.deleted",
  BackupRetentionPruned: "backup.retention.pruned",
  BackupRestoreStarted: "backup.restore.started",
  BackupRestoreSucceeded: "backup.restore.succeeded",
  BackupRestoreFailed: "backup.restore.failed",
  BackupScheduled: "backup.scheduled",
  BackupScheduleRegistered: "backup.schedule.registered",
  BackupMaintenanceToggled: "backup.maintenance.toggled",
  BackupDriveConnected: "backup.drive.connected",
  BackupDriveDisconnected: "backup.drive.disconnected",
  SuperAdminSeeded: "superadmin.seeded",
  SuperAdminSeedSkipped: "superadmin.seed.skipped",
  CardReminderSent: "card.reminder.sent",
  ActivityRecordFailed: "activity.record.failed",
  NotificationCreateFailed: "notification.create.failed",
  BugReportNotifyFailed: "bug-report.notify.failed",
  BoardViewParseFailed: "board-view.parse.failed",
  RealtimePublishFailed: "realtime.publish.failed",
  RealtimeRedisError: "realtime.redis.error",
  RealtimeEventParseFailed: "realtime.event.parse.failed",
  CacheError: "cache.error",
  AutomationRan: "automation.ran",
  AutomationFailed: "automation.failed",
  AutomationSkipped: "automation.skipped",
} as const;
export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];

// Cache TTLs (seconds). Short windows bound staleness so explicit invalidation
// only has to cover the high-value mutations.
export const AUTH_CACHE_TTL_SEC = 30;
export const NOTIF_UNREAD_TTL_SEC = 60;
