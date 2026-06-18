# 001 - Auth Feature Plan (email + password + OTP)

Auth via email + password. OTP for email verification and forgot-password reset.
Revised after test-engineer + security-auditor review.

## Decisions

- Tokens: JWT access (short-lived, ~15 min) + DB-stored rotating refresh token (~7-30d, absolute cap).
- Token transport: refresh token in httpOnly + Secure + SameSite=Strict cookie; access token returned in body (client holds in memory). CSRF: SameSite + custom-header check on mutations.
- Test DB: pg-mem (in-memory Postgres), per `.claude/rules/backend.md`.
- Schemas: shared zod schemas in new `packages/shared` (reused by frontend + backend).

## Stack (from .claude/rules/backend.md)

tRPC + superjson, kysely, pg, bcrypt, jsonwebtoken, mjml + nodemailer + mailtrap, zod, swagger, vitest + pg-mem.

## DB schema (kysely migration `001.auth.ts`)

- `users`: id, email (unique, citext or lowercased), password_hash, email_verified (bool), role (`admin` | `user`), failed_login_count, locked_until (nullable), created_at, updated_at
- `otp_codes`: id, user_id (fk), code_hash, purpose (`verify_email` | `reset_password`), expires_at, consumed_at, attempts, created_at
- `refresh_tokens`: id, user_id (fk), token_hash, family_id, parent_id (nullable), expires_at, revoked_at, reused_at (nullable), created_at
- `auth_events`: id, user_id (nullable), event, ip, user_agent, outcome, created_at  (audit; never logs codes/tokens/passwords)

Rules:
- OTP: 6-digit (8 for reset), CSPRNG (`crypto.randomInt`), hashed at rest (bcrypt), 10-min expiry, single-use.
- OTP attempt cap per row AND sliding-window lock per (user, purpose); resend cap (e.g. 3/hour). On max attempts, invalidate OTP, force re-request.
- bcrypt cost >= 12; reject passwords > 72 bytes (bcrypt truncation). [DONE]
- OTP attempt cap per row [DONE] + resend cap per (user,purpose) [DONE]; separate sliding-window verify-lock not added (resend cap bounds brute force).
- Cleanup job purges expired/revoked tokens + consumed/expired OTPs. [DONE: `cleanupExpired` + `pnpm cleanup` script]

## Security hardening (from security-auditor)

- [x] JWT: pin `algorithms:['HS256']` on verify, set on sign; set + verify `iss`/`aud`; no default secret in prod. NOTE: refresh tokens are opaque (sha256), not JWTs, so `JWT_REFRESH_SECRET` is defined but unused (separate-secret requirement is N/A by design).
- [x] Env validation at startup: zod parse, secrets length >= 32 (now REQUIRED in every env, no env-gated default), fail fast. Tests inject secrets via `vitest.config.ts`; dev uses `.env.local`.
- [x] Refresh reuse detection: `family_id`; reuse of a revoked token revokes entire family + sets `reused_at` + audit event.
- [x] Enumeration parity: `login` generic INVALID_CREDENTIALS for unknown/wrong-pw + dummy bcrypt compare. `register` duplicate throws EMAIL_TAKEN (oracle tradeoff documented).
- [x] Endpoint rate limiting (per-IP): in-memory sliding-window middleware (`rateLimitedProcedure`) on register/login/verify/resend/refresh/forgot/reset. Plus per-account limits (resend cap, login lockout). (Redis-backed store for multi-instance still TODO.)
- [x] Account lockout: temp lock after MAX_FAILED_LOGINS, auto-unlock via `locked_until`, notify email on lock.
- [x] CSPRNG for OTP (`crypto.randomInt`), constant-time compare via bcrypt on hash.
- [x] Serialization safety: `PUBLIC_USER` select-list; `me`/repo exclude `password_hash`, `code_hash`, `token_hash`.
- [x] Audit logging: register, login success/fail, reset, refresh reuse, OTP issue, OTP verify fail.

