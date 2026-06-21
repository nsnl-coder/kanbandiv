import { defineConfig, devices } from "@playwright/test";

// Real e2e against a LIVE deployed domain (dev or prod), driving the actual UI as
// a pre-seeded test user. No test DB / MinIO / app boot - E2E_BASE_URL points at
// the running site (e.g. https://dev-app.trello-clone.shop). OTP-dependent flows
// read codes from the Mailtrap sandbox (used in dev AND prod). Per-test
// X-Forwarded-For (support/fixtures.ts) tries to spread the backend's per-IP rate
// limiter; behind Cloudflare it can't fully isolate, so login-heavy assertions
// tolerate the rate-limit message.
const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error(
    "E2E_BASE_URL is required (e.g. https://dev-app.trello-clone.shop or https://app.trello-clone.shop)",
  );
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
