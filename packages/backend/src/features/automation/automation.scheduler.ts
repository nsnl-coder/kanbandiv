import { Cron } from "croner";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";
import { runDueApproaching } from "./automation.engine.js";
import type { Db } from "./automation.repo.js";

let current: Cron | null = null;

// Scan for cards entering a due-approaching rule's window every 5 minutes;
// idempotent via the run log (one run row per rule+card).
export function startAutomationScheduler(db: Db): void {
  current?.stop();
  current = new Cron("*/5 * * * *", () => {
    runDueApproaching(db)
      .then((fired) => {
        if (fired > 0) logger.info({ event: LogEvent.AutomationRan, fired }, "due-approaching rules fired");
      })
      .catch((err) => logger.error({ err, event: LogEvent.AutomationFailed }, "due-approaching scan failed"));
  });
}
