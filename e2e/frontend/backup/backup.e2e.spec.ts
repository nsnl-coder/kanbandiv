import { test, expect } from "@playwright/test";
import { TrpcMock, makeUser } from "../auth/helpers";

const READ = "admin:backup:read";
const MANAGE = "admin:backup:manage";

const settings = (over: Record<string, unknown> = {}) => ({
  enabled: false,
  scheduleKind: "daily",
  cronExpr: null,
  retentionMode: "simple",
  retentionDays: 14,
  gfsDaily: null,
  gfsWeekly: null,
  gfsMonthly: null,
  includeMinio: true,
  encryptionEnabled: false,
  gdriveFolderName: "Trello Clone Backups (local)",
  gdriveFolderId: null,
  maintenance: false,
  drive: { connected: false, email: null },
  updatedAt: new Date().toISOString(),
  ...over,
});

const successRun = {
  id: "run_1",
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  status: "success",
  trigger: "manual",
  sizeBytes: 2048,
  driveFileId: "drive_1",
  fileName: "backup-1.tar.gz",
  checksum: "abc",
  error: null,
  expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
};

const adminUser = (perms: string[]) =>
  makeUser({ isSuperuser: false, permissions: perms } as never);

test.describe("admin backup", () => {
  test("a user without backup permission cannot reach /admin/backup", async ({ page }) => {
    await new TrpcMock(page).loggedIn(adminUser([])).install();
    await page.goto("/admin/backup");
    await expect(page).toHaveURL("http://localhost:5173/");
  });

  test("read-only admin sees data but no mutate controls", async ({ page }) => {
    await new TrpcMock(page)
      .loggedIn(adminUser([READ]))
      .ok("backup.getSettings", settings())
      .ok("backup.status", { maintenance: false, running: null })
      .ok("backup.upcoming", { runs: [] })
      .ok("backup.runsList", [])
      .install();

    await page.goto("/admin/backup");
    await expect(page.getByRole("heading", { name: "Backup" })).toBeVisible();
    await expect(page.getByText("Not connected.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect Google Drive" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Backup now" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
  });

  test("manage admin can trigger a backup now", async ({ page }) => {
    await new TrpcMock(page)
      .loggedIn(adminUser([READ, MANAGE]))
      .ok("backup.getSettings", settings({ drive: { connected: true, email: "a@b.com" } }))
      .ok("backup.status", { maintenance: false, running: null })
      .ok("backup.upcoming", { runs: [] })
      .ok("backup.runsList", [])
      .ok("backup.run", successRun)
      .install();

    await page.goto("/admin/backup");
    await page.getByRole("button", { name: "Backup now" }).click();
    await expect(page.getByText("Backup completed.")).toBeVisible();
  });

  test("restore requires confirmation and enforces maintenance", async ({ page }) => {
    await new TrpcMock(page)
      .loggedIn(adminUser([READ, MANAGE]))
      .ok("backup.getSettings", settings({ drive: { connected: true, email: "a@b.com" } }))
      .ok("backup.status", { maintenance: false, running: null })
      .ok("backup.upcoming", { runs: [] })
      .ok("backup.runsList", [successRun])
      .ok("backup.maintenance", settings({ maintenance: true, drive: { connected: true, email: "a@b.com" } }))
      .ok("backup.restore", { ok: true })
      .install();

    await page.goto("/admin/backup");
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText(/overwrites all current data/)).toBeVisible();

    await page.getByRole("button", { name: "Restore" }).last().click();
    await expect(page.getByText("Restore completed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Leave maintenance" })).toBeVisible();
  });

  test("normal user sees the maintenance screen on a 503", async ({ page }) => {
    await new TrpcMock(page)
      .loggedIn(adminUser([]))
      .err("projects.list", { code: "SERVICE_UNAVAILABLE", message: "MAINTENANCE" })
      .install();

    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Under maintenance" })).toBeVisible();
  });
});
