import { Router } from "express";
import { parse as parseCookie } from "cookie";
import { appDb } from "../../db/index.js";
import { env } from "../../config/env.config.js";
import {
  SSO_CALLBACK_PATH,
  SSO_COOKIE,
  isAllowedHost,
  isStillSuperAdmin,
  resolveAdmin,
  signSessionToken,
  signTransferToken,
  targetHostFromReturnUrl,
  verifySsoToken,
} from "./sso.service.js";

// Plain HTTP (not tRPC): nginx auth_request + browser 302 redirects drive this.
export const ssoHttpRouter = Router();

function hostOf(req: { headers: Record<string, unknown> }): string {
  return typeof req.headers.host === "string" ? req.headers.host : "";
}

function cookiesOf(req: { headers: { cookie?: string } }): Record<string, string> {
  return req.headers.cookie ? parseCookie(req.headers.cookie) : {};
}

// Step 1 - reached on the APP host (so the app session cookie is sent). Verifies
// super-admin, then mints a host-bound transfer token and bounces to the target.
ssoHttpRouter.get("/sso/authorize", async (req, res) => {
  const rd = typeof req.query.rd === "string" ? req.query.rd : "";
  const targetHost = targetHostFromReturnUrl(rd);
  if (!targetHost || !isAllowedHost(targetHost)) {
    res.status(400).send("Invalid SSO redirect target");
    return;
  }

  const result = await resolveAdmin(appDb, cookiesOf(req).access_token);
  if (result.status === "unauthenticated") {
    res.redirect(302, env.SSO_APP_ORIGIN ? `${env.SSO_APP_ORIGIN}/login` : "/login");
    return;
  }
  if (result.status === "forbidden") {
    res.status(403).send("Forbidden: admin access only");
    return;
  }

  const token = signTransferToken({ sub: result.sub, email: result.email }, targetHost);
  res.redirect(
    302,
    `https://${targetHost}${SSO_CALLBACK_PATH}?token=${encodeURIComponent(token)}&rd=${encodeURIComponent(rd)}`,
  );
});

// Step 2 - reached on the TARGET host. Exchanges the transfer token for a
// host-scoped SSO session cookie, then returns the admin to where they started.
ssoHttpRouter.get("/sso/callback", (req, res) => {
  const host = hostOf(req);
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const rd = typeof req.query.rd === "string" ? req.query.rd : "";

  let claims;
  try {
    claims = verifySsoToken(token, host);
  } catch {
    res.status(401).send("Invalid SSO token");
    return;
  }

  // Open-redirect guard: only bounce back to the same host this cookie is for.
  const dest = targetHostFromReturnUrl(rd) === host ? rd : "/";
  res.cookie(SSO_COOKIE, signSessionToken(claims, host), {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    maxAge: env.SSO_SESSION_TTL_MS,
    path: "/",
  });
  res.redirect(302, dest);
});

// Step 3 - nginx auth_request target on each protected host. 200 + identity
// header when the SSO cookie is valid for this host AND the subject is still a
// super-admin (re-checked against the DB so revocation takes effect at once,
// not after the cookie TTL), else 401.
ssoHttpRouter.get("/sso/verify", async (req, res) => {
  const host = hostOf(req);
  const token = cookiesOf(req)[SSO_COOKIE];
  if (!token) {
    res.status(401).end();
    return;
  }
  try {
    const claims = verifySsoToken(token, host);
    if (!(await isStillSuperAdmin(appDb, claims.sub))) {
      res.status(401).end();
      return;
    }
    res.setHeader("X-Sso-User", claims.email);
    res.status(200).end();
  } catch {
    res.status(401).end();
  }
});
