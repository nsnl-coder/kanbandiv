import { test, expect } from "../support/fixtures";
import { PW } from "./helpers";
import { freshEmail } from "../support/users";

// Register a fresh, unverified account and return its email (on /verify-email).
async function registerFresh(page: import("@playwright/test").Page): Promise<string> {
  const email = freshEmail("verify");
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByLabel("Confirm password").fill(PW);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page).toHaveURL(/\/verify-email/);
  return email;
}

test.describe("verify email", () => {
  test("resend then rate-limit message", async ({ page }) => {
    await registerFresh(page); // register already minted OTP #1

    // RESEND_CAP is 3 per window; register=1, two resends ok, the third trips it.
    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByText("A new code has been sent.")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByText("A new code has been sent.")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByRole("alert")).toContainText("Too many requests", { timeout: 20_000 });
  });

  test("wrong code is rejected, no redirect", async ({ page }) => {
    await registerFresh(page);

    await page.getByLabel("Verification code").fill("999999");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByRole("alert")).toContainText("Invalid or expired code");
    await expect(page).toHaveURL(/\/verify-email/);
  });
});
