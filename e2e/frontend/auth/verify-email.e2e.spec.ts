import { test, expect } from "../support/fixtures";
import { PW } from "./helpers";
import { freshTestEmail, allowDestructive } from "../support/users";

// Register a fresh, unverified account and return its email (on /verify-email).
// Uses the test domain so the backend skips the real email (fixed OTP), keeping
// this off Mailtrap. The resend/rate-limit path needs real emails + a non-test
// user, so it lives in the backend integration tests, not here.
async function registerFresh(page: import("@playwright/test").Page): Promise<string> {
  const email = freshTestEmail("verify");
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByLabel("Confirm password").fill(PW);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page).toHaveURL(/\/verify-email/);
  return email;
}

test.describe("verify email", () => {
  // Every test here registers a fresh user -> destructive, dev-only.
  test.skip(!allowDestructive, "registers users (no delete-user API); dev-only");

  test("wrong code is rejected, no redirect", async ({ page }) => {
    await registerFresh(page);

    await page.getByLabel("Verification code").fill("999999");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByRole("alert")).toContainText("Invalid or expired code");
    await expect(page).toHaveURL(/\/verify-email/);
  });
});
