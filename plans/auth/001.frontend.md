# 001 - Auth Feature Plan (Frontend)

Auth UI: email + password + OTP flows.
Consumes the tRPC `auth.*` router from the backend plan.

## Decisions

- Access token: held in Zustand store (memory only, never localStorage/sessionStorage).
- Refresh token: httpOnly cookie - browser sends automatically; frontend never touches it.
- Token refresh: silent on 401 via TanStack Query `onError` / axios-style interceptor in the tRPC link.
- Routing: `react-router-dom` v7 (not yet installed).
- Forms: `react-hook-form` + zod resolvers; reuse schemas from `packages/shared`.
- State: Zustand `authStore` (accessToken, user, setAuth, clearAuth).
- Deps to install: `react-router-dom`, `react-hook-form`, `@hookform/resolvers`, `zustand`.

## Stack additions

| Package | Version | Purpose |
|---|---|---|
| `react-router-dom` | ^7 | routing + protected routes |
| `react-hook-form` | ^7 | form state |
| `@hookform/resolvers` | ^4 | zod resolver |
| `zustand` | ^5 | auth token store |

Already present: `@tanstack/react-query`, `@trpc/client`, `superjson`, `tailwindcss`, `zod` (via shared).

## Folder structure

```txt
src/
  config/
    env.config.ts                  # VITE_API_URL etc.

  features/
    auth/
      components/
        AuthForm.tsx               # shared form shell (label + error display)
        PasswordField.tsx          # show/hide toggle
        OtpField.tsx               # 6-digit segmented input
      types.ts                     # AuthUser type (mirrors PUBLIC_USER from backend)

  pages/
    auth/
      RegisterPage.tsx
      LoginPage.tsx
      VerifyEmailPage.tsx          # email pre-filled from router state
      ForgotPasswordPage.tsx
      ResetPasswordPage.tsx
    user/
      ChangePasswordPage.tsx       # inside settings, protected

  components/
    ProtectedRoute.tsx             # redirects to /login if no valid token
    GuestRoute.tsx                 # redirects to / if already authed

  hooks/
    useAuthStore.ts                # Zustand store accessor (accessToken, user)

  lib/
    trpc.ts                        # update: add credentials:'include' + auth header link
    query-client.ts                # add defaultOptions onError -> 401 -> refresh
```

## Auth store (Zustand)

```ts
// hooks/useAuthStore.ts
interface AuthState {
  accessToken: string | null
  user: AuthUser | null
  setAuth: (token: string, user: AuthUser) => void
  clearAuth: () => void
}
```

Never persist to localStorage. Store resets on page reload; `useRefresh` re-hydrates on mount.

## tRPC client update (`lib/trpc.ts`)

Add two links in order:
1. **Auth link** - injects `Authorization: Bearer <accessToken>` from store on every request.
2. **Retry/refresh link** - on `UNAUTHORIZED` TRPCClientError, call `auth.refresh` once, update store, retry original request. If refresh fails, call `clearAuth()` + redirect to `/login`. EXCLUDES credential-checking `auth.*` procedures (login/register/verify/resend/forgot/reset/changePassword/logout/refresh) and only fires when a token already exists - otherwise a bad login would refresh + reload. See "Bugs found".
3. **httpBatchLink** - `credentials: 'include'` so cookies are sent.

## Pages + behavior

### RegisterPage (`/register`)
- Fields: email, password, confirm password.
- On success: redirect to `/verify-email` passing email in router state.
- Error: EMAIL_TAKEN shown inline.

### VerifyEmailPage (`/verify-email`)
- Fields: OTP (6-digit).
- Pre-fills email from router state or query param.
- "Resend code" button (calls `resendVerifyOtp`, rate-limit error surfaced).
- On success: redirect to `/login`.

### LoginPage (`/login`)
- Fields: email, password.
- On success: store access token + user, then **role-based redirect**:
  - `admin` -> `/admin`
  - `user` -> `/`
  - honor `?next=<path>` if present (and allowed for that role), else fall back to the role home.
- Errors: INVALID_CREDENTIALS, UNVERIFIED_EMAIL (show "resend?" link), ACCOUNT_LOCKED.

### ForgotPasswordPage (`/forgot-password`)
- Field: email.
- Always shows "check your inbox" message (no enumeration).
- Link to `/reset-password`.

### ResetPasswordPage (`/reset-password`)
- Fields: email, OTP (8-digit for reset), newPassword, confirm.
- On success: redirect to `/login` with success toast.

### ChangePasswordPage (`/settings/password`) - protected
- Fields: currentPassword, newPassword, confirm.
- On success: toast; other sessions revoked (store unchanged - current session valid per backend).

## ProtectedRoute

