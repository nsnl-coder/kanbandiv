import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { loadTestEnv } from "./support/env";

// Real (non-mocked) frontend e2e: a test backend boots against the dedicated
// `trelloclone-test` Postgres + test MinIO bucket, the Vite dev server proxies
// /trpc + /api to it. Run `tsx support/setup-db.ts` first (the `e2e` script
// does) to migrate the test DB before the backend boots and seeds its admin.
loadTestEnv();

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Several flows send a real email synchronously in the request path, so give
  // assertions more room than the 5s default.
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Test backend: own process on :4000 against the test DB + bucket. Env
      // comes from process.env (loadTestEnv filled it from .env.test locally, or
      // compose set it on the VPS), so no --env-file. Never reuse a running dev
      // backend (that one talks to the dev DB).
      command: "pnpm exec tsx src/index.ts",
      cwd: path.join(repoRoot, "packages", "backend"),
      url: "http://localhost:4000/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter frontend dev",
      cwd: repoRoot,
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
