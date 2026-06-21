import { BackupError, Permission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setMaintenanceCache } from "../backup.maintenance.js";
import {
  authedCaller,
  newTestDb,
  seedUser,
  seedUserWithRole,
  superuserCaller,
  type TestDb,
} from "./helpers.js";

describe("maintenance guard", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    setMaintenanceCache(false); // never leak the flag to other suites
    await db.destroy();
  });

  it("blocks a normal user with SERVICE_UNAVAILABLE while maintenance is on", async () => {
    const { caller: su } = await superuserCaller(db);
    await su.backup.maintenance({ on: true });

    const user = await seedUser(db, { email: "normal@example.com", verified: true });
    const normal = authedCaller(db, user.id);
    await expect(normal.auth.me({})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: BackupError.MAINTENANCE,
    });
  });

  it("still allows the superuser while maintenance is on", async () => {
    const { caller: su, user } = await superuserCaller(db);
    await su.backup.maintenance({ on: true });
    const me = await su.auth.me({});
    expect(me.id).toBe(user.id);
  });

  it("lets a backup admin toggle maintenance back off, restoring access", async () => {
    const { user } = await seedUserWithRole(db, {
      email: "backup-admin@example.com",
      permissions: [Permission.AdminBackupManage],
    });
    const admin = authedCaller(db, user.id);
    await admin.backup.maintenance({ on: true });
    // backup admins are exempt from the guard, so they can turn it off again.
    await admin.backup.maintenance({ on: false });

    const other = await seedUser(db, { email: "normal2@example.com", verified: true });
    const normal = authedCaller(db, other.id);
    const me = await normal.auth.me({});
    expect(me.id).toBe(other.id);
  });
});
