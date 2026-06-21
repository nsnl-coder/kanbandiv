import { test, expect } from "../support/fixtures";
import { resetDb, closeDb, seedUser } from "../support/db";
import { fetchOtp } from "../support/mailtrap";

const NEW_PW = "newpassword123";

test.beforeEach(resetDb);
test.afterAll(closeDb);

test.describe("forgot password", () => {
  test("request reset -> reset -> login with new password", async ({ page }) => {
    const email = `reset-${Date.now()}@example.com`;
    await seedUser({ email });
    const t0 = Date.now();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset code" }).click();
    await expect(page.getByText(/reset code has been sent/i)).toBeVisible();

    // real reset code from the email
    const code = await fetchOtp(email, 8, t0);
    await page.goto(`/reset-password?email=${email}`);
    await page.getByLabel("Reset code").fill(code);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PW);
    await page.getByLabel("Confirm new password").fill(NEW_PW);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page).toHaveURL(/\/login/);

    // login with the new password
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(NEW_PW);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test("unknown email shows same generic message (no enumeration)", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByRole("button", { name: "Send reset code" }).click();
    await expect(page.getByText(/reset code has been sent/i)).toBeVisible();
  });

  test("wrong reset code is rejected, no redirect", async ({ page }) => {
    const email = "reset-wrong@example.com";
    await seedUser({ email });

    await page.goto(`/reset-password?email=${email}`);
    await page.getByLabel("Reset code").fill("00000000");
    await page.getByLabel("New password", { exact: true }).fill(NEW_PW);
    await page.getByLabel("Confirm new password").fill(NEW_PW);
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByRole("alert")).toContainText("Invalid or expired code");
    await expect(page).toHaveURL(/\/reset-password/);
  });
});
