import { Router } from "express";
import { hasPermission, Permission } from "shared";
import { appDb } from "../../db/index.js";
import { env } from "../../config/env.config.js";
import { logger } from "../../logger.js";
import { findUserGlobalPerms } from "../rbac/rbac.repo.js";
import { connectDrive, verifyOAuthState } from "./backup.service.js";

// Google redirects the admin's browser here after consent. Not tRPC (plain GET
// redirect). Identity comes from the signed `state` param, NOT the session
// cookie - SameSite=strict cookies aren't sent on Google's cross-site redirect.
export const backupHttpRouter = Router();

backupHttpRouter.get("/admin/backup/gdrive/callback", async (req, res) => {
  const back = (q: string) =>
    env.APP_BASE_URL
      ? res.redirect(`${env.APP_BASE_URL}/admin/backup?${q}`)
      : res.status(q.startsWith("error") ? 400 : 200).send(q);

  try {
    const state = req.query.state;
    const userId = typeof state === "string" ? verifyOAuthState(state) : null;
    if (!userId) return back("error=unauthorized");

    const { isSuperuser, perms } = await findUserGlobalPerms(appDb, userId);
    if (!isSuperuser && !hasPermission(perms, Permission.AdminBackupManage)) {
      return back("error=forbidden");
    }

    if (typeof req.query.error === "string") return back(`error=${req.query.error}`);
    const code = req.query.code;
    if (typeof code !== "string") return back("error=missing_code");

    await connectDrive(appDb, code);
    return back("connected=1");
  } catch (err) {
    logger.error({ err }, "drive oauth callback failed");
    return back("error=oauth_failed");
  }
});
