import { BackupError } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import * as gdrive from "../backup.gdrive.js";
import * as job from "../backup.job.js";
import * as repo from "../backup.repo.js";
import * as service from "../backup.service.js";
import { newTestDb, type TestDb } from "./helpers.js";

vi.mock("../backup.gdrive.js", () => ({
  buildAuthUrl: vi.fn(() => "https://x"),
  exchangeCode: vi.fn(async () => ({ refreshToken: "rt", email: "e@example.com" })),
  ensureBackupFolder: vi.fn(async () => "folder-1"),
  revokeToken: vi.fn(),
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
}));
vi.mock("../backup.job.js", () => ({
  createArchive: vi.fn(),
  restoreArchive: vi.fn(),
}));

async function connect(db: TestDb) {
  await service.connectDrive(db, "code");
}

describe("backup run pipeline", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.clearAllMocks();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("rejects a manual run when Drive is not connected", async () => {
    await expect(service.runBackup(db, "manual")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: BackupError.DRIVE_NOT_CONNECTED,
    });
  });

  it("records a successful run with size, drive id, checksum, expiry", async () => {
    await connect(db);
    const cleanup = vi.fn(async () => {});
    (job.createArchive as Mock).mockResolvedValue({
      filePath: "/tmp/a.tar.gz",
      fileName: "backup-x.tar.gz",
      checksum: "deadbeef",
      sizeBytes: 4096,
      cleanup,
    });
    (gdrive.uploadFile as Mock).mockResolvedValue({ id: "drive-1", size: 4096 });

    const run = await service.runBackup(db, "manual");
    expect(run).toMatchObject({
      status: "success",
      sizeBytes: 4096,
      driveFileId: "drive-1",
      checksum: "deadbeef",
      fileName: "backup-x.tar.gz",
    });
    expect(run?.expiresAt).not.toBeNull(); // simple retention seeds 14 days
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("marks the run failed when the archive step throws", async () => {
    await connect(db);
    (job.createArchive as Mock).mockRejectedValue(new Error("pg_dump exited 1"));

    await expect(service.runBackup(db, "manual")).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    const last = await db
      .selectFrom("backup_runs")
      .selectAll()
      .orderBy("started_at", "desc")
      .executeTakeFirstOrThrow();
    expect(last.status).toBe("failed");
    expect(last.error).toContain("pg_dump");
  });

  it("single-flight: rejects a manual run while one is running", async () => {
    await connect(db);
    await repo.insertRun(db, { trigger: "manual", file_name: "in-flight.tar.gz" });
    await expect(service.runBackup(db, "manual")).rejects.toMatchObject({
      code: "CONFLICT",
      message: BackupError.ALREADY_RUNNING,
    });
  });

  it("single-flight: a scheduled run skips (returns null) while one is running", async () => {
    await connect(db);
    await repo.insertRun(db, { trigger: "scheduled", file_name: "in-flight.tar.gz" });
    expect(await service.runBackup(db, "scheduled")).toBeNull();
  });

  it("passes includeMinio=false through to the archive step", async () => {
    await connect(db);
    await db
      .updateTable("backup_settings")
      .set({ include_minio: false })
      .where("id", "=", 1)
      .execute();
    const cleanup = vi.fn(async () => {});
    (job.createArchive as Mock).mockResolvedValue({
      filePath: "/tmp/a.tar.gz",
      fileName: "b.tar.gz",
      checksum: "c",
      sizeBytes: 1,
      cleanup,
    });
    (gdrive.uploadFile as Mock).mockResolvedValue({ id: "d", size: 1 });

    await service.runBackup(db, "manual");
    expect(job.createArchive).toHaveBeenCalledWith(
      expect.objectContaining({ includeMinio: false }),
    );
  });
});
