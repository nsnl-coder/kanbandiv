import { test, expect } from "../support/fixtures";
import { login } from "./helpers";
import { user } from "../support/users";

test.describe("session", () => {
  test("silent refresh re-hydrates the session on reload", async ({ page }) => {
    const u = user();
    await login(page, u.email, u.password);
    await expect(page).toHaveURL(/\/projects(\/|$)/);

    await page.reload();
    await expect(page).toHaveURL(/\/projects(\/|$)/);
  });

  test("reloading on a protected route keeps the user there, not /login", async ({ page }) => {
    const u = user();
    await login(page, u.email, u.password);
    await expect(page).toHaveURL(/\/projects(\/|$)/);

    await page.goto("/projects/new");
    await expect(page).toHaveURL(/\/projects\/new/);

    await page.reload();
    await expect(page).toHaveURL(/\/projects\/new/);
  });

  test("a signed-in user landing on /login is sent into the app", async ({ page }) => {
    const u = user();
    await login(page, u.email, u.password);
    await expect(page).toHaveURL(/\/projects(\/|$)/);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/projects(\/|$)/);
  });

  test("a signed-in user on /login?next= is sent to next", async ({ page }) => {
    const u = user();
    await login(page, u.email, u.password);
    await expect(page).toHaveURL(/\/projects(\/|$)/);

    await page.goto("/login?next=%2Fprojects%2Fnew");
    await expect(page).toHaveURL(/\/projects\/new/);
  });

  test("logout clears the session and blocks protected routes", async ({ page }) => {
    const u = user();
    await login(page, u.email, u.password);
    await expect(page).toHaveURL(/\/projects(\/|$)/);

    await page.getByRole("button", { name: "Log out" }).click();
    // logout returns to the public marketing home
    await expect(page).toHaveURL(/\/$/);

    // session is gone: a fresh load of a protected route bounces to /login
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login/);
  });
});
