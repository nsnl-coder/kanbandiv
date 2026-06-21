import Busboy from "busboy";
import { parse as parseCookie } from "cookie";
import { type NextFunction, type Request, type Response, Router } from "express";
import { TRPCError } from "@trpc/server";
import { AttachmentError, ATTACHMENT_MAX_BYTES } from "shared";
import { appDb, type AppDb } from "../../db/index.js";
import { logger } from "../../logger.js";
import type { CtxUser } from "../board/board.service.js";
import { verifyAccessToken } from "../auth/auth.service.js";
import { findPublicUserById } from "../auth/auth.repo.js";
import { findUserGlobalPerms } from "../rbac/rbac.repo.js";
import { storage as defaultStorage } from "./attachment.storage.js";
import type { Storage } from "./attachment.storage.js";
import * as attachment from "./attachment.service.js";

interface AuthedRequest extends Request {
  authUser?: CtxUser;
}

const STATUS: Record<string, number> = {
  [AttachmentError.FORBIDDEN]: 403,
  [AttachmentError.ATTACHMENT_NOT_FOUND]: 404,
  [AttachmentError.CARD_NOT_FOUND]: 404,
  [AttachmentError.FILE_TOO_LARGE]: 413,
  [AttachmentError.UNSUPPORTED_TYPE]: 415,
  [AttachmentError.NO_FILE]: 400,
  [AttachmentError.FILENAME_TOO_LONG]: 400,
  [AttachmentError.STORAGE_UNAVAILABLE]: 503,
  [AttachmentError.UNAUTHORIZED]: 401,
};

// Map a thrown error (TRPCError or plain) to the JSON error shape. loadBoardFor
// throws TRPCError whose `message` is the error constant.
function sendError(res: Response, e: unknown): void {
  const code = e instanceof TRPCError ? e.message : (e as { message?: string })?.message ?? "";
  const status = STATUS[code] ?? 500;
  if (status === 500) logger.error({ err: e }, "attachment http error");
  res.status(status).json({ error: status === 500 ? "INTERNAL_SERVER_ERROR" : code });
}

// Replicate the trpc.ts protectedProcedure authz against the cookie.
function requireUser(db: AppDb) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cookies = parseCookie(req.headers.cookie ?? "");
      const token = cookies["access_token"];
      if (!token) {
        res.status(401).json({ error: AttachmentError.UNAUTHORIZED });
        return;
      }
      let sub: string;
      try {
        sub = verifyAccessToken(token).sub;
      } catch {
        res.status(401).json({ error: AttachmentError.UNAUTHORIZED });
        return;
      }
      const user = await findPublicUserById(db, sub);
      if (!user || !user.email_verified) {
        res.status(401).json({ error: AttachmentError.UNAUTHORIZED });
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

// The app-wide csrfGuard only covers /trpc; add our own marker check here.
function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (req.get("x-requested-with") !== "XMLHttpRequest") {
    res.status(403).json({ error: "CSRF check failed" });
    return;
  }
  next();
}

// Encode a filename for an RFC 5987 Content-Disposition header.
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function createAttachmentHttpRouter(deps: { db: AppDb; storage: Storage }): Router {
  const { db, storage } = deps;
  const router = Router();

  router.post(
    "/cards/:cardId/attachments",
    requireUser(db),
    requireCsrf,
    (req: AuthedRequest, res: Response) => {
      const user = req.authUser!;
      const cardId = String(req.params.cardId);
      let bb: Busboy.Busboy;
      try {
        bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: ATTACHMENT_MAX_BYTES } });
      } catch {
        res.status(400).json({ error: AttachmentError.NO_FILE });
        return;
      }

      let handled = false;
      let sawFile = false;

      bb.on("file", (_name, file, info) => {
        sawFile = true;
        let tooLarge = false;
        file.on("limit", () => {
          tooLarge = true;
          if (handled) return;
          handled = true;
          file.resume();
          res.status(413).json({ error: AttachmentError.FILE_TOO_LARGE });
        });

        attachment
          .createAttachment(db, storage, user, {
            cardId,
            filename: info.filename ?? "",
            mimeType: info.mimeType,
            stream: file,
          })
          .then((created) => {
            if (handled) return;
            handled = true;
            res.status(201).json(created);
          })
          .catch((e) => {
            if (handled || tooLarge) return;
            handled = true;
            sendError(res, e);
          });
      });

      bb.on("close", () => {
        if (!sawFile && !handled) {
          handled = true;
          res.status(400).json({ error: AttachmentError.NO_FILE });
        }
      });

      bb.on("error", (e: unknown) => {
        if (handled) return;
        handled = true;
        sendError(res, e);
      });

      req.pipe(bb);
    },
  );

  router.get(
    "/attachments/:id/download",
    requireUser(db),
    async (req: AuthedRequest, res: Response) => {
      const user = req.authUser!;
      try {
        const { row } = await attachment.loadAttachmentFor(db, user, String(req.params.id));
        if (!storage.isEnabled()) {
          res.status(503).json({ error: AttachmentError.STORAGE_UNAVAILABLE });
          return;
        }
        try {
          await storage.statObject(row.storage_key);
        } catch {
          res.status(404).json({ error: AttachmentError.ATTACHMENT_NOT_FOUND });
          return;
        }
        res.setHeader("Content-Type", row.mime_type);
        res.setHeader("Content-Length", Number(row.size_bytes));
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Disposition", contentDisposition(row.filename));
        const stream = await storage.getObject(row.storage_key);
        stream.on("error", (err) => {
          logger.error({ err, key: row.storage_key }, "attachment download stream error");
          res.destroy();
        });
        stream.pipe(res);
      } catch (e) {
        sendError(res, e);
      }
    },
  );

  return router;
}

export const attachmentHttpRouter = createAttachmentHttpRouter({ db: appDb, storage: defaultStorage });
