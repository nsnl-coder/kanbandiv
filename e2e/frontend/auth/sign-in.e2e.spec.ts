import { test, expect } from "../support/fixtures";
import { login } from "./helpers";
import { user, admin } from "../support/users";

test.describe("sign in", () => {
  test("user lands in the app", async ({ page }) => {
    const u = user();
    await login(page, u.email, u.password);

    // A regular user goes to /projects (or straight into their first project).
    await expect(page).toHaveURL(/\/projects(\/|$)/);
  });

  test("admin lands in /admin", async ({ page }) => {
    const a = admin();
    await login(page, a.email, a.password);

    await expect(page).toHaveURL(/\/admin/);
  });

  test("wrong password does not authenticate", async ({ page }) => {
    const u = user();
    await login(page, u.email, "wrong-password-x9");

    await expect(page.getByRole("alert")).toContainText("Invalid credentials");
    await expect(page).toHaveURL(/\/login/);
  });

  test("honors ?next after login", async ({ page }) => {
    const u = user();
    await page.goto("/login?next=/projects/new");
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password", { exact: true }).fill(u.password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/projects\/new/);
  });
});
