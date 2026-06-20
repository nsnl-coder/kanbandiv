import { test, expect } from "@playwright/test";
import { TrpcMock, makeUser, makeSession } from "./helpers";

const NEW_PW = "newpassword123";

test.describe("forgot password", () => {
  test("request reset -> reset -> login with new password", async ({ page }) => {
    const user = makeUser({ email: "reset@example.com" });
    const mock = new TrpcMock(page).loggedOut().ok("auth.forgotPassword", { ok: true });
    await mock.install();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(user.email);
    await page.getByRole("button", { name: "Send reset code" }).click();
    await expect(page.getByText(/reset code has been sent/i)).toBeVisible();

    // reset with the (mocked) code
    mock.ok("auth.resetPassword", { ok: true });
    await page.goto("/reset-password?email=reset@example.com");
    await page.getByLabel("Reset code").fill("12345678");
    await page.getByLabel("New password", { exact: true }).fill(NEW_PW);
    await page.getByLabel("Confirm new password").fill(NEW_PW);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page).toHaveURL(/\/login/);

    // login with the new password
    mock.ok("auth.login", makeSession(user));
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(NEW_PW);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("http://localhost:5173/");
  });

  test("unknown email shows same generic message (no enumeration)", async ({ page }) => {
    await new TrpcMock(page).loggedOut().ok("auth.forgotPassword", { ok: true }).install();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByRole("button", { name: "Send reset code" }).click();
    await expect(page.getByText(/reset code has been sent/i)).toBeVisible();
  });

  test("wrong reset code is rejected, no redirect", async ({ page }) => {
    await new TrpcMock(page)
      .loggedOut()
      .err("auth.resetPassword", { code: "BAD_REQUEST", message: "INVALID_OTP" })
      .install();

    await page.goto("/reset-password?email=reset@example.com");
    await page.getByLabel("Reset code").fill("00000000");
    await page.getByLabel("New password", { exact: true }).fill(NEW_PW);
    await page.getByLabel("Confirm new password").fill(NEW_PW);
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByRole("alert")).toContainText("Invalid or expired code");
    await expect(page).toHaveURL(/\/reset-password/);
  });
});
