import { test, expect } from "@playwright/test";
import { TrpcMock, makeUser, makeSession, getStore } from "./helpers";

const PW = "password123";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByRole("button", { name: "Log in" }).click();
}

test.describe("sign in", () => {
  test("user lands on / with role user", async ({ page }) => {
    const user = makeUser();
    await new TrpcMock(page).loggedOut().ok("auth.login", makeSession(user)).install();

    await login(page, user.email);

    await expect(page).toHaveURL("http://localhost:5173/");
    expect((await getStore(page)).user?.role).toBe("user");
  });

  test("admin lands on /admin with role admin", async ({ page }) => {
    const admin = makeUser({ id: "a_1", email: "admin@example.com", role: "admin" });
    await new TrpcMock(page).loggedOut().ok("auth.login", makeSession(admin)).install();

    await login(page, admin.email);

    await expect(page).toHaveURL(/\/admin/);
    expect((await getStore(page)).user?.role).toBe("admin");
  });

  test("wrong password does not authenticate", async ({ page }) => {
    await new TrpcMock(page)
      .loggedOut()
      .err("auth.login", { code: "UNAUTHORIZED", message: "INVALID_CREDENTIALS" })
      .install();

    await login(page, "user@example.com");

    // Credential failure shows the error inline (no refresh-retry / no reload).
    await expect(page.getByRole("alert")).toContainText("Invalid credentials");
    await expect(page).toHaveURL(/\/login/);
    expect((await getStore(page)).user).toBeNull();
  });

  test("honors ?next after login", async ({ page }) => {
    const user = makeUser();
    await new TrpcMock(page).loggedOut().ok("auth.login", makeSession(user)).install();

    await page.goto("/login?next=/settings/password");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/settings\/password/);
    await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  });
});
