import { test, expect } from "../support/fixtures";
import { login, PW } from "./helpers";
import { user, freshEmail, allowDestructive } from "../support/users";

test.describe("access guard", () => {
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
    const u = user();
    await login(page, u.email, u.password);
    await expect(page).toHaveURL(/\/projects(\/|$)/);

    await page.goto("/admin");

    // bounced back into the app (no admin permissions)
    await expect(page).toHaveURL(/\/projects(\/|$)/);
  });

  test("must verify email before logging in", async ({ page }) => {
    test.skip(!allowDestructive, "registers a user (no delete-user API); dev-only");
    // Register a fresh account but never verify it, then try to log in.
    const email = freshEmail("unverified");
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByLabel("Confirm password").fill(PW);
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page).toHaveURL(/\/verify-email/);

    await login(page, email, PW);

    await expect(page.getByRole("alert")).toContainText("not verified");
    await expect(page.getByRole("link", { name: "Resend verification code" })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
