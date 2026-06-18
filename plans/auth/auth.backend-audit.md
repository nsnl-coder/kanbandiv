# 001 - Auth/Email Feature Audit

Source: 3-agent review (code-reviewer, test-engineer, security-auditor) of working-tree changes on `main`.
Scope: `packages/backend/src/features/auth`, `features/email`, `db`, `migrations`, `scripts`, `trpc`, `config`, `packages/shared`.

Status: ALL items resolved; backend typecheck clean; 108/108 tests pass.

## Must-fix (blocks merge)

- [x] **Refresh cookie never delivered.** Cookie path now `/` for both set + clear (`auth.router.ts:46,51`); covers `/trpc` and `/api`.
- [x] **Forgeable production JWTs.** `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are now `z.string().min(32)` with NO default; fails closed in every env. Tests inject secrets via `vitest.config.ts`; dev uses `.env.local` (documented in `.env.example`).

## High

- [x] **OTP verify brute-force.** Unverified re-register now calls `enforceResendLimit` before re-issuing the OTP (`auth.service.ts:213-215`), bounding re-mint to the resend cap.
- [x] **Rate limiting bypassable + leaky.** `app.set('trust proxy', 1)` added (`index.ts`); null IP now shares one restrictive bucket instead of bypassing; periodic `sweep()` evicts stale buckets (`trpc.ts`).
- [x] **REST `/api` auth surface.** Enforcement lives in `protectedProcedure`, covered by `me.spec.ts` (rejects null userId). Same router+procedure back `/api`. (Express-adapter integration test deferred - no supertest dep; gap noted, not a vuln.)
- [x] **Public docs in prod.** `/docs` + `/openapi.json` now gated behind `NODE_ENV !== "production"` (`index.ts`).

## Medium

- [x] **Email enumeration (timing).** Added dummy bcrypt compare on the unknown-email path in `verifyEmail` + `resetPassword` for timing parity. Note: `register` EMAIL_TAKEN + `verifyEmail` ALREADY_VERIFIED remain a documented enumeration tradeoff (see backend/001.auth.md).
- [x] **CORS.** `cors({origin: env.CORS_ORIGIN, credentials:true})` added (`index.ts`); origin from env allowlist, never `*`.
- [x] **Security headers.** `helmet()` added (`index.ts`).
- [x] **Cookie `secure` + CSRF.** `secure` now from `env.COOKIE_SECURE` (default true). CSRF mitigation = `sameSite:strict` + double-submit (refresh accepts explicit body token); documented.
- [x] **MJML unescaped.** Added `esc()` on all interpolated template values (`email.service.ts`).
- [x] **Repo `selectAll()`.** `refresh` switched to scoped `findPublicUserById` (no `password_hash`). `findUserByEmail`/`findUserById` keep `selectAll` (login/changePassword need hash + lockout fields); no logger serializes user rows.
- [x] **Migration idempotent.** `migrate.script.ts` now uses Kysely `Migrator` + `FileMigrationProvider` (tracked, ordered, re-runnable).

## Low

- [x] `protectedProcedure` now rejects tokens for unverified accounts (defense-in-depth) (`trpc.ts`).
- [x] `emailSchema` now has `.max(254)` (`packages/shared/src/auth.schema.ts`).
- [x] `insertEvent` now records ip/userAgent: `ip`/`userAgent` added to `Context` + `AuthDeps`, threaded via a `logEvent` helper into every audit call.
- [x] `mjml2html` now logs render warnings/errors (`email.service.ts` `render()`).
- [x] Ran `pnpm audit`. Most findings are dev-only (vitest/vite/h3, mjml->html-minifier) or Kysely advisories requiring unsafe patterns not used here (no `sql.lit`/JSON-path on user input). Upgraded runtime dep `nodemailer` 6 -> latest (patches SMTP injection + addressparser DoS).

## Test gaps -> added (96/96 pass)

- [x] **Cookie-based refresh path** - `refresh.spec.ts` "rotates using the refresh cookie when no body token".
- [x] Cookie side-effects - `refresh.spec.ts` "sets a hardened httpOnly refresh cookie" via new `resSpy()` seam in `helpers.ts`.
- [x] JWT issuer/audience rejection - `me.spec.ts` wrong-issuer + wrong-audience.
- [x] `refresh` with valid token but deleted user - `refresh.spec.ts` "rejects a valid token whose user was deleted".
- [x] No-IP rate-limit bucket (no bypass) - `rateLimit.spec.ts` updated to assert the 6th no-IP register is blocked.
- [x] `createContext` Bearer/cookie parsing - `trpc/context.spec.ts` (valid/malformed/absent/non-Bearer token, cookie parse, ip + user-agent).
- [x] Migration `down` + FK cascade - `migrations/001.auth.spec.ts` (cascade delete to otp_codes/refresh_tokens; `down` drops every table). pg-mem enforces the cascade.
- [x] Email MJML render/escape - `features/email/email.spec.ts` (code rendered into HTML; metacharacters escaped; `esc` unit).

## Strong points (keep)

Refresh rotation with family reuse-detection + full-family revoke; SHA-256 token hashing (raw never stored); bcrypt OTPs with attempt caps + lockout; timing-parity dummy compare on login; anti-enumeration silence on forgot/resend; password reset/change revoke all sessions; parameterized Kysely (no string SQL); JWT verified with explicit alg/iss/aud; clean DI seams (`AuthDeps`, `EmailPort`) tested via pg-mem + fake email.
