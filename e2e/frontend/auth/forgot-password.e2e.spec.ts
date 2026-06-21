import { test, expect } from "../support/fixtures";
import { resetEmail } from "../support/users";
import { fetchOtp } from "../support/mailtrap";

test.describe("forgot password", () => {
  test("request reset -> reset -> login with new password", async ({ page }) => {
    const email = resetEmail();
    // New password drifts each run; that's fine - forgot only needs the email,
    // never the current password, so the dedicated reset account stays usable.
    const newPw = `Reset-${Date.now()}aA1`;
    const t0 = Date.now();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset code" }).click();
    await expect(page.getByText(/reset code has been sent/i)).toBeVisible();

    const code = await fetchOtp(email, 8, t0);
    await page.goto(`/reset-password?email=${encodeURIComponent(email)}`);
    await page.getByLabel("Reset code").fill(code);
    await page.getByLabel("New password", { exact: true }).fill(newPw);
    await page.getByLabel("Confirm new password").fill(newPw);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(newPw);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/projects(\/|$)/);
  });

  test("unknown email shows same generic message (no enumeration)", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("nobody-e2e@example.com");
    await page.getByRole("button", { name: "Send reset code" }).click();
    await expect(page.getByText(/reset code has been sent/i)).toBeVisible();
  });

  test("wrong reset code is rejected, no redirect", async ({ page }) => {
    const email = resetEmail();
    await page.goto(`/reset-password?email=${encodeURIComponent(email)}`);
    await page.getByLabel("Reset code").fill("00000000");
    await page.getByLabel("New password", { exact: true }).fill("whatever-123");
    await page.getByLabel("Confirm new password").fill("whatever-123");
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByRole("alert")).toContainText("Invalid or expired code");
    await expect(page).toHaveURL(/\/reset-password/);
  });
});
