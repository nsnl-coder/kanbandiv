import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import * as gdrive from "../backup.gdrive.js";
import { gfsKeepIds } from "../backup.service.js";
import * as service from "../backup.service.js";
import { newTestDb, type TestDb } from "./helpers.js";

vi.mock("../backup.gdrive.js", () => ({
  buildAuthUrl: vi.fn(),
  exchangeCode: vi.fn(async () => ({ refreshToken: "rt", email: "e@example.com" })),
  revokeToken: vi.fn(),
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(async () => {}),
}));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function seedRun(
  db: TestDb,
  v: { startedAt: Date; status?: "success" | "running"; driveId?: string | null },
) {
  return db
    .insertInto("backup_runs")
    .values({
      status: v.status ?? "success",
      trigger: "scheduled",
      file_name: `f-${v.startedAt.getTime()}.tar.gz`,
      drive_file_id: v.driveId ?? "file-1",
      started_at: v.startedAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe("backup retention", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.clearAllMocks();
    await service.connectDrive(db, "code"); // store a token so drive deletes fire
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("simple mode deletes runs older than N days and removes their Drive file", async () => {
    // default retention_days = 14
    const old = await seedRun(db, { startedAt: daysAgo(30), driveId: "old" });
    const recent = await seedRun(db, { startedAt: daysAgo(3), driveId: "new" });

    const deleted = await service.runRetention(db);
    expect(deleted).toBe(1);
    expect(gdrive.deleteFile as Mock).toHaveBeenCalledWith("rt", "old");

    const remaining = await db.selectFrom("backup_runs").select("id").execute();
    expect(remaining.map((r) => r.id)).toEqual([recent.id]);
    void old;
  });

  it("never deletes a running row", async () => {
    await db
      .updateTable("backup_settings")
      .set({ retention_days: 7 })
      .where("id", "=", 1)
      .execute();
    const running = await seedRun(db, { startedAt: daysAgo(60), status: "running" });
    await seedRun(db, { startedAt: daysAgo(60), status: "success", driveId: "x" });

    await service.runRetention(db);
    const rows = await db.selectFrom("backup_runs").select("id").execute();
    expect(rows.map((r) => r.id)).toContain(running.id);
  });

  it("gfsKeepIds keeps the newest run per day/week/month bucket", () => {
    const runs = [
      { id: "d0", started_at: daysAgo(0) },
      { id: "d0b", started_at: daysAgo(0) }, // same day -> not separately kept by daily
      { id: "d1", started_at: daysAgo(1) },
      { id: "d10", started_at: daysAgo(10) },
      { id: "d40", started_at: daysAgo(40) },
    ];
    const keep = gfsKeepIds(runs, { daily: 2, weekly: 1, monthly: 2 });
    // daily(2): newest two distinct days -> d0, d1
    expect(keep.has("d0")).toBe(true);
    expect(keep.has("d1")).toBe(true);
    // monthly(2): newest two distinct months -> this month (d0) + the d40 month
    expect(keep.has("d40")).toBe(true);
  });
});
