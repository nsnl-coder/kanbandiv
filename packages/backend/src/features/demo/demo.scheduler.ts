import { Cron } from "croner";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";
import { sweepStaleDemoUsers } from "./demo.service.js";
import type { Db } from "./demo.repo.js";

let current: Cron | null = null;

// Sweep expired demo accounts hourly; FK cascades take their content with them.
export function startDemoCleanupScheduler(db: Db): void {
  current?.stop();
  current = new Cron("0 * * * *", () => {
    sweepStaleDemoUsers(db)
      .then((deleted) => {
        if (deleted > 0) {
          logger.info({ event: LogEvent.DemoUsersSwept, deleted }, "stale demo users swept");
        }
      })
      .catch((err) => logger.error({ event: LogEvent.DemoSweepFailed, err }, "demo user sweep failed"));
  });
}
