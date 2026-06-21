import bcrypt from "bcryptjs";
import type { AppDb } from "../db/index.js";
import { env } from "../config/env.config.js";
import { LogEvent } from "../config/const.config.js";
import { logger } from "../logger.js";

// Idempotent bootstrap of the single super admin from SUPER_ADMIN_EMAIL /
// SUPER_ADMIN_PASSWORD. Safe to run on every startup/deploy.
//
// The DB enforces at most one superuser (users_one_superuser partial index), so:
//   - no env creds         -> skip
//   - a superuser exists   -> same email: refresh password; other email: skip
//   - no superuser yet     -> upgrade the matching user, else insert a new one
export async function seedSuperAdmin(db: AppDb): Promise<void> {
  const email = env.SUPER_ADMIN_EMAIL.trim().toLowerCase();
  const password = env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    logger.info({ event: LogEvent.SuperAdminSeedSkipped, reason: "no creds" });
    return;
  }

  const password_hash = await bcrypt.hash(password, env.BCRYPT_COST);

  const existingSuper = await db
    .selectFrom("users")
    .select(["id", "email"])
    .where("is_superuser", "=", true)
    .executeTakeFirst();

  if (existingSuper) {
    if (existingSuper.email !== email) {
      logger.warn({
        event: LogEvent.SuperAdminSeedSkipped,
        reason: "different superuser exists",
        existing: existingSuper.email,
      });
      return;
    }
    await db
      .updateTable("users")
      .set({ password_hash, email_verified: true, updated_at: new Date() })
      .where("id", "=", existingSuper.id)
      .execute();
    logger.info({ event: LogEvent.SuperAdminSeeded, email, created: false });
    return;
  }

  const byEmail = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", email)
    .executeTakeFirst();

  if (byEmail) {
    await db
      .updateTable("users")
      .set({
        is_superuser: true,
        password_hash,
        email_verified: true,
        updated_at: new Date(),
      })
      .where("id", "=", byEmail.id)
      .execute();
    logger.info({ event: LogEvent.SuperAdminSeeded, email, created: false });
    return;
  }

  await db
    .insertInto("users")
    .values({ email, password_hash, email_verified: true, is_superuser: true })
    .execute();
  logger.info({ event: LogEvent.SuperAdminSeeded, email, created: true });
}
