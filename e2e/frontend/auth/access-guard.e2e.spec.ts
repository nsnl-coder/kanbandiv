import { test, expect } from "../support/fixtures";
import { login, getStore } from "./helpers";
import { resetDb, closeDb, seedUser } from "../support/db";

test.beforeEach(resetDb);
test.afterAll(closeDb);

test.describe("access guard", () => {
  test("must verify email before logging in", async ({ page }) => {
    await seedUser({ email: "unverified@example.com", verified: false });

    await login(page, "unverified@example.com");

    await expect(page.getByRole("alert")).toContainText("not verified");
    await expect(page.getByRole("link", { name: "Resend verification code" })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect((await getStore(page)).user).toBeNull();
  });

  test("protected route redirects to /login with next", async ({ page }) => {
    await page.goto("/projects/new");

    await expect(page).toHaveURL(/\/login\?next=%2Fprojects%2Fnew/);
  });

  test("guests at / see the marketing home, not a redirect", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
  });

  test("user without admin perms cannot reach /admin", async ({ page }) => {
    await seedUser({ email: "user@example.com" });
    await login(page, "user@example.com");
    await expect(page).toHaveURL(/\/projects$/);

    await page.goto("/admin");

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByText("No projects yet.")).toBeVisible();
  });
});
