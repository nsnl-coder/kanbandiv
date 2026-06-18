import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookie } from "cookie";
import type { Response } from "express";
import { appDb, type AppDb } from "../db/index.js";
import { emailService, type EmailPort } from "../features/email/email.service.js";
import { verifyAccessToken } from "../features/auth/auth.service.js";

export interface Context {
  db: AppDb;
  email: EmailPort;
  userId: string | null;
  refreshCookie: string | null;
  ip: string | null;
  userAgent: string | null;
  res: Response | null;
}

export function createContext({ req, res }: CreateExpressContextOptions): Context {
  let userId: string | null = null;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      userId = verifyAccessToken(auth.slice(7)).sub;
    } catch {
      userId = null;
    }
  }

  const cookies = req.headers.cookie ? parseCookie(req.headers.cookie) : {};

  return {
    db: appDb,
    email: emailService,
    userId,
    refreshCookie: cookies["refresh_token"] ?? null,
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
    res,
  };
}
