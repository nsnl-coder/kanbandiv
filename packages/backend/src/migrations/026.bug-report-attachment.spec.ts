import crypto from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/types.js";
import { up as up001 } from "./001.auth.js";
import { up as up025 } from "./025.bug-report.js";
import { down, up } from "./026.bug-report-attachment.js";

function freshDb(): Kysely<Database> {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  const { Pool } = mem.adapters.createPg();
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool() }) });
}

describe("026 bug-report-attachment migration", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = freshDb();
    await up001(db);
    await up025(db);
    await up(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedReport() {
    const user = await db
      .insertInto("users")
      .values({ email: "u@example.com", password_hash: "x" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const report = await db
      .insertInto("bug_reports")
      .values({ reporter_id: user.id, title: "Broken", description: "It broke", severity: "high" })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { userId: user.id, reportId: report.id };
  }

  it("up runs (table + index boot)", async () => {
    const fresh = freshDb();
    await up001(fresh);
    await up025(fresh);
    await expect(up(fresh)).resolves.not.toThrow();
    await fresh.destroy();
  });

  it("inserts an attachment row", async () => {
    const { userId, reportId } = await seedReport();
    await db
      .insertInto("bug_report_attachments")
      .values({
        bug_report_id: reportId,
        uploader_id: userId,
        filename: "shot.png",
        mime_type: "image/png",
        size_bytes: 123,
        storage_key: `bug-reports/${reportId}/a.png`,
      })
      .execute();
    const row = await db
      .selectFrom("bug_report_attachments")
      .selectAll()
      .where("bug_report_id", "=", reportId)
      .executeTakeFirstOrThrow();
    expect(row.filename).toBe("shot.png");
    expect(Number(row.size_bytes)).toBe(123);
  });

  it("cascade-deletes attachments when the report is removed", async () => {
    const { userId, reportId } = await seedReport();
    await db
      .insertInto("bug_report_attachments")
      .values({
        bug_report_id: reportId,
        uploader_id: userId,
        filename: "a.png",
        mime_type: "image/png",
        size_bytes: 1,
        storage_key: `bug-reports/${reportId}/a.png`,
      })
      .execute();
    await db.deleteFrom("bug_reports").where("id", "=", reportId).execute();
    const rows = await db.selectFrom("bug_report_attachments").selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it("sets uploader_id NULL (not cascade) when the uploader is deleted", async () => {
    const { userId, reportId } = await seedReport();
    await db
      .insertInto("bug_report_attachments")
      .values({
        bug_report_id: reportId,
        uploader_id: userId,
        filename: "a.png",
        mime_type: "image/png",
        size_bytes: 1,
        storage_key: `bug-reports/${reportId}/a.png`,
      })
      .execute();
    await db.deleteFrom("users").where("id", "=", userId).execute();
    const rows = await db.selectFrom("bug_report_attachments").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].uploader_id).toBeNull();
  });

  it("down drops the table", async () => {
    await down(db);
    await expect(
      sql`select 1 from ${sql.table("bug_report_attachments")}`.execute(db),
    ).rejects.toThrow();
  });
});