Wraps any route requiring auth. Checks `authStore.accessToken != null`. If null, attempts silent refresh first; if that fails, redirects to `/login?next=<current-path>`.
Optional `role` prop: if set and `user.role !== role`, redirect to the user's own role home (no privilege escalation). `/admin/*` routes pass `role="admin"`.

## GuestRoute

Wraps `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`. If already authed, redirects to `?next=` when present, else the role home (`admin` -> `/admin`, `user` -> `/`).

## Error handling conventions

- tRPC `TRPCClientError.data.code` mapped to user-facing messages per procedure.
- Rate-limit (`TOO_MANY_REQUESTS`) shown with remaining-seconds if provided.
- Network error: generic "Connection error, try again."
- Form-level errors (zod): field-level via `react-hook-form` `errors` object.

## Build order

- [x] 1. Install deps: `react-router-dom`, `react-hook-form`, `@hookform/resolvers`, `zustand`
- [x] 2. `config/env.config.ts`: `VITE_API_URL`, `VITE_APP_ENV`
- [x] 3. `hooks/useAuthStore.ts`: Zustand auth store (+ non-React `authStore.getToken()`; dev `window.__authStore`)
- [x] 4. `lib/trpc.ts`: add auth link + refresh-retry link + `credentials:'include'`
- [x] 5. `features/auth/types.ts`: `AuthUser` type
- [x] 6. Shared form primitives: `AuthForm`, `PasswordField`, `OtpField`
- [x] 7. `ProtectedRoute` + `GuestRoute` components
- [x] 8. Pages: Register, Login, VerifyEmail, ForgotPassword, ResetPassword, ChangePassword
      (each uses tanstack `useMutation`/`useQuery`, passing `useTRPC().auth.<proc>.mutationOptions()` /
      `.queryOptions()` - trpc only builds the options, no hook wrappers; matches `App.tsx`)
      (+ `Nav` logout control, `HomePage`, `AdminHomePage` placeholders, `features/auth/utils.ts` error map)
- [x] 9. Router: wire all pages + guards in `App.tsx` (`BrowserRouter` in `main.tsx`)
- [x] 10. Silent refresh: on mount + 401 retry inside the tRPC refresh link
- [x] 11. E2E tests (Playwright, automated, tRPC mocked at network layer) - 18 tests green in `src/e2e/auth/`

NOTE: error codes - backend uses `EMAIL_NOT_VERIFIED` (not `UNVERIFIED_EMAIL`) and `data.code === TOO_MANY_REQUESTS`.
`shared` re-exports `z` (frontend has no direct zod dep); confirm-password via `schema.extend().refine()`.

## Bugs found via E2E + fixes

- [x] **GuestRoute ignored `?next`.** An authed user on `/login?next=X` was redirected to the role home,
  racing/overriding `LoginPage`'s `navigate(next)` (deterministically lost). Fix: `GuestRoute` now reads
  `useSearchParams` and redirects to `next ?? roleHome`. Covered by sign-in "honors ?next after login".
- [x] **Refresh-retry fired on credential failures.** Backend reuses `UNAUTHORIZED` for both expired access
  tokens and bad credentials (`login`, `changePassword` wrong-current). The retry link refreshed + force-
  reloaded `/login` on a failed login, wiping the error message. Fix: `trpc.ts` `NO_REFRESH_RETRY` set
  (all credential-checking `auth.*` procedures) + `authStore.getToken() !== null` guard, so only an
  authenticated request with an expired token refreshes. Covered by sign-in "wrong password" (error stays
  inline, no reload) + change-password "wrong current password".
  GAP: the legitimate refresh-retry path (expired token on a non-auth protected procedure) is currently
  unexercised - no such procedure exists yet. Add an E2E case when the first one lands.
- [x] **GuestRoute never silent-refreshed.** A signed-in user who reloaded onto (or got bounced to) a guest
  route (`/login`) saw the login form instead of their app, because only `ProtectedRoute` re-hydrated via
  the refresh cookie. Fix: `GuestRoute` now mirrors `ProtectedRoute` - attempts `auth.refresh` on mount,
  renders nothing while refreshing, then redirects to `next ?? roleHome`. Test helper: `auth.logout` now
  flips refresh to failing (mirrors backend revocation) so a just-logged-out user isn't resurrected.
  Covered by the new Scenario 9 cases.

## E2E test requirements (automated - Playwright)

Automated browser E2E with **Playwright** against the running dev server (`pnpm dev`).
No MCP here - these run unattended in CI. One scenario = one `test()`.

### Setup
- [ ] Add Playwright to `packages/frontend`; config base URL `http://localhost:5173`, auto-start dev server via `webServer`.
- [ ] OTP retrieval helper: poll the **Mailtrap API** (REST, with API token) for the latest message to the test address; parse 6-digit (verify) / 8-digit (reset) code. (NOT MCP - must be scriptable.)
- [ ] Backend seam to seed verified `admin`/`user` accounts (script or test-only tRPC), so login scenarios don't depend on email each run.

