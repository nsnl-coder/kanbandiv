import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import * as gdrive from "../backup.gdrive.js";
import * as service from "../backup.service.js";
import { newTestDb, superuserCaller, type TestDb } from "./helpers.js";

// Keep the real buildAuthUrl (URL assertions); stub the network calls.
vi.mock("../backup.gdrive.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../backup.gdrive.js")>();
  return {
    ...actual,
    exchangeCode: vi.fn(),
    revokeToken: vi.fn(),
    ensureBackupFolder: vi.fn(async () => "folder-1"),
  };
});

describe("backup Google Drive OAuth", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.clearAllMocks();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("auth-url requests offline access and the drive.file scope", async () => {
    const { caller } = await superuserCaller(db);
    const { url } = await caller.backup.authUrl({});
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain("drive.file");
  });

  it("callback stores an (encrypted) refresh token + email", async () => {
    (gdrive.exchangeCode as Mock).mockResolvedValue({
      refreshToken: "rt-secret",
      email: "owner@example.com",
    });
    await service.connectDrive(db, "auth-code");

    const { caller } = await superuserCaller(db);
    const s = await caller.backup.getSettings({});
    expect(s.drive).toEqual({ connected: true, email: "owner@example.com" });

    const row = await db
      .selectFrom("backup_settings")
      .select("gdrive_refresh_token")
      .where("id", "=", 1)
      .executeTakeFirstOrThrow();
    expect(row.gdrive_refresh_token).toBeTruthy();
    expect(row.gdrive_refresh_token).not.toBe("rt-secret"); // encrypted at rest
  });

  it("disconnect revokes the token and clears the connection", async () => {
    (gdrive.exchangeCode as Mock).mockResolvedValue({
      refreshToken: "rt-secret",
      email: "owner@example.com",
    });
    await service.connectDrive(db, "auth-code");
    await service.disconnectDrive(db);

    expect(gdrive.revokeToken).toHaveBeenCalledWith("rt-secret");
    const { caller } = await superuserCaller(db);
    const s = await caller.backup.getSettings({});
    expect(s.drive.connected).toBe(false);
  });
});
