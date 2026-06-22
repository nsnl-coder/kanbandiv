import { BugReportError, Permission } from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCaller,
  makeContext,
  newTestDb,
  seedUser,
  type TestDb,
} from "../../auth/test/helpers.js";
import { authedCaller, seedUserWithRole } from "../../rbac/test/helpers.js";
import { logger } from "../../../logger.js";
import * as repo from "../bug-report.repo.js";

function reportsFor(db: TestDb, reporterId: string) {
  return db
    .selectFrom("bug_reports")
    .selectAll()
    .where("reporter_id", "=", reporterId)
    .execute();
}

function notificationsFor(db: TestDb, userId: string) {
  return db
    .selectFrom("notifications")
    .selectAll()
    .where("user_id", "=", userId)
    .execute();
}

const validBody = {
  title: "Drag breaks",
  description: "Dragging a card crashes the board",
  severity: "high" as const,
  pageUrl: "/boards/123",
};

describe("bug-reports - submit", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.restoreAllMocks();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("a verified user submits -> one row stamped with reporter/status/UA", async () => {
    const user = await seedUser(db, { email: "u@example.com", verified: true });
    const caller = createCaller(
      makeContext({ db, userId: user.id, userAgent: "Mozilla/5.0 Test" }),
    );
    const out = await caller.bugReports.submit(validBody);

    expect(out.reporterId).toBe(user.id);
    expect(out.status).toBe("open");
    expect(out.severity).toBe("high");
    expect(out.pageUrl).toBe("/boards/123");
    expect(out.userAgent).toBe("Mozilla/5.0 Test");
    expect(out.createdAt).toBeInstanceOf(Date);

    const rows = await reportsFor(db, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_agent).toBe("Mozilla/5.0 Test");
  });

  it("invalid input is rejected", async () => {
    const user = await seedUser(db, { email: "u@example.com", verified: true });
    const caller = authedCaller(db, user.id);
    await expect(
      caller.bugReports.submit({ ...validBody, title: "no" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.bugReports.submit({ ...validBody, description: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      // @ts-expect-error invalid enum
      caller.bugReports.submit({ ...validBody, severity: "fatal" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("each new report nudges every bug-admin except the reporter", async () => {
    const { user: roleAdmin } = await seedUserWithRole(db, {
      email: "roleadmin@example.com",
      permissions: [Permission.AdminBugsRead],
    });
    const su = await seedUser(db, {
      email: "root@example.com",
      isSuperuser: true,
      verified: true,
    });
    const reporter = await seedUser(db, { email: "reporter@example.com", verified: true });

    const out = await authedCaller(db, reporter.id).bugReports.submit(validBody);

    const roleNotes = await notificationsFor(db, roleAdmin.id);
    const suNotes = await notificationsFor(db, su.id);
    const reporterNotes = await notificationsFor(db, reporter.id);
    expect(roleNotes).toHaveLength(1);
    expect(suNotes).toHaveLength(1);
    expect(reporterNotes).toHaveLength(0);
    expect(roleNotes[0].type).toBe("BUG_REPORT_NEW");
    expect((roleNotes[0].payload as { bugReportId: string }).bugReportId).toBe(out.id);
    expect((roleNotes[0].payload as { actorHandle: string }).actorHandle).toBe("reporter");
  });

  it("an admin submitting their own report does not self-nudge but nudges others", async () => {
    const { user: admin1 } = await seedUserWithRole(db, {
      email: "admin1@example.com",
      permissions: [Permission.AdminBugsManage],
    });
    const su = await seedUser(db, {
      email: "root@example.com",
      isSuperuser: true,
      verified: true,
    });

    await authedCaller(db, admin1.id).bugReports.submit(validBody);

    expect(await notificationsFor(db, admin1.id)).toHaveLength(0);
    expect(await notificationsFor(db, su.id)).toHaveLength(1);
  });

  it("notify is best-effort: a failing admin-list still returns the report", async () => {
    const su = await seedUser(db, {
      email: "root@example.com",
      isSuperuser: true,
      verified: true,
    });
    const reporter = await seedUser(db, { email: "reporter@example.com", verified: true });
    const spy = vi.spyOn(repo, "listBugAdmins").mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);

    const out = await authedCaller(db, reporter.id).bugReports.submit(validBody);

    expect(out.id).toBeTruthy();
    expect(await reportsFor(db, reporter.id)).toHaveLength(1);
    expect(await notificationsFor(db, su.id)).toHaveLength(0);
    expect(errSpy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("bug-reports - my reports / isolation", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.restoreAllMocks();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("listMine returns only the caller's reports, newest-first, paginated", async () => {
    const a = await seedUser(db, { email: "a@example.com", verified: true });
    const b = await seedUser(db, { email: "b@example.com", verified: true });
    const callerA = authedCaller(db, a.id);
    await callerA.bugReports.submit({ ...validBody, title: "first one" });
    await callerA.bugReports.submit({ ...validBody, title: "second one" });
    await authedCaller(db, b.id).bugReports.submit({ ...validBody, title: "other user" });

    const page = await callerA.bugReports.listMine({ limit: 1, offset: 0 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].title).toBe("second one");
    expect(page.nextOffset).toBe(1);

    const all = await callerA.bugReports.listMine({ limit: 20, offset: 0 });
    expect(all.items).toHaveLength(2);
    expect(all.items.every((r) => r.reporterId === a.id)).toBe(true);
  });

  it("get: owner sees own; non-admin cannot see another's; admin can", async () => {
    const a = await seedUser(db, { email: "a@example.com", verified: true });
    const b = await seedUser(db, { email: "b@example.com", verified: true });
    const { user: admin } = await seedUserWithRole(db, {
      email: "admin@example.com",
      permissions: [Permission.AdminBugsRead],
    });
    const created = await authedCaller(db, a.id).bugReports.submit(validBody);

    const own = await authedCaller(db, a.id).bugReports.get({ id: created.id });
    expect(own.id).toBe(created.id);

    await expect(
      authedCaller(db, b.id).bugReports.get({ id: created.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: BugReportError.NOT_FOUND });

    const asAdmin = await authedCaller(db, admin.id).bugReports.get({ id: created.id });
    expect(asAdmin.id).toBe(created.id);
    expect(asAdmin.reporterEmail).toBe("a@example.com");
  });
});

describe("bug-reports - admin list / filter", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.restoreAllMocks();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("list without AdminBugsRead is FORBIDDEN", async () => {
    const { user } = await seedUserWithRole(db, {
      email: "nope@example.com",
      permissions: [Permission.AdminUsersRead],
    });
    await expect(
      authedCaller(db, user.id).bugReports.list({ limit: 20, offset: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin lists all; status/severity filters narrow; pagination", async () => {
    const reporter = await seedUser(db, { email: "r@example.com", verified: true });
    const { user: admin } = await seedUserWithRole(db, {
      email: "admin@example.com",
      permissions: [Permission.AdminBugsRead, Permission.AdminBugsManage],
    });
    const rc = authedCaller(db, reporter.id);
    const r1 = await rc.bugReports.submit({ ...validBody, severity: "low" });
    const r2 = await rc.bugReports.submit({ ...validBody, severity: "high" });
    const ac = authedCaller(db, admin.id);
    await ac.bugReports.update({ id: r2.id, status: "in_progress" });

    const all = await ac.bugReports.list({ limit: 20, offset: 0 });
    expect(all.items.length).toBeGreaterThanOrEqual(2);

    const open = await ac.bugReports.list({ status: "open", limit: 20, offset: 0 });
    expect(open.items.every((r) => r.status === "open")).toBe(true);
    expect(open.items.map((r) => r.id)).toContain(r1.id);

    const high = await ac.bugReports.list({ severity: "high", limit: 20, offset: 0 });
    expect(high.items.every((r) => r.severity === "high")).toBe(true);

    const combined = await ac.bugReports.list({
      status: "in_progress",
      severity: "high",
      limit: 20,
      offset: 0,
    });
    expect(combined.items.map((r) => r.id)).toEqual([r2.id]);
  });
});

describe("bug-reports - update", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.restoreAllMocks();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("update without AdminBugsManage is FORBIDDEN", async () => {
    const reporter = await seedUser(db, { email: "r@example.com", verified: true });
    const created = await authedCaller(db, reporter.id).bugReports.submit(validBody);
    const { user } = await seedUserWithRole(db, {
      email: "reader@example.com",
      permissions: [Permission.AdminBugsRead],
    });
    await expect(
      authedCaller(db, user.id).bugReports.update({ id: created.id, status: "closed" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin sets status and resolution; updated_at advances", async () => {
    const reporter = await seedUser(db, { email: "r@example.com", verified: true });
    const created = await authedCaller(db, reporter.id).bugReports.submit(validBody);
    const { user: admin } = await seedUserWithRole(db, {
      email: "admin@example.com",
      permissions: [Permission.AdminBugsManage],
    });
    const ac = authedCaller(db, admin.id);

    const up1 = await ac.bugReports.update({ id: created.id, status: "in_progress" });
    expect(up1.status).toBe("in_progress");

    const up2 = await ac.bugReports.update({
      id: created.id,
      status: "resolved",
      resolution: "fixed in v2",
    });
    expect(up2.status).toBe("resolved");
    expect(up2.resolution).toBe("fixed in v2");
    expect(up2.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it("update with no changed field -> NO_FIELDS; unknown id -> NOT_FOUND", async () => {
    const { user: admin } = await seedUserWithRole(db, {
      email: "admin@example.com",
      permissions: [Permission.AdminBugsManage],
    });
    const ac = authedCaller(db, admin.id);
    await expect(
      ac.bugReports.update({ id: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      ac.bugReports.update({
        id: "00000000-0000-0000-0000-000000000000",
        status: "closed",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("bug-reports - delete", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.restoreAllMocks();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("remove without AdminBugsManage is FORBIDDEN", async () => {
    const reporter = await seedUser(db, { email: "r@example.com", verified: true });
    const created = await authedCaller(db, reporter.id).bugReports.submit(validBody);
    const { user } = await seedUserWithRole(db, {
      email: "reader@example.com",
      permissions: [Permission.AdminBugsRead],
    });
    await expect(
      authedCaller(db, user.id).bugReports.remove({ id: created.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin remove deletes the row; second remove -> NOT_FOUND", async () => {
    const reporter = await seedUser(db, { email: "r@example.com", verified: true });
    const created = await authedCaller(db, reporter.id).bugReports.submit(validBody);
    const { user: admin } = await seedUserWithRole(db, {
      email: "admin@example.com",
      permissions: [Permission.AdminBugsManage],
    });
    const ac = authedCaller(db, admin.id);

    const res = await ac.bugReports.remove({ id: created.id });
    expect(res).toEqual({ ok: true });
    expect(await reportsFor(db, reporter.id)).toHaveLength(0);
    await expect(ac.bugReports.remove({ id: created.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("bug-reports - reporter account deletion", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await newTestDb();
    vi.restoreAllMocks();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it("deleting the reporter keeps the report with NULL reporter and email", async () => {
    const reporter = await seedUser(db, { email: "gone@example.com", verified: true });
    const created = await authedCaller(db, reporter.id).bugReports.submit(validBody);
    const { user: admin } = await seedUserWithRole(db, {
      email: "admin@example.com",
      permissions: [Permission.AdminBugsRead],
    });

    await db.deleteFrom("users").where("id", "=", reporter.id).execute();

    const got = await authedCaller(db, admin.id).bugReports.get({ id: created.id });
    expect(got.reporterId).toBeNull();
    expect(got.reporterEmail).toBeNull();
  });
});
