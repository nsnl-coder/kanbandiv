import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Real e2e against a LIVE deployed domain (dev or prod), driving the actual UI as
// a pre-seeded test user. No Docker, no test DB / MinIO / app boot - the specs
// hit the public URL, so they run anywhere with network access (locally, VPS, or
// CI). OTP-dependent flows read codes from the Mailtrap sandbox (dev AND prod).
// Per-test X-Forwarded-For (support/fixtures.ts) tries to spread the backend's
// per-IP rate limiter; behind Cloudflare it can't fully isolate, so login-heavy
// assertions tolerate the rate-limit message.

// On the VPS the E2E_* creds + MAILTRAP_API_TOKEN live in packages/infra/.env;
// load them when present so `pnpm --filter e2e-frontend e2e` works without a
// wrapper. Locally, set the same vars in your shell/.env instead.
const envFile = resolve(process.cwd(), "../../packages/infra/.env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// Default the target site + destructive flag from the tier (VPS_ENV) unless set.
// Destructive specs (user creation / password change) run on dev only; prod NEVER
// runs them, so an accidental prod run can't disturb real users.
const tier = process.env.VPS_ENV ?? "dev";
const baseURL =
  process.env.E2E_BASE_URL ??
  (tier === "prod"
    ? "https://app.trello-clone.shop"
    : "https://dev-app.trello-clone.shop");
if (process.env.E2E_ALLOW_DESTRUCTIVE === undefined) {
  process.env.E2E_ALLOW_DESTRUCTIVE = tier === "prod" ? "false" : "true";
}

// Parallelism is safe wherever the per-IP rate limiter can't bite: test-user
// requests are is_test=true (limiter-exempt by email) and each login opens its
// own refresh-token family. The only non-exempt calls are a few brand-new-email
// registers + one forgot-unknown, all well under their per-IP caps (register=5,
// forgot=5 / min). LOCAL has no Cloudflare hop, so it goes widest; DEV pools into
// one CF IP, so cap workers to keep non-exempt registers (incl. retries) under 5.
// PROD stays serial (it skips destructive specs and runs almost nothing anyway).
const isLocal = /localhost|127\.0\.0\.1/.test(baseURL);
const parallel = isLocal || tier !== "prod";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.spec.ts",
  fullyParallel: parallel,
  workers: isLocal ? "75%" : parallel ? 4 : 1,
  // Parallel runs can briefly burst (Mailtrap "emails/second" cap on the one
  // real-email spec, or a transient CF-IP limit); a retry runs after it clears.
  forbidOnly: !!process.env.CI,
  retries: 1,
  reporter: process.env.CI ? "github" : "list",
  // Several flows send a real email synchronously in the request path, so give
  // assertions more room than the 5s default.
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
