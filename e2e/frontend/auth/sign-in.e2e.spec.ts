import { test, expect } from "../support/fixtures";
import { login, getStore, PW } from "./helpers";
import { resetDb, closeDb, seedUser } from "../support/db";

test.beforeEach(resetDb);
test.afterAll(closeDb);

test.describe("sign in", () => {
  test("user lands on /projects with role user", async ({ page }) => {
    await seedUser({ email: "user@example.com" });

    await login(page, "user@example.com");

    await expect(page).toHaveURL(/\/projects$/);
    const store = await getStore(page);
    expect(store.user?.email).toBe("user@example.com");
    expect(store.user?.isSuperuser).toBe(false);
  });

  test("admin lands on /admin with admin access", async ({ page }) => {
    await seedUser({ email: "admin@example.com", superuser: true });

    await login(page, "admin@example.com");

    await expect(page).toHaveURL(/\/admin/);
    expect((await getStore(page)).user?.isSuperuser).toBe(true);
  });

  test("wrong password does not authenticate", async ({ page }) => {
    await seedUser({ email: "user@example.com" });

    await login(page, "user@example.com", "wrong-password");

    await expect(page.getByRole("alert")).toContainText("Invalid credentials");
    await expect(page).toHaveURL(/\/login/);
    expect((await getStore(page)).user).toBeNull();
  });

  test("honors ?next after login", async ({ page }) => {
    await seedUser({ email: "user@example.com" });

    await page.goto("/login?next=/projects/new");
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/projects\/new/);
  });
});
