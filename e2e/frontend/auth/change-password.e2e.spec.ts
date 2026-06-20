import { test, expect } from "@playwright/test";
import { TrpcMock, makeUser } from "./helpers";

test.describe("change password", () => {
  test("updates password, then rejects a wrong current password", async ({ page }) => {
    const mock = new TrpcMock(page)
      .loggedIn(makeUser())
      .ok("auth.changePassword", { ok: true });
    await mock.install();

    await page.goto("/settings/password");
    await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();

    await page.getByLabel("Current password").fill("oldpassword1");
    await page.getByLabel("New password", { exact: true }).fill("newpassword123");
    await page.getByLabel("Confirm new password").fill("newpassword123");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("status")).toContainText("Password updated successfully");

    // wrong current password
    mock.err("auth.changePassword", { code: "UNAUTHORIZED", message: "INVALID_CREDENTIALS" });
    await page.getByLabel("Current password").fill("wrongcurrent");
    await page.getByLabel("New password", { exact: true }).fill("newpassword123");
    await page.getByLabel("Confirm new password").fill("newpassword123");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid credentials");
  });
});
