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
    // exact: the toast text also appears in a screen-reader status announcer.
    await expect(page.getByText("Bug reported, thanks", { exact: true })).toBeVisible();

    // Drop the user session first: a signed-in visit to /login redirects into
    // the app, so the login form never renders.
    await page.context().clearCookies();
    const a = admin();
    await login(page, a.email, a.password);
    // Wait for the admin session to land before navigating, else /admin/bugs
    // loads before auth and the list query runs unauthenticated (empty).
    await expect(page).toHaveURL(/\/admin/);
    await page.goto("/admin/bugs");
    const row = page.getByRole("row", { name: new RegExp(title) });
    await expect(row).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await row.click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Bug report deleted", { exact: true })).toBeVisible();
  });
});
