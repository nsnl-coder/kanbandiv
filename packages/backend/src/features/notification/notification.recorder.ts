import {
  type NotificationPayload,
  notificationPayloadSchema,
  type NotificationTypeValue,
  UserEventKind,
} from "shared";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";
import type { Bus } from "../realtime/realtime.bus.js";
import * as repo from "./notification.repo.js";
import type { Db } from "./notification.repo.js";

export type NotifyChannel = "in_app" | "email";

// Single gate consulted by BOTH the email sites and the in-app recorder. An
// absent prefs row resolves to ON (legacy behaviour). Best-effort: a query
// failure must not silence a notification, so it defaults to true.
export async function shouldNotify(
  db: Db,
  userId: string,
  type: NotificationTypeValue,
  channel: NotifyChannel,
): Promise<boolean> {
  try {
    const pref = await repo.getPref(db, userId, type);
    if (!pref) return true;
    return channel === "in_app" ? pref.in_app : pref.email;
  } catch {
    return true;
  }
}

export interface CreateInput {
  userId: string;
  type: NotificationTypeValue;
  payload: NotificationPayload;
}

// Derive a display handle from an email local-part (file-local; copied from the
// comment/assignee services rather than abstracted).
export function handleFromEmail(email: string): string {
  return email.split("@")[0];
}

// Best-effort in-app notification recorder. Called ALONGSIDE the email at each of
// the 3 sites. NEVER throws — a dropped inbox row must not fail the user action or
// the email. The bus nudge is INSIDE the try AFTER the insert: a failed insert
// must not publish a phantom nudge. payload MUST be JSON.stringify'd (jsonb).
export async function create(db: Db, bus: Bus, input: CreateInput): Promise<void> {
  try {
    if (!(await shouldNotify(db, input.userId, input.type, "in_app"))) return;
    const payload = notificationPayloadSchema.parse(input.payload);
    await db
      .insertInto("notifications")
      .values({
        user_id: input.userId,
        type: input.type,
        payload: JSON.stringify(payload),
      })
      .execute();
    bus.publishUser({
      userId: input.userId,
      kind: UserEventKind.NOTIFICATION,
      ts: Date.now(),
    });
  } catch (err) {
    logger.error(
      {
        err,
        event: LogEvent.NotificationCreateFailed,
        type: input.type,
        userId: input.userId,
      },
      LogEvent.NotificationCreateFailed,
    );
  }
}
