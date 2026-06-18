# Auth Branch Audit — Action Items

Source: 3-agent audit (code-reviewer, security-auditor, test-engineer) of the auth branch changes.

Status: all fixed. Backend 111 tests pass; backend + frontend typecheck clean.

## Critical

- [ ] Rotate leaked Mailtrap API token in Mailtrap dashboard. **(user action — I cannot rotate)** Precautionary only: `.mcp.json` was never committed (untracked), so it never reached git history.
- [x] Add `.mcp.json` to `.gitignore`; commit `.mcp.json.example` with placeholders.
- [x] Verify token never landed in git history before pushing. (Confirmed: `git log -- .mcp.json` empty.)

## Security

- [x] CSRF defense-in-depth: `csrfGuard` on `/trpc` requires `x-requested-with: XMLHttpRequest` on non-GET; frontend tRPC client sends it. Browsers cannot set it cross-site without a (failing) preflight. (`index.ts`, `lib/trpc.ts`)
- [x] Collapse access TTL: removed `ACCESS_TTL_MS` env var; cookie maxAge derived from `JWT_ACCESS_TTL` via `parseDurationMs` (`env.config.ts`).
- [x] Remove body-supplied `refreshToken`: `refreshInput`/`logoutInput` now `z.object({})`; `refreshTokenFrom` reads the cookie only (`auth.schema.ts`, `auth.router.ts`).
- [x] Ran `pnpm audit`. New deps (react-router-dom@7, zustand@5, @playwright/test) clean. Bumped `kysely` 0.27→0.28.14 (SQLi advisory). Remaining h3/mjml/html-minifier are transitive with no upstream fix.

## Tests

- [x] `logout` asserts both `access_token` and `refresh_token` cleared with `{ path: "/" }` (`logout.spec.ts`).
- [x] End-to-end cookie auth: login-issued `access_token` fed through real `createContext`, then `auth.me` returns the seeded user (`login.spec.ts`).
- [x] Assert access cookie `maxAge === ACCESS_TTL_MS` + `secure`; refresh cookie `maxAge === REFRESH_TTL_MS` (`login.spec.ts`, `refresh.spec.ts`).
- [x] Context cases: empty `access_token=` cookie -> userId null; both cookies present parsed independently (`context.spec.ts`).
- [x] Assert cookie defined before use; dropped `as string` cast in `login.spec.ts`.

## Code Review

- [x] Removed `window.location.href="/login"` hard reload; store-clear lets the guard redirect with `?next=` preserved (`lib/trpc.ts`).
- [x] Replaced `NO_REFRESH_RETRY` denylist with server-side `SESSION_EXPIRED` message tag on `protectedProcedure`; client refreshes only on that (`trpc.ts` backend + frontend, `auth.error.ts`).
- [x] Moved e2e to `packages/frontend/e2e/<feature>/*.e2e.spec.ts` per rule; updated `playwright.config.ts`; removed now-unneeded `tsconfig` exclude.
- [x] Import `AuthError` from `shared` everywhere; removed the re-export from `auth.service.ts`.
- [x] Consolidated boot refresh into App's single hydration gate; `ProtectedRoute`/`GuestRoute` now read the store only.
- [x] Confirmed nginx proxies `/trpc` to `backend:4000` same-origin (`nginx.conf`).
