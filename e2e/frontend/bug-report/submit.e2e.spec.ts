import { test, expect } from "../support/fixtures";
import { login } from "../auth/helpers";
import { user, admin } from "../support/users";

// Real e2e: a pre-seeded user opens the Report-a-bug modal, submits a uniquely
// titled report, and an admin then finds + deletes it in /admin/bugs so no
// throwaway data lingers (mirrors the destructive-cleanup convention).
test.describe("bug report", () => {
  test("user submits a bug; admin sees and deletes it", async ({ page }) => {
    const title = `e2e-bug-${Date.now()}`;

    const u = user();
    await login(page, u.email, u.password);
    await expect(page).toHaveURL(/\/projects(\/|$)/);

    await page.getByRole("button", { name: "Report a bug" }).first().click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Description").fill("Submitted by the e2e suite.");
    await page.getByLabel("Severity").selectOption("low");
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByText("Bug reported, thanks")).toBeVisible();

    const a = admin();
    await login(page, a.email, a.password);
    await page.goto("/admin/bugs");
    const row = page.getByRole("row", { name: new RegExp(title) });
    await expect(row).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await row.click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Bug report deleted")).toBeVisible();
  });
});
