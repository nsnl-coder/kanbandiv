import { test } from "@playwright/test";

// TODO(real-e2e): convert the admin backup flows to the real backend. Needs an
// RBAC role seeded with admin:backup:read / :manage, real backup settings rows,
// and a stubbed Drive connection. Skipped while the auth suite lands first.
test.describe.skip("admin backup", () => {
  test("pending real-backend conversion", () => {});
});
