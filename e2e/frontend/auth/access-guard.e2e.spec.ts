import { test, expect } from "@playwright/test";
import { TrpcMock, makeUser, getStore } from "./helpers";

const PW = "password123";

test.describe("access guard", () => {
  test("must verify email before logging in", async ({ page }) => {
    await new TrpcMock(page)
      .loggedOut()
      .err("auth.login", { code: "FORBIDDEN", message: "EMAIL_NOT_VERIFIED" })
      .install();

    await page.goto("/login");
    await page.getByLabel("Email").fill("unverified@example.com");
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("alert")).toContainText("not verified");
    await expect(page.getByRole("link", { name: "Resend verification code" })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect((await getStore(page)).user).toBeNull();
  });

  test("protected route redirects to /login with next", async ({ page }) => {
    await new TrpcMock(page).loggedOut().install();

    await page.goto("/settings/password");

    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fpassword/);
  });

  test("home redirects unauthenticated users to /login", async ({ page }) => {
    await new TrpcMock(page).loggedOut().install();

    await page.goto("/");

    await expect(page).toHaveURL(/\/login\?next=%2F/);
  });

  test("user cannot reach /admin", async ({ page }) => {
    await new TrpcMock(page).loggedIn(makeUser({ role: "user" })).install();

    await page.goto("/admin");

    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByRole("heading", { name: "Your boards" })).toBeVisible();
  });
});
