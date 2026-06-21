import { Permission } from "shared";
import { afterEach, beforeEach, describe } from "vitest";
import { authzMatrix } from "../../rbac/test/authz.js";
import { newTestDb, type TestDb } from "./helpers.js";

const validSettings = {
  enabled: false,
  scheduleKind: "daily" as const,
  retentionMode: "simple" as const,
  retentionDays: 7,
  includeMinio: true,
  encryptionEnabled: false,
};

describe("backup authz", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  describe("getSettings (read)", () => {
    authzMatrix(() => db, Permission.AdminBackupRead, (c) => c.backup.getSettings({}));
  });
  describe("status (read)", () => {
    authzMatrix(() => db, Permission.AdminBackupRead, (c) => c.backup.status({}));
  });
  describe("upcoming (read)", () => {
    authzMatrix(() => db, Permission.AdminBackupRead, (c) => c.backup.upcoming({}));
  });
  describe("runsList (read)", () => {
    authzMatrix(() => db, Permission.AdminBackupRead, (c) => c.backup.runsList({}));
  });
  describe("runsGet (read)", () => {
    authzMatrix(() => db, Permission.AdminBackupRead, (c) =>
      c.backup.runsGet({ runId: "missing" }),
    );
  });
  describe("updateSettings (manage)", () => {
    authzMatrix(() => db, Permission.AdminBackupManage, (c) =>
      c.backup.updateSettings(validSettings),
    );
  });
  describe("authUrl (manage)", () => {
    authzMatrix(() => db, Permission.AdminBackupManage, (c) => c.backup.authUrl({}));
  });
  describe("disconnect (manage)", () => {
    authzMatrix(() => db, Permission.AdminBackupManage, (c) => c.backup.disconnect({}));
  });
  describe("run (manage)", () => {
    authzMatrix(() => db, Permission.AdminBackupManage, (c) => c.backup.run({}));
  });
  describe("runsDelete (manage)", () => {
    authzMatrix(() => db, Permission.AdminBackupManage, (c) =>
      c.backup.runsDelete({ runId: "missing" }),
    );
  });
  describe("restore (manage)", () => {
    authzMatrix(() => db, Permission.AdminBackupManage, (c) =>
      c.backup.restore({ runId: "missing" }),
    );
  });
  describe("maintenance (manage)", () => {
    authzMatrix(() => db, Permission.AdminBackupManage, (c) =>
      c.backup.maintenance({ on: false }),
    );
  });
});
