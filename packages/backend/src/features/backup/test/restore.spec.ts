import { BackupError } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import * as gdrive from "../backup.gdrive.js";
import * as job from "../backup.job.js";
import * as service from "../backup.service.js";
import { newTestDb, type TestDb } from "./helpers.js";

vi.mock("../backup.gdrive.js", () => ({
  buildAuthUrl: vi.fn(),
  exchangeCode: vi.fn(async () => ({ refreshToken: "rt", email: "e@example.com" })),
  revokeToken: vi.fn(),
  uploadFile: vi.fn(),
  downloadFile: vi.fn(async () => {}),
  deleteFile: vi.fn(),
}));
vi.mock("../backup.job.js", () => ({
  createArchive: vi.fn(),
  restoreArchive: vi.fn(async () => {}),
}));

async function seedSuccessRun(db: TestDb) {
  return db
    .insertInto("backup_runs")
    .values({
      status: "success",
      trigger: "manual",
      file_name: "backup-x.tar.gz",
      drive_file_id: "drive-1",
      checksum: "abc123",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

const setMaintenance = (db: TestDb, on: boolean) =>
  db.updateTable("backup_settings").set({ maintenance: on }).where("id", "=", 1).execute();

describe("backup restore", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.clearAllMocks();
    await service.connectDrive(db, "code");
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("is rejected when maintenance mode is off", async () => {
    const run = await seedSuccessRun(db);
    await expect(service.restore(db, run.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: BackupError.RESTORE_REQUIRES_MAINTENANCE,
    });
    expect(gdrive.downloadFile).not.toHaveBeenCalled();
  });

  it("downloads then restores when maintenance is on", async () => {
    const run = await seedSuccessRun(db);
    await setMaintenance(db, true);

    const res = await service.restore(db, run.id);
    expect(res).toEqual({ ok: true });
    expect(gdrive.downloadFile).toHaveBeenCalledWith("rt", "drive-1", expect.any(String));
    expect(job.restoreArchive).toHaveBeenCalledWith(
      expect.objectContaining({ expectedChecksum: "abc123", encrypted: false, includeMinio: true }),
    );
    const dlOrder = (gdrive.downloadFile as Mock).mock.invocationCallOrder[0];
    const restoreOrder = (job.restoreArchive as Mock).mock.invocationCallOrder[0];
    expect(dlOrder).toBeLessThan(restoreOrder);
  });

  it("aborts with CHECKSUM_MISMATCH when the archive fails verification", async () => {
    const run = await seedSuccessRun(db);
    await setMaintenance(db, true);
    (job.restoreArchive as Mock).mockRejectedValueOnce(new Error("CHECKSUM_MISMATCH"));

    await expect(service.restore(db, run.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: BackupError.CHECKSUM_MISMATCH,
    });
  });
});