### Post-audit hardening (see ../001.audit.md)
- [x] Secrets required in all envs (no committed fallback); `COOKIE_SECURE` env (default true) drives the cookie Secure flag.
- [x] Refresh cookie path `/` (was `/trpc/auth`, which never matched `/trpc/auth.refresh` per RFC 6265).
- [x] `helmet()` + `cors({origin: env.CORS_ORIGIN, credentials:true})` + `app.set('trust proxy', 1)`; `/docs`+`/openapi.json` gated to non-prod.
- [x] Rate limiter: no-IP no longer bypasses (shared restrictive bucket); periodic eviction sweep bounds memory.
- [x] Unverified re-register applies the resend cap (closes OTP re-mint brute-force).
- [x] Timing-parity dummy bcrypt on unknown-email in `verifyEmail`/`resetPassword`.
- [x] MJML interpolation HTML-escaped; render warnings logged.
- [x] `refresh` uses scoped `findPublicUserById` (no `password_hash` in memory).
- [x] Migrations run via Kysely `Migrator` + `FileMigrationProvider` (idempotent/tracked).
- [x] `protectedProcedure` rejects unverified accounts (defense-in-depth).
- [x] `insertEvent` records `ip`/`userAgent` (threaded via `Context` -> `AuthDeps` -> `logEvent`).
- [x] Added tests: `trpc/context.spec.ts`, `migrations/001.auth.spec.ts` (down + FK cascade), `features/email/email.spec.ts` (render + escape).
- ENUMERATION TRADEOFF (kept): `register` -> EMAIL_TAKEN and `verifyEmail` -> ALREADY_VERIFIED still reveal a verified account exists. Accepted for UX; silent paths (`forgot`/`resend`) unchanged.

## Folder structure

```txt
packages/shared/
  src/auth.schema.ts          # zod schemas + inferred types + AuthRole enum

packages/backend/src/
  config/env.config.ts        # + DB url, JWT secrets/TTLs, mailtrap creds, validation
  db/                         # kysely instance + Database types
  migrations/001.auth.ts      # users, otp_codes, refresh_tokens, auth_events
  features/
    email/email.service.ts    # mjml templates + nodemailer (mailtrap)
    auth/
      test/                   # one .spec.ts per endpoint (pg-mem integration)
        helpers.ts            # pg-mem boot, fresh-db reset, createCaller, authedCaller,
                              # seedUser, seedOtp, getLastEmail (OTP capture), fake clock
        register.spec.ts
        verifyEmail.spec.ts
        resendVerifyOtp.spec.ts
        login.spec.ts
        refresh.spec.ts
        logout.spec.ts
        forgotPassword.spec.ts
        resetPassword.spec.ts
        me.spec.ts
      auth.repo.ts            # kysely queries (users, otp, tokens, events)
      auth.service.ts         # otp hash/expiry/attempts, pw hash, token rotation, clock-injected
      auth.router.ts          # tRPC procedures
  trpc/
    context.ts                # + access-token verify (alg pinned), inject user
    trpc.ts                   # + protectedProcedure, rateLimit middleware
```

## Endpoints (tRPC procedures under `auth.*`)

| Procedure | Type | Input | Behavior |
|---|---|---|---|
| `auth.register` | mutation | email, password | create unverified user, hash pw, send verify OTP |
| `auth.verifyEmail` | mutation | email, otp | validate OTP, set email_verified |
| `auth.resendVerifyOtp` | mutation | email | re-issue verify OTP (rate-limited, silent) |
| `auth.login` | mutation | email, password | check pw + verified, issue access + refresh; lockout on abuse |
| `auth.refresh` | mutation | refreshToken (cookie) | rotate refresh, new access; reuse -> revoke family |
| `auth.logout` | mutation | refreshToken (cookie) | revoke this refresh token only |
| `auth.forgotPassword` | mutation | email | send reset OTP (always 200, no enumeration) |
| `auth.resetPassword` | mutation | email, otp, newPassword | validate OTP, set new pw, revoke all sessions |
| `auth.changePassword` | mutation | currentPassword, newPassword (auth) | verify current, set new, revoke other sessions |
| `auth.me` | query | (auth) | current user from access token |

