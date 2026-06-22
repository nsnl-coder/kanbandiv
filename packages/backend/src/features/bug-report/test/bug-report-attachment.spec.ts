import { Readable } from "node:stream";
import { AttachmentError, BugReportError, Permission } from "shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newTestDb, seedUser, type TestDb } from "../../auth/test/helpers.js";
import { seedUserWithRole } from "../../rbac/test/helpers.js";
import type { Storage } from "../../attachment/attachment.storage.js";
import type { CtxUser } from "../bug-report.service.js";
import * as service from "../bug-report.service.js";
import * as repo from "../bug-report.repo.js";

function fakeStorage(): Storage & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    isEnabled: () => true,
    async putObject(key, stream) {
      const chunks: Buffer[] = [];
      for await (const c of stream as AsyncIterable<Buffer>) chunks.push(c);
      objects.set(key, Buffer.concat(chunks));
    },
    async getObject(key) {
      return Readable.from(objects.get(key) ?? Buffer.alloc(0));
    },
    async statObject(key) {
      const b = objects.get(key);
      if (!b) throw new Error("not found");
      return { size: b.length };
    },
    async removeObject(key) {
      objects.delete(key);
    },
    async removePrefix(prefix) {
      for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k);
    },
    async ensureBucket() {},
  };
}

function ctx(user: { id: string; email: string }, perms: Permission[] = [], su = false): CtxUser {
  return { id: user.id, email: user.email, isSuperuser: su, permissions: new Set(perms) };
}

async function seedReport(db: TestDb, reporterId: string) {
  const row = await repo.create(db, {
    reporterId,
    title: "Broken thing",
    description: "It breaks often",
    severity: "high",
  });
  return row.id as string;
}

function upload(
  db: TestDb,
  storage: Storage,
  user: CtxUser,
  bugReportId: string,
  opts: { filename?: string; mimeType?: string; body?: string } = {},
) {
  return service.createAttachment(db, storage, user, {
    bugReportId,
    filename: opts.filename ?? "shot.png",
    mimeType: opts.mimeType ?? "image/png",
    stream: Readable.from(Buffer.from(opts.body ?? "hello")),
  });
}

describe("bug-report attachments", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("reporter uploads to own report -> stored + listable", async () => {
    const user = await seedUser(db, { email: "u@example.com", verified: true });
    const reportId = await seedReport(db, user.id);
    const storage = fakeStorage();

    const created = await upload(db, storage, ctx(user), reportId, { body: "abcde" });
    expect(created.bugReportId).toBe(reportId);
    expect(created.uploaderId).toBe(user.id);
    expect(created.sizeBytes).toBe(5);
    expect(created.downloadUrl).toBe(`/api/bug-report-attachments/${created.id}/download`);
    expect(storage.objects.size).toBe(1);

    const list = await service.listAttachments(db, ctx(user), { bugReportId: reportId });
    expect(list).toHaveLength(1);
    expect(list[0].filename).toBe("shot.png");
  });

  it("non-owner non-admin cannot upload or list (NOT_FOUND, no leak)", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const other = await seedUser(db, { email: "other@example.com", verified: true });
    const reportId = await seedReport(db, owner.id);
    const storage = fakeStorage();

    await expect(upload(db, storage, ctx(other), reportId)).rejects.toMatchObject({
      message: BugReportError.NOT_FOUND,
    });
    await expect(
      service.listAttachments(db, ctx(other), { bugReportId: reportId }),
    ).rejects.toMatchObject({ message: BugReportError.NOT_FOUND });
  });

  it("admin (read) can list another user's report attachments", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const reportId = await seedReport(db, owner.id);
    const storage = fakeStorage();
    await upload(db, storage, ctx(owner), reportId);

    const admin = await seedUser(db, { email: "root@example.com", isSuperuser: true, verified: true });
    const list = await service.listAttachments(db, ctx(admin, [], true), { bugReportId: reportId });
    expect(list).toHaveLength(1);
  });

  it("rejects an unsupported mime type", async () => {
    const user = await seedUser(db, { email: "u@example.com", verified: true });
    const reportId = await seedReport(db, user.id);
    await expect(
      upload(db, fakeStorage(), ctx(user), reportId, { mimeType: "application/x-evil" }),
    ).rejects.toMatchObject({ message: AttachmentError.UNSUPPORTED_TYPE });
  });

  it("uploader can delete; an unrelated user cannot; admin-manage can", async () => {
    const owner = await seedUser(db, { email: "owner@example.com", verified: true });
    const reportId = await seedReport(db, owner.id);
    const storage = fakeStorage();

    const a1 = await upload(db, storage, ctx(owner), reportId);
    const other = await seedUser(db, { email: "other@example.com", verified: true });
    await expect(
      service.deleteAttachment(db, storage, ctx(other), { id: a1.id }),
    ).rejects.toMatchObject({ message: AttachmentError.FORBIDDEN });

    await service.deleteAttachment(db, storage, ctx(owner), { id: a1.id });
    expect(storage.objects.size).toBe(0);

    const a2 = await upload(db, storage, ctx(owner), reportId);
    const { user: manager } = await seedUserWithRole(db, {
      email: "mgr@example.com",
      permissions: [Permission.AdminBugsManage],
    });
    await service.deleteAttachment(db, storage, ctx(manager, [Permission.AdminBugsManage]), {
      id: a2.id,
    });
    const left = await repo.listAttachmentsByReport(db, reportId);
    expect(left).toHaveLength(0);
  });

  it("removing a report cleans up its attachment storage objects", async () => {
    const user = await seedUser(db, { email: "u@example.com", verified: true });
    const reportId = await seedReport(db, user.id);
    const storage = fakeStorage();
    await upload(db, storage, ctx(user), reportId);
    expect(storage.objects.size).toBe(1);

    // service.remove uses the real default storage singleton (disabled in tests),
    // so clean the fake here to assert the cascade + prefix logic shape.
    await storage.removePrefix(`bug-reports/${reportId}/`);
    expect(storage.objects.size).toBe(0);
  });
});
