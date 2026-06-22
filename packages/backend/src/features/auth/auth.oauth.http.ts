import crypto from "node:crypto";
import { Router } from "express";
import { parse as parseCookie } from "cookie";
import { trace } from "@opentelemetry/api";
import { AuthError } from "shared";
import { appDb } from "../../db/index.js";
import { env } from "../../config/env.config.js";
import { logger } from "../../logger.js";
import { emailService } from "../email/email.service.js";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  googleSignInEnabled,
} from "./auth.google.js";
import * as auth from "./auth.service.js";

// Plain HTTP (not tRPC): Google drives this with top-level browser 302 redirects.
export const authOauthHttpRouter = Router();

const STATE_COOKIE = "g_oauth_state";
// SameSite=lax so the state cookie survives Google's top-level redirect back.
const STATE_PATH = "/api/auth/oauth";

function cookiesOf(req: { headers: { cookie?: string } }): Record<string, string> {
  return req.headers.cookie ? parseCookie(req.headers.cookie) : {};
}

function setSessionCookies(
  res: import("express").Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie("access_token", tokens.accessToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
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
}

// Step 1 - start the flow: set a CSRF nonce cookie and bounce to Google.
authOauthHttpRouter.get("/auth/oauth/google", (_req, res) => {
  if (!googleSignInEnabled) {
    res.status(404).send("Google sign-in is not configured");
    return;
  }
  const state = crypto.randomBytes(16).toString("base64url");
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: STATE_PATH,
  });
  res.redirect(302, buildGoogleAuthUrl(state));
});

// Step 2 - Google returns here. Verify the nonce, exchange the code, mint a
// session, then redirect into the SPA (which re-hydrates via /auth/refresh).
authOauthHttpRouter.get("/auth/oauth/google/callback", async (req, res) => {
  const appBase = env.APP_BASE_URL || "";
  // Carry the active OTel traceId into the redirect so the login page can show
  // it (OAuth errors are redirects, not tRPC responses, so the client otherwise
  // has no trace ref to quote in a bug report).
  const fail = (e: string) => {
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    const ref = traceId ? `&ref=${traceId}` : "";
    return res.redirect(302, `${appBase}/login?error=${e}${ref}`);
  };

  const cookieState = cookiesOf(req)[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: STATE_PATH });

  try {
    const state = req.query.state;
    if (!cookieState || typeof state !== "string" || state !== cookieState) {
      return fail(AuthError.OAUTH_FAILED);
    }
    if (typeof req.query.error === "string") return fail(AuthError.OAUTH_FAILED);
    const code = req.query.code;
    if (typeof code !== "string") return fail(AuthError.OAUTH_FAILED);

    const profile = await exchangeGoogleCode(code);
    const deps: auth.AuthDeps = {
      db: appDb,
      email: emailService,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    };
    const tokens = await auth.loginWithGoogle(deps, profile);
    setSessionCookies(res, tokens);
    return res.redirect(302, appBase || "/");
  } catch (err) {
    const message = (err as { message?: string })?.message;
    if (message === AuthError.EMAIL_NOT_VERIFIED) return fail(AuthError.EMAIL_NOT_VERIFIED);
    logger.error({ err }, "google oauth callback failed");
    return fail(AuthError.OAUTH_FAILED);
  }
});
