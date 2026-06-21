import { test, expect } from "../support/fixtures";
import { login, getStore } from "./helpers";
import { resetDb, closeDb, seedUser } from "../support/db";

test.beforeEach(resetDb);
test.afterAll(closeDb);

test.describe("session", () => {
  test("silent refresh re-hydrates the session on reload", async ({ page }) => {
    await seedUser({ email: "user@example.com" });
    await login(page, "user@example.com");
    await expect(page).toHaveURL(/\/projects$/);
    expect((await getStore(page)).user?.email).toBe("user@example.com");

    await page.reload();
    await expect(page).toHaveURL(/\/projects$/);
    expect((await getStore(page)).user?.email).toBe("user@example.com");
  });

  test("reloading on a protected route keeps the user there, not /login", async ({ page }) => {
    await seedUser({ email: "user@example.com" });
    await login(page, "user@example.com");
    await expect(page).toHaveURL(/\/projects$/);

    await page.goto("/projects/new");
    await expect(page).toHaveURL(/\/projects\/new/);

    await page.reload();
    await expect(page).toHaveURL(/\/projects\/new/);
    expect((await getStore(page)).user?.email).toBe("user@example.com");
  });

  test("a signed-in user landing on /login is sent to their home", async ({ page }) => {
    await seedUser({ email: "user@example.com" });
    await login(page, "user@example.com");
    await expect(page).toHaveURL(/\/projects$/);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/projects$/);
    expect((await getStore(page)).user?.email).toBe("user@example.com");
  });

  test("a signed-in admin landing on /login is sent to /admin", async ({ page }) => {
    await seedUser({ email: "admin@example.com", superuser: true });
    await login(page, "admin@example.com");
    await expect(page).toHaveURL(/\/admin/);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/admin/);
  });

  test("a signed-in user on /login?next= is sent to next", async ({ page }) => {
    await seedUser({ email: "user@example.com" });
    await login(page, "user@example.com");
    await expect(page).toHaveURL(/\/projects$/);

    await page.goto("/login?next=%2Fprojects%2Fnew");
    await expect(page).toHaveURL(/\/projects\/new/);
  });

  test("logout clears the session and blocks protected routes", async ({ page }) => {
    await seedUser({ email: "user@example.com" });
    await login(page, "user@example.com");
    await expect(page).toHaveURL(/\/projects$/);

    await page.getByRole("button", { name: "Log out" }).click();
    // logout returns to the public marketing home
    await expect(page).toHaveURL(/\/$/);
    expect((await getStore(page)).user).toBeNull();

    // session is gone: a fresh load of a protected route bounces to /login
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login/);
  });
});
