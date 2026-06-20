import { Router, json, type Request, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { parse as parseCookie } from "cookie";
import { clientLogSchema } from "shared";
import { verifyAccessToken } from "../auth/auth.service.js";
import { logger } from "../../logger.js";

// Browser behaviour logs (non-errors) land here and are written to Loki via the
// backend logger. Errors go to Sentry instead, never here.
export const clientLogRouter = Router();

// Same CSRF marker the rest of the API requires on mutations.
const csrfGuard: RequestHandler = (req, res, next) => {
  if (req.get("x-requested-with") !== "XMLHttpRequest") {
    res.status(403).json({ error: "CSRF check failed" });
    return;
  }
  next();
};

// Auth required: an unauthenticated client-log is an open log-injection sink.
const requireUser: RequestHandler = (req, res, next) => {
  const cookies = req.headers.cookie ? parseCookie(req.headers.cookie) : {};
  const access = cookies["access_token"];
  if (access) {
    try {
      (req as Request & { userId?: string }).userId =
        verifyAccessToken(access).sub;
      return next();
    } catch {
      /* fall through */
    }
  }
  res.status(401).json({ error: "unauthorized" });
};

// Flood guard per IP (req.ip resolves to the real client via trust proxy).
const limiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const clientLogger = logger.child({ source: "client" });

clientLogRouter.post(
  "/client-log",
  csrfGuard,
  limiter,
  requireUser,
  json({ limit: "8kb" }), // cap payload size
  (req, res) => {
    const parsed = clientLogSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload" });
      return;
    }
    const { level, message, traceId, context, url } = parsed.data;
    const userId = (req as Request & { userId?: string }).userId;
    clientLogger[level]({ traceId, userId, url, context }, message);
    res.status(204).end();
  },
);
