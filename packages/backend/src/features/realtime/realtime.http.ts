import { parse as parseCookie } from "cookie";
import { type NextFunction, type Request, type Response, Router } from "express";
import { TRPCError } from "@trpc/server";
import { BoardError } from "shared";
import { appDb, type AppDb } from "../../db/index.js";
import { logger } from "../../logger.js";
import type { CtxUser } from "../board/board.service.js";
import { loadBoardFor } from "../board/board.service.js";
import { verifyAccessToken } from "../auth/auth.service.js";
import { findPublicUserById } from "../auth/auth.repo.js";
import { findUserGlobalPerms } from "../rbac/rbac.repo.js";
import { bus as defaultBus, type Bus } from "./realtime.bus.js";

interface AuthedRequest extends Request {
  authUser?: CtxUser;
}

// Heartbeat under the nginx 60s idle default so the stream is never closed idle.
const HEARTBEAT_MS = 25_000;

const STATUS: Record<string, number> = {
  [BoardError.FORBIDDEN]: 403,
  [BoardError.BOARD_NOT_FOUND]: 404,
};

// Map a thrown error (TRPCError or plain) to the JSON error shape. loadBoardFor
// throws TRPCError whose `message` is the error constant. A private board reads
// as NOT_FOUND (no existence leak).
function sendError(res: Response, e: unknown): void {
  const code = e instanceof TRPCError ? e.message : (e as { message?: string })?.message ?? "";
  const status = STATUS[code] ?? 500;
  if (status === 500) logger.error({ err: e }, "realtime http error");
  res.status(status).json({ error: status === 500 ? "INTERNAL_SERVER_ERROR" : code });
}

// Replicate the trpc.ts protectedProcedure authz against the cookie (verbatim
// from attachment.http.ts requireUser). No CSRF: this is a GET.
function requireUser(db: AppDb) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cookies = parseCookie(req.headers.cookie ?? "");
      const token = cookies["access_token"];
      if (!token) {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      let sub: string;
      try {
        sub = verifyAccessToken(token).sub;
      } catch {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      const user = await findPublicUserById(db, sub);
      if (!user || !user.email_verified) {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      const { isSuperuser } = await findUserGlobalPerms(db, user.id);
      req.authUser = { id: user.id, isSuperuser };
      next();
    } catch (e) {
      sendError(res, e);
    }
  };
}

export function createRealtimeHttpRouter(deps: { db: AppDb; bus: Bus }): Router {
  const { db, bus } = deps;
  const router = Router();

  router.get(
    "/boards/:boardId/events",
    requireUser(db),
    async (req: AuthedRequest, res: Response) => {
      const user = req.authUser!;
      const boardId = String(req.params.boardId);

      // Authorize on connect. Inaccessible board -> NOT_FOUND (no existence leak).
      try {
        await loadBoardFor(db, user, boardId, "view");
      } catch (e) {
        sendError(res, e);
        return;
      }

      // SSE headers. X-Accel-Buffering disables nginx response buffering.
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.write(": connected\n\n");

      const off = bus.subscribe(boardId, (ev) => {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      });

      const hb = setInterval(() => {
        res.write(": ping\n\n");
      }, HEARTBEAT_MS);

      // Cleanup on tab close, navigation, or network drop. No leak.
      req.on("close", () => {
        clearInterval(hb);
        off();
        res.end();
      });
    },
  );

  // Per-user stream. Authz == authentication: the only resource is the caller's
  // own user channel. No board authz.
  router.get(
    "/me/notifications/events",
    requireUser(db),
    async (req: AuthedRequest, res: Response) => {
      const user = req.authUser!;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.write(": connected\n\n");

      const off = bus.subscribeUser(user.id, (ev) => {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      });

      const hb = setInterval(() => {
        res.write(": ping\n\n");
      }, HEARTBEAT_MS);

      req.on("close", () => {
        clearInterval(hb);
        off();
        res.end();
      });
    },
  );

  return router;
}

export const realtimeHttpRouter = createRealtimeHttpRouter({ db: appDb, bus: defaultBus });
