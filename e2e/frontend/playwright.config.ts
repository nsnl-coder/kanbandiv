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

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
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
