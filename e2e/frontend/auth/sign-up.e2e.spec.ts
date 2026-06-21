import { test, expect } from "../support/fixtures";
import { PW } from "./helpers";
import { freshEmail, user, allowDestructive } from "../support/users";
import { fetchOtp } from "../support/mailtrap";

test.describe("sign up", () => {
  test("register -> verify email -> login (happy path)", async ({ page }) => {
    test.skip(!allowDestructive, "creates a new user (no delete-user API); dev-only");
    const email = freshEmail("signup");
    const t0 = Date.now();

    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByLabel("Confirm password").fill(PW);
    await page.getByRole("button", { name: "Register" }).click();

    await expect(page).toHaveURL(/\/verify-email/);

    // wrong code first
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid or expired code");
    await expect(page).toHaveURL(/\/verify-email/);

    // real code from the verification email -> login page
    const code = await fetchOtp(email, 6, t0);
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/login/);

    // login with the now-verified account
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/projects(\/|$)/);
  });

  test("duplicate (verified) email shows EMAIL_TAKEN", async ({ page }) => {
    // The pre-seeded user is already verified, so registering it is a conflict.
    // (Re-registering an UNVERIFIED email instead just re-issues an OTP.)
    const email = user().email;
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByLabel("Confirm password").fill(PW);
    await page.getByRole("button", { name: "Register" }).click();

    await expect(page.getByRole("alert")).toContainText("already registered");
    await expect(page).toHaveURL(/\/register/);
  });
});
