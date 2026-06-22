import { defineConfig } from "vitest/config";

// Inject test-only secrets so env.config.ts (which now requires them
// unconditionally) parses without a committed default.
export default defineConfig({
  test: {
    setupFiles: ["./src/test.setup.ts"],
    // bcrypt + real-timing auth tests can exceed the 5s default under the
    // CPU contention of the full parallel suite.
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      JWT_ACCESS_SECRET: "test_access_secret_0123456789abcdef0123456789",
      JWT_REFRESH_SECRET: "test_refresh_secret_0123456789abcdef0123456789",
    },
  },
});
