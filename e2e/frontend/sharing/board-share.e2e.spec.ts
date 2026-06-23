import { test, expect } from "../support/fixtures";
import { login } from "../auth/helpers";
import { user, secondUser, allowDestructive } from "../support/users";

// Real e2e: owner A shares a single board with user B, then B (logged in fresh)
// finds the board under "Shared with me" and gets a "shared the board"
// notification. The frontend has no project-delete, so this leaves a persistent
// project/board - dev-only (destructive), matching the suite convention.
test.describe("board sharing", () => {
  test.skip(
    !allowDestructive,
    "creates a persistent project/board the UI cannot delete",
  );

  test("owner shares a board; recipient sees it in Shared with me + is notified", async ({
    page,
  }) => {
    const owner = user();
    const recipient = secondUser();
    const stamp = Date.now();
    const projectName = `e2e-share-proj-${stamp}`;
    const boardName = `e2e-share-board-${stamp}`;

    // --- Owner: create a project + board, share the board with the recipient ---
    await login(page, owner.email, owner.password);
    await expect(page).toHaveURL(/\/projects(\/|$)/);

    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name", { exact: true }).fill(projectName);
    await page.getByRole("button", { name: "Create project" }).click();

    // The new project lands collapsed in the sidebar; expand it to reveal its
    // inline "New board" affordance.
    // The project toggle is the button carrying aria-expanded; the dnd wrapper
    // also exposes role=button with the same name, so disambiguate on that.
    // force: a non-editable (shared) project sits in a dnd wrapper marked
    // aria-disabled, which Playwright treats as disabled though the toggle works.
    await page.locator("button[aria-expanded]", { hasText: projectName }).click({ force: true });
    await page.getByRole("button", { name: "New board" }).click();
    const boardInput = page.getByRole("textbox", { name: "Board name" });
    await boardInput.fill(boardName);
    await boardInput.press("Enter");

    await expect(page.getByRole("heading", { name: boardName })).toBeVisible();
    await page.getByRole("button", { name: "Board menu" }).click();
    await page.getByRole("menuitem", { name: "Manage access" }).click();
    await page.getByPlaceholder("user@example.com").fill(recipient.email);
    await page.getByLabel("permission").selectOption({ label: "Editor" });
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.getByText(recipient.email)).toBeVisible();

    // --- Recipient: log in fresh, verify discovery + notification ---
    await page.context().clearCookies();
    await login(page, recipient.email, recipient.password);
    await expect(page).toHaveURL(/\/projects(\/|$)/);

    // The shared board's parent project now appears under "Shared with me";
    // expanding it reveals the single board the recipient was granted.
    await page.getByRole("button", { name: "Shared with me" }).click();
    // The project toggle is the button carrying aria-expanded; the dnd wrapper
    // also exposes role=button with the same name, so disambiguate on that.
    // force: a non-editable (shared) project sits in a dnd wrapper marked
    // aria-disabled, which Playwright treats as disabled though the toggle works.
    await page.locator("button[aria-expanded]", { hasText: projectName }).click({ force: true });
    await expect(page.getByRole("link", { name: boardName })).toBeVisible();

    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(
      page.getByText(new RegExp(`shared the board "${boardName}"`)),
    ).toBeVisible();
  });
});
