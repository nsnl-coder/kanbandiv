import { Cron } from "croner";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";
import * as repo from "./backup.repo.js";
import type { Db } from "./backup.repo.js";
import { BACKUP_TZ, cronExprFor, onReschedule, runBackup } from "./backup.service.js";

let current: Cron | null = null;

/** (Re)build the scheduled job from current settings. Safe to call repeatedly. */
export async function reschedule(db: Db): Promise<void> {
  current?.stop();
  current = null;

  const row = await repo.getSettings(db);
  if (!row || !row.enabled) return;
  const expr = cronExprFor(row);
  if (!expr) return;

  try {
    current = new Cron(expr, { timezone: BACKUP_TZ }, () => {
      runBackup(db, "scheduled").catch((err) =>
        logger.error({ err, event: LogEvent.BackupScheduled }, "scheduled backup error"),
      );
    });
    logger.info(
      { event: LogEvent.BackupScheduleRegistered, expr, tz: BACKUP_TZ },
      "backup schedule registered",
    );
  } catch (err) {
    logger.error({ err, expr }, "failed to register backup schedule");
  }
}

/** Wire settings changes to a reschedule and do the initial registration. */
export async function startScheduler(db: Db): Promise<void> {
  onReschedule((d) => {
    reschedule(d).catch((err) => logger.error({ err }, "reschedule failed"));
  });
  await reschedule(db);
}
