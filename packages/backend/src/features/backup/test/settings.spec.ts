import { BackupError } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as service from "../backup.service.js";
import { newTestDb, superuserCaller, type TestDb } from "./helpers.js";

const base = {
  enabled: true,
  scheduleKind: "daily" as const,
  retentionMode: "simple" as const,
  retentionDays: 7,
  includeMinio: true,
  encryptionEnabled: false,
};

describe("backup settings", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
    service.onReschedule(() => {}); // clear any spy registered during a test
  });

  it("GET returns drive disconnected with no token", async () => {
    const { caller } = await superuserCaller(db);
    const s = await caller.backup.getSettings({});
    expect(s.drive.connected).toBe(false);
    expect(s.drive.email).toBeNull();
  });

  it("rejects an invalid cron expression", async () => {
    const { caller } = await superuserCaller(db);
    await expect(
      caller.backup.updateSettings({ ...base, scheduleKind: "cron", cronExpr: "abc def" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: BackupError.INVALID_CRON });
  });

  it("rejects a non-positive retention value (zod)", async () => {
    const { caller } = await superuserCaller(db);
    await expect(
      caller.backup.updateSettings({ ...base, retentionDays: -1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("requires cronExpr when scheduleKind is cron (zod)", async () => {
    const { caller } = await superuserCaller(db);
    await expect(
      caller.backup.updateSettings({ ...base, scheduleKind: "cron" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("persists settings and reflects them on reload", async () => {
    const { caller } = await superuserCaller(db);
    await caller.backup.updateSettings({
      enabled: true,
      scheduleKind: "weekly",
      retentionMode: "gfs",
      gfsDaily: 7,
      gfsWeekly: 4,
      gfsMonthly: 6,
      includeMinio: false,
      encryptionEnabled: true,
    });
    const s = await caller.backup.getSettings({});
    expect(s.scheduleKind).toBe("weekly");
    expect(s.retentionMode).toBe("gfs");
    expect(s.gfsDaily).toBe(7);
    expect(s.retentionDays).toBeNull();
    expect(s.includeMinio).toBe(false);
    expect(s.encryptionEnabled).toBe(true);
  });

  it("re-registers the scheduler on update", async () => {
    const spy = vi.fn();
    service.onReschedule(spy);
    const { caller } = await superuserCaller(db);
    await caller.backup.updateSettings(base);
    expect(spy).toHaveBeenCalledOnce();
  });
});
