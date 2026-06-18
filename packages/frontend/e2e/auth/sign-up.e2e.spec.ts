import { test, expect } from "@playwright/test";
import { TrpcMock, makeUser, makeSession, getStore } from "./helpers";

const PW = "password123";

test.describe("sign up", () => {
  test("register -> verify email -> login (happy path)", async ({ page }) => {
    const user = makeUser({ email: "newuser@example.com" });
    const mock = new TrpcMock(page).loggedOut().ok("auth.register", { ok: true });
    await mock.install();

    await page.goto("/register");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByLabel("Confirm password").fill(PW);
    await page.getByRole("button", { name: "Register" }).click();

    await expect(page).toHaveURL(/\/verify-email/);
    expect((await getStore(page)).user).toBeNull();

    // wrong code first
    mock.err("auth.verifyEmail", { code: "BAD_REQUEST", message: "INVALID_OTP" });
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid or expired code");
    await expect(page).toHaveURL(/\/verify-email/);

    // resend
    mock.ok("auth.resendVerifyOtp", { ok: true });
    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByText("A new code has been sent.")).toBeVisible();

    // correct code -> login page
    mock.ok("auth.verifyEmail", { ok: true });
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/login/);

    // login
    mock.ok("auth.login", makeSession(user));
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL("http://localhost:5173/");
    const store = await getStore(page);
    expect(store.user).not.toBeNull();
    expect(store.user?.email).toBe(user.email);
  });

  test("duplicate email shows EMAIL_TAKEN", async ({ page }) => {
    const mock = new TrpcMock(page)
      .loggedOut()
      .err("auth.register", { code: "CONFLICT", message: "EMAIL_TAKEN" });
    await mock.install();

    await page.goto("/register");
    await page.getByLabel("Email").fill("taken@example.com");
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByLabel("Confirm password").fill(PW);
    await page.getByRole("button", { name: "Register" }).click();

    await expect(page.getByRole("alert")).toContainText("already registered");
    await expect(page).toHaveURL(/\/register/);
  });
});
