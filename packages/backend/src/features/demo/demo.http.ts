import { Router } from "express";
import rateLimit from "express-rate-limit";
import { appDb, type AppDb } from "../../db/index.js";
import { env } from "../../config/env.config.js";
import { LogEvent } from "../../config/const.config.js";
import { logger } from "../../logger.js";
import { createDemoSession } from "./demo.service.js";

// One-click demo sessions: a plain GET (linkable from the landing page and the
// README) that creates a throwaway account, seeds a board, sets the normal
// session cookies, and 302s straight onto the board. Plain HTTP (not tRPC)
// because the entry point is a top-level browser navigation, like the Google
// OAuth flow above it in index.ts.
export function createDemoHttpRouter(deps: { db: AppDb }): Router {
  const { db } = deps;
  const router = Router();

  // Stricter than the login limiter (10/min): every hit writes a user plus a
  // seeded board, so this is the easiest write-amplification endpoint we have.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.get("/auth/demo", limiter, async (req, res) => {
    const appBase = env.APP_BASE_URL || "";
    try {
      const { tokens, projectId, boardId } = await createDemoSession(db, {
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      });
      // Same cookie recipe as login/OAuth (see auth.router.ts for the
      // lax-vs-strict rationale).
      res.cookie("access_token", tokens.accessToken, {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: "lax",
        maxAge: env.ACCESS_TTL_MS,
        path: "/",
      });
      res.cookie("refresh_token", tokens.refreshToken, {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: "strict",
        maxAge: env.REFRESH_TTL_MS,
        path: "/",
      });
      // The SPA re-hydrates the session via /auth/refresh on load, exactly as
      // after the Google OAuth callback.
      logger.info(
        { event: LogEvent.DemoSessionCreated, userId: tokens.user.id, boardId },
        "demo session created",
      );
      return res.redirect(302, `${appBase}/projects/${projectId}/boards/${boardId}`);
    } catch (err) {
      logger.error({ event: LogEvent.DemoSessionFailed, err }, "demo session creation failed");
      return res.redirect(302, appBase || "/");
    }
  });

  return router;
}

export const demoHttpRouter = createDemoHttpRouter({ db: appDb });
