import { test, expect } from "@playwright/test";
import { TrpcMock, makeUser, getStore } from "./helpers";

test.describe("session", () => {
  test("silent refresh re-hydrates the session on reload", async ({ page }) => {
    const user = makeUser();
    await new TrpcMock(page).loggedIn(user).install();

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your boards" })).toBeVisible();
    expect((await getStore(page)).user?.email).toBe(user.email);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Your boards" })).toBeVisible();
    expect((await getStore(page)).user?.email).toBe(user.email);
  });

  test("reloading on a protected route keeps the user there, not /login", async ({ page }) => {
    const user = makeUser();
    await new TrpcMock(page).loggedIn(user).install();

    await page.goto("/settings/password");
    await expect(page).toHaveURL("/settings/password");

    await page.reload();
    await expect(page).toHaveURL("/settings/password");
    expect((await getStore(page)).user?.email).toBe(user.email);
  });

  test("a signed-in user landing on /login is sent to their user page", async ({ page }) => {
    const user = makeUser({ role: "user" });
    await new TrpcMock(page).loggedIn(user).install();

    await page.goto("/login");
    await expect(page).toHaveURL("/");
    expect((await getStore(page)).user?.email).toBe(user.email);
  });

  test("a signed-in admin landing on /login is sent to /admin", async ({ page }) => {
    const admin = makeUser({ role: "admin" });
    await new TrpcMock(page).loggedIn(admin).install();

    await page.goto("/login");
    await expect(page).toHaveURL("/admin");
  });

  test("a signed-in user on /login?next= is sent to next", async ({ page }) => {
    const user = makeUser();
    await new TrpcMock(page).loggedIn(user).install();

    await page.goto("/login?next=%2Fsettings%2Fpassword");
    await expect(page).toHaveURL("/settings/password");
  });

  test("logout clears the session and blocks protected routes", async ({ page }) => {
    const user = makeUser();
    const mock = new TrpcMock(page).loggedIn(user).ok("auth.logout", { ok: true });
    await mock.install();

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your boards" })).toBeVisible();

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect((await getStore(page)).user).toBeNull();

    // session is gone: a fresh load of a protected route bounces to /login
    mock.loggedOut();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });
});