## tRPC middleware

- `protectedProcedure`: verifies access token (alg pinned, iss/aud) in context, injects `user`.
- `rateLimit`: per-IP + per-account limiter on sensitive procedures.

## Tests (vitest)

Rule: one `.spec.ts` per endpoint under `features/auth/test/`, integration on pg-mem.

### Test helper / setup (helpers.ts)
- [x] Boot pg-mem; register `gen_random_uuid` (or generate ids in app code).
- [x] Fresh DB (or truncate) in `beforeEach`.
- [x] `createCaller(ctx)` + `authedCaller(user)` (inject user/token).
- [x] Fake clock (`vi.useFakeTimers` / injected `now()`) for all TTL/expiry/rate-limit cases.
- [x] Fake EmailService spy; capture plaintext OTP via send args (codes hashed at rest).
- [x] Seed helpers: `seedUser({verified, role, locked})`, `seedOtp({purpose, expired, attempts, consumed})`.
- [x] Keep TTL logic in app code (injected clock), not SQL `expires_at < now()` (pg-mem interval quirks).
- [x] Document as known gap: true concurrency/race tests (pg-mem single-threaded) - rely on unique constraint + app guard.

### register.spec.ts
- [x] creates user (unverified), no tokens issued, not verified
- [x] hashes password (stored hash != plaintext), cost >= 12
- [x] sends verify OTP on success (email spy called)
- [x] rejects duplicate email (verified user)
- [x] duplicate email when existing user unverified -> defined behavior (error vs re-send)
- [x] case-insensitive uniqueness (`A@x.com` vs `a@x.com`)
- [x] normalizes email (trim + lowercase)
- [x] rejects invalid email format (zod)
- [x] rejects weak password; min-length boundary (pass at min, fail one below)
- [x] rejects password > 72 bytes

### verifyEmail.spec.ts
- [x] success: valid OTP sets email_verified = true
- [x] consumes OTP (single-use, replay rejected)
- [x] rejects wrong OTP code
- [x] rejects expired OTP (fake clock)
- [x] rejects OTP for unknown email
- [x] rejects wrong-purpose OTP (reset code on verify)
- [x] rejects when already verified
- [x] increments attempts on wrong code; locks at max-attempts boundary (N ok, N+1 locked)
- [x] locked OTP rejects even with correct code
- [x] rejects invalid OTP format (non-6-digit/non-numeric) via zod

### resendVerifyOtp.spec.ts
- [x] success: issues new verify OTP
- [x] invalidates previous unconsumed verify OTP
- [x] resets attempts counter on re-issue
- [x] rate-limit boundary: just-before rejects, just-after allows (fake clock)
- [x] resend cap enforced (e.g. 3/hour)
- [x] silent no-op for unknown email; same response shape/timing as success
- [x] rejects when already verified

### login.spec.ts
- [x] success: returns access token + sets refresh cookie
- [x] refresh token persisted hashed (stored != returned)
- [x] access token verifiable (signature + alg), payload carries id + role
- [x] generic error for wrong password (no user-existence leak)
- [x] generic error for unknown email (dummy bcrypt compare, timing parity)
- [x] rejects unverified email (no tokens issued)
- [x] empty email/password rejected by zod
- [x] failed_login_count increments; lockout after N; locked account rejected until unlock
- [x] audit event recorded on success + failure

### refresh.spec.ts
- [x] success: valid refresh rotates, new access + new refresh (persisted hashed)
- [x] old refresh revoked after rotation
- [x] reuse of rotated/revoked token rejected AND revokes entire family
- [x] rejects expired refresh (fake clock)
- [x] rejects malformed/unknown token
- [x] refresh fails after sessions revoked (post reset/change password)
- [x] rotates using the refresh cookie when no body token is given (cookie fallback)
- [x] rejects when no token in body or cookie
- [x] sets a hardened httpOnly+strict+path=/ refresh cookie on success (via resSpy)
- [x] rejects a valid token whose user was deleted