### Conventions
- Unique email per run: `e2e+<timestamp>@example.com`.
- Assert URL via `expect(page).toHaveURL(...)`; store via `page.evaluate(() => window.__authStore.getState())`.
- Reset state per test (fresh email or DB truncate seam).

### Scenario 1 - Sign up + verify email + login (happy path)
- [ ] `goto('/register')`; fill email (unique), password, confirm; submit
- [ ] Assert URL is `/verify-email`; assert store accessToken still null
- [ ] Fetch verify OTP (6-digit) via Mailtrap API helper
- [ ] Fill OTP; submit; assert URL is `/login`
- [ ] Wrong code first: fill wrong OTP -> assert error shown, no redirect
- [ ] Fill email + password; submit login; assert URL is `/`
- [ ] Assert `window.__authStore` accessToken non-null

### Scenario 2 - Sign up duplicate email
- [ ] Register with an already-registered email -> assert EMAIL_TAKEN shown inline

### Scenario 3 - Verify email before app access (guard)
- [ ] Register a fresh user, do NOT verify
- [ ] Attempt login -> assert EMAIL_NOT_VERIFIED message + "Resend verification code" link
- [ ] Assert no redirect; store accessToken still null
- [ ] `goto('/')` (protected) while unverified/unauth -> assert redirect to `/login`

### Scenario 4 - OTP resend rate-limit
- [ ] Register; `goto('/verify-email')`; click "Resend" 3 times
- [ ] Assert 4th click shows rate-limit message

### Scenario 5 - Sign in (role redirect + errors)
- [ ] Seed verified `user`; login -> assert URL `/`, `user.role === "user"`
- [ ] Seed verified `admin`; login -> assert URL `/admin`, `user.role === "admin"`
- [ ] User logged in -> `goto('/admin')` -> assert redirect to `/` (role guard)
- [ ] Wrong password -> assert INVALID_CREDENTIALS, no redirect
- [ ] `?next=` honored: `goto('/login?next=/settings/password')`, login -> lands on `/settings/password`

### Scenario 6 - Forgot password + reset (happy path)
- [ ] `goto('/forgot-password')`; fill email; submit; assert "check inbox" shown
- [ ] Assert same message for unknown email (no enumeration)
- [ ] Fetch reset OTP (8-digit) via Mailtrap API helper
- [ ] `goto('/reset-password')`; fill email, OTP, new password; submit; assert URL `/login`
- [ ] Login with new password -> success
- [ ] Old password no longer works -> INVALID_CREDENTIALS
- [ ] Wrong reset OTP -> assert error, no redirect

### Scenario 7 - Protected route without auth
- [ ] `goto('/settings/password')` unauthenticated -> assert redirect to `/login?next=/settings/password`

### Scenario 8 - Change password (protected)
- [ ] Login (seeded verified user); `goto('/settings/password')`
- [ ] Fill currentPassword, newPassword, confirm; submit; assert success message
- [ ] Wrong current password -> assert error

### Scenario 9 - Silent refresh re-hydration
- [x] Login; reload page (`page.reload()`)
- [x] Assert store user still populated (refresh cookie re-hydrated session)
- [x] Reload on a protected deep route (`/settings/password`) -> URL preserved, NOT bounced to `/login`
- [x] Signed-in cookie + `goto('/login')` -> redirected to user page `/` (not the login form)
- [x] Signed-in admin + `goto('/login')` -> redirected to `/admin`
- [x] Signed-in cookie + `goto('/login?next=/settings/password')` -> redirected to `/settings/password`

### Scenario 10 - Logout
- [ ] Login; click logout; assert URL `/login`
- [ ] Assert store accessToken null
- [ ] `goto('/')` -> assert redirect back to `/login`

## MCP smoke testing (manual / exploratory - no checkboxes)

Driven ad-hoc via chrome-devtools MCP + Mailtrap MCP for quick manual verification during dev.
Not part of CI; no checkboxes (not a completion gate).

- chrome-devtools MCP: `new_page` -> `navigate_page` -> `fill` / `click` -> `evaluate_script(window.__authStore)` / `take_screenshot`.
- Mailtrap MCP: read the latest inbox message to grab the OTP when manually walking a flow.
- Use for: visually confirming a page renders, eyeballing a redirect, capturing a screenshot for a PR, or debugging a flow before writing the Playwright version.

## Deferred

- Social OAuth (Google) - not planned yet.
- Token storage in ServiceWorker - not needed at current scale.
- i18n of error messages - deferred to UX pass.
