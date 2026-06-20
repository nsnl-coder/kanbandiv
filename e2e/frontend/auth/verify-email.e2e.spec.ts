import { test, expect } from "@playwright/test";
import { TrpcMock } from "./helpers";

test.describe("verify email", () => {
  test("resend then rate-limit message", async ({ page }) => {
    const mock = new TrpcMock(page).loggedOut().ok("auth.resendVerifyOtp", { ok: true });
    await mock.install();

    await page.goto("/verify-email?email=pending@example.com");

    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByText("A new code has been sent.")).toBeVisible();

    mock.err("auth.resendVerifyOtp", { code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });
    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByRole("alert")).toContainText("Too many requests");
  });

  test("wrong code is rejected, no redirect", async ({ page }) => {
    await new TrpcMock(page)
      .loggedOut()
      .err("auth.verifyEmail", { code: "BAD_REQUEST", message: "INVALID_OTP" })
      .install();

    await page.goto("/verify-email?email=pending@example.com");
    await page.getByLabel("Verification code").fill("999999");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByRole("alert")).toContainText("Invalid or expired code");
    await expect(page).toHaveURL(/\/verify-email/);
  });
});
