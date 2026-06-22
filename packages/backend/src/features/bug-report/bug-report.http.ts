import Busboy from "busboy";
import { parse as parseCookie } from "cookie";
import { type NextFunction, type Request, type Response, Router } from "express";
import { TRPCError } from "@trpc/server";
import { AttachmentError, ATTACHMENT_MAX_BYTES, BugReportError } from "shared";
import { appDb, type AppDb } from "../../db/index.js";
import { logger } from "../../logger.js";
import { verifyAccessToken } from "../auth/auth.service.js";
import { findPublicUserById } from "../auth/auth.repo.js";
import { findUserGlobalPerms } from "../rbac/rbac.repo.js";
import { storage as defaultStorage } from "../attachment/attachment.storage.js";
import type { Storage } from "../attachment/attachment.storage.js";
import type { CtxUser } from "./bug-report.service.js";
import * as bugReport from "./bug-report.service.js";

interface AuthedRequest extends Request {
  authUser?: CtxUser;
}

const STATUS: Record<string, number> = {
  [AttachmentError.FORBIDDEN]: 403,
  [AttachmentError.ATTACHMENT_NOT_FOUND]: 404,
  [BugReportError.NOT_FOUND]: 404,
  [AttachmentError.FILE_TOO_LARGE]: 413,
  [AttachmentError.UNSUPPORTED_TYPE]: 415,
  [AttachmentError.NO_FILE]: 400,
  [AttachmentError.FILENAME_TOO_LONG]: 400,
  [AttachmentError.STORAGE_UNAVAILABLE]: 503,
  [AttachmentError.UNAUTHORIZED]: 401,
};

function sendError(res: Response, e: unknown): void {
  const code = e instanceof TRPCError ? e.message : (e as { message?: string })?.message ?? "";
  const status = STATUS[code] ?? 500;
  if (status === 500) logger.error({ err: e }, "bug-report attachment http error");
  res.status(status).json({ error: status === 500 ? "INTERNAL_SERVER_ERROR" : code });
}

// Replicate the trpc.ts protectedProcedure authz against the cookie, building the
// full CtxUser (email + permissions) the service authz needs.
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
      const { isSuperuser, perms } = await findUserGlobalPerms(db, user.id);
      req.authUser = { id: user.id, email: user.email, isSuperuser, permissions: perms };
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

// Images render inline (admins click to preview in a new tab); everything else
// is forced as a download. nosniff + the SVG exclusion keep inline safe.
function contentDisposition(filename: string, mimeType: string): string {
  const kind = mimeType.startsWith("image/") ? "inline" : "attachment";
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function createBugReportHttpRouter(deps: { db: AppDb; storage: Storage }): Router {
  const { db, storage } = deps;
  const router = Router();

  router.post(
    "/bug-reports/:id/attachments",
    requireUser(db),
    requireCsrf,
    (req: AuthedRequest, res: Response) => {
      const user = req.authUser!;
      const bugReportId = String(req.params.id);
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

        bugReport
          .createAttachment(db, storage, user, {
            bugReportId,
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
    "/bug-report-attachments/:id/download",
    requireUser(db),
    async (req: AuthedRequest, res: Response) => {
      const user = req.authUser!;
      try {
        const { row } = await bugReport.loadAttachmentFor(db, user, String(req.params.id));
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
        res.setHeader("Content-Disposition", contentDisposition(row.filename, row.mime_type));
        const stream = await storage.getObject(row.storage_key);
        stream.on("error", (err) => {
          logger.error({ err, key: row.storage_key }, "bug attachment download stream error");
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

export const bugReportHttpRouter = createBugReportHttpRouter({ db: appDb, storage: defaultStorage });