### logout.spec.ts
- [x] success: revokes the provided refresh token
- [x] revoked token unusable on refresh afterward
- [x] does NOT revoke other sessions (only this token)
- [x] idempotent: already-revoked/unknown token does not error
- [x] malformed token shape rejected by zod

### forgotPassword.spec.ts
- [x] existing email: issues reset OTP, returns 200
- [x] non-existing email: returns 200, no OTP issued (no enumeration)
- [x] response shape/timing identical existing vs non-existing
- [x] invalidates previous unconsumed reset OTP
- [x] rate-limit boundary (fake clock)
- [x] does not change password / leak in payload

### resetPassword.spec.ts
- [x] success: valid OTP sets new password hash
- [x] can log in with new password; old password no longer works
- [x] revokes ALL refresh tokens end-to-end (old refresh now fails on `refresh`)
- [x] consumes OTP (single-use, replay rejected)
- [x] rejects wrong OTP
- [x] rejects expired OTP (fake clock)
- [x] rejects wrong-purpose OTP (verify code on reset)
- [x] attempts increment + lockout boundary
- [x] rejects weak / >72-byte new password

### changePassword.spec.ts
- [x] success: verifies current password, sets new
- [x] rejects wrong current password
- [x] revokes other sessions, keeps current
- [x] requires auth (rejects unauthenticated)
- [x] rejects weak new password

### me.spec.ts
- [x] success: valid token returns current user; response excludes password_hash + token/code fields
- [x] role present and correct
- [x] rejects missing token (unauthorized)
- [x] rejects invalid/malformed token
- [x] rejects expired access token (fake clock)
- [x] rejects token signed with wrong secret / wrong alg
- [x] rejects token with wrong issuer / wrong audience
- [x] rejects valid-signature token for deleted/non-existent user

## Build order

- [x] 1. `packages/shared`: zod schemas + types + `AuthRole` enum
- [x] 2. backend deps: kysely, pg, pg-mem, bcryptjs, jsonwebtoken, nodemailer, mjml, vitest, types
- [x] 3. `config/env.config.ts`: DB url, JWT secrets/TTLs, mailtrap creds + startup validation
- [x] 4. `db/`: kysely instance + `Database` types
- [x] 5. `migrations/001.auth.ts`: users, otp_codes, refresh_tokens, auth_events
- [x] 6. `features/email/email.service.ts`: mjml + nodemailer
- [x] 7. `features/auth/`: repo, service, router (10 procedures)
- [x] 8. `trpc/`: protectedProcedure + context user injection (alg pinned)
- [x] 9. tests: `helpers.ts` + one `<endpoint>.spec.ts` per endpoint (pg-mem) -> 80 tests green

## Implementation notes / deviations
- bcrypt -> bcryptjs (native bcrypt failed to compile; no Windows build toolchain). Same API + `$2a/$2b` format.
- Per-IP rate-limit middleware implemented (in-memory sliding window) PLUS account/window limits (resend cap, login lockout).
- Login returns `refreshToken` in the body (for SPA/tests) AND sets the httpOnly cookie when `res` is present.
- Refresh-token rate-limit window uses the DB clock (`otp_codes.created_at` via `now()`), not JS `Date`.
- Swagger: `trpc-to-openapi@2.4.0` (zod v3 compatible) generates an OpenAPI 3 doc from the router; served at `/docs` (Swagger UI) + `/openapi.json`, REST layer at `/api`. Each procedure has `.meta({openapi})` + `.output()` schema. Verified: server boots, `/openapi.json` + `/docs` return 200.
## Deferred (come back later - intentionally not done now, no checkbox)
- Redis-backed rate-limit store: current per-IP limiter is in-memory, so it does not share counts across multiple backend instances. Move to Redis (or a pg counter) before horizontal scaling.
- Cleanup scheduling: `cleanupExpired` + `pnpm cleanup` exist but are not scheduled. Add a cron / scheduled job to run it periodically in dev/prod.
