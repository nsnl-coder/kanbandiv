import jwt from "jsonwebtoken";
import { env } from "../../config/env.config.js";
import { verifyAccessToken } from "../auth/auth.service.js";
import { findUserGlobalPerms, type Db } from "../rbac/rbac.repo.js";

// Forward-auth for admin-only access to Grafana/MinIO living on other subdomains.
// The app session cookie is host-only to the app, so it can't be read on those
// subdomains. Instead the app host mints a short-lived, audience-bound token; the
// target host exchanges it for its own SSO session cookie (see sso.http.ts).

const SSO_ISS = "trello-sso";
export const SSO_COOKIE = "sso_admin";
// nginx path on each protected host that proxies to /api/sso/callback.
export const SSO_CALLBACK_PATH = "/__sso/callback";
// URL-transfer token is single-hop; keep it very short-lived.
export const TRANSFER_TTL_SEC = 120;

export interface SsoClaims {
  sub: string;
  email: string;
}

/** Sign an audience-bound SSO token (HS256). `audience` is the target host. */
export function signSsoToken(
  claims: SsoClaims,
  audience: string,
  ttlSec: number,
): string {
  return jwt.sign({ email: claims.email }, env.SSO_SECRET, {
    algorithm: "HS256",
    subject: claims.sub,
    audience,
    issuer: SSO_ISS,
    expiresIn: ttlSec,
  } as jwt.SignOptions);
}

/** Verify a token, requiring it was minted for exactly this `audience` host. */
export function verifySsoToken(token: string, audience: string): SsoClaims {
  const p = jwt.verify(token, env.SSO_SECRET, {
    algorithms: ["HS256"],
    audience,
    issuer: SSO_ISS,
  }) as jwt.JwtPayload & { email?: string };
  return { sub: String(p.sub), email: p.email ?? "" };
}

export function signTransferToken(claims: SsoClaims, audience: string): string {
  return signSsoToken(claims, audience, TRANSFER_TTL_SEC);
}

export function signSessionToken(claims: SsoClaims, audience: string): string {
  return signSsoToken(claims, audience, Math.floor(env.SSO_SESSION_TTL_MS / 1000));
}

/** True only for hosts in the configured allowlist (prevents token minting for arbitrary hosts). */
export function isAllowedHost(
  host: string,
  allow: readonly string[] = env.SSO_ALLOWED_HOSTS,
): boolean {
  return host.length > 0 && allow.includes(host);
}

/** Extract the host from a return URL; null if unparseable or non-http(s). */
export function targetHostFromReturnUrl(rd: string): string | null {
  try {
    const u = new URL(rd);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.host;
  } catch {
    return null;
  }
}

/**
 * Re-check that an SSO subject is still a super-admin. Used on every /sso/verify
 * so a demoted/deleted admin loses console access at once, not after the cookie
 * TTL (revocation defense for Portainer/pgAdmin/Grafana behind the gate).
 */
export async function isStillSuperAdmin(db: Db, sub: string): Promise<boolean> {
  const { isSuperuser } = await findUserGlobalPerms(db, sub);
  return isSuperuser;
}

export type AdminResolution =
  | { status: "unauthenticated" }
  | { status: "forbidden"; sub: string; email: string }
  | { status: "ok"; sub: string; email: string };

/**
 * Decide whether the app session cookie belongs to a super-admin. Re-reads the
 * DB so a revoked/deleted user is rejected even with a still-valid access token.
 */
export async function resolveAdmin(
  db: Db,
  accessToken: string | undefined,
): Promise<AdminResolution> {
  if (!accessToken) return { status: "unauthenticated" };
  let sub: string;
  let email: string;
  try {
    const p = verifyAccessToken(accessToken);
    sub = p.sub;
    email = p.email;
  } catch {
    return { status: "unauthenticated" };
  }
  const { isSuperuser } = await findUserGlobalPerms(db, sub);
  if (!isSuperuser) return { status: "forbidden", sub, email };
  return { status: "ok", sub, email };
}
