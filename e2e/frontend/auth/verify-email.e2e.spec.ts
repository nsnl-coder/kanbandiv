import { test, expect } from "../support/fixtures";
import { resetDb, closeDb, seedUser, fillOtpQuota } from "../support/db";

test.beforeEach(resetDb);
test.afterAll(closeDb);

test.describe("verify email", () => {
  test("resend then rate-limit message", async ({ page }) => {
    const email = "pending@example.com";
    await seedUser({ email, verified: false });
    // RESEND_CAP is 3 per window; pre-fill 2 so the 2nd resend below trips it.
    await fillOtpQuota(email, "verify_email", 2);

    await page.goto(`/verify-email?email=${email}`);

    // resend sends a real email synchronously, so allow generous time
    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByText("A new code has been sent.")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByRole("alert")).toContainText("Too many requests", { timeout: 20_000 });
  });

  test("wrong code is rejected, no redirect", async ({ page }) => {
    const email = "pending@example.com";
    await seedUser({ email, verified: false });

    await page.goto(`/verify-email?email=${email}`);
    await page.getByLabel("Verification code").fill("999999");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByRole("alert")).toContainText("Invalid or expired code");
    await expect(page).toHaveURL(/\/verify-email/);
  });
});
