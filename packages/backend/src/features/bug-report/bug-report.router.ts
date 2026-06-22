import { z } from "zod";
import {
  bugReportAttachmentSchema,
  bugReportPageSchema,
  bugReportSchema,
  deleteBugReportAttachmentInput,
  deleteBugReportInput,
  getBugReportInput,
  listBugReportAttachmentsInput,
  listBugReportsInput,
  listMyBugReportsInput,
  okSchema,
  Permission,
  submitBugReportInput,
  updateBugReportInput,
} from "shared";
import {
  globalProcedure,
  protectedProcedure,
  rateLimit,
  router,
} from "../../trpc/trpc.js";
import { storage } from "../attachment/attachment.storage.js";
import * as bugReport from "./bug-report.service.js";

const user = (ctx: {
  user: {
    id: string;
    email: string;
    isSuperuser: boolean;
    permissions: Set<Permission>;
  };
}) => ({
  id: ctx.user.id,
  email: ctx.user.email,
  isSuperuser: ctx.user.isSuperuser,
  permissions: ctx.user.permissions,
});

const submitProcedure = protectedProcedure.use(rateLimit({ limit: 10, windowMs: 60_000 }));

export const bugReportsRouter = router({
  submit: submitProcedure
    .meta({ openapi: { method: "POST", path: "/bug-reports", tags: ["bug-reports"], protect: true, summary: "Submit a bug report (rate-limited)" } })
    .input(submitBugReportInput)
    .output(bugReportSchema)
    .mutation(({ ctx, input }) =>
      bugReport.submit(ctx.db, user(ctx), input, ctx.userAgent ?? null),
    ),

  listMine: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/bug-reports/mine", tags: ["bug-reports"], protect: true, summary: "List the caller's own bug reports (newest-first)" } })
    .input(listMyBugReportsInput)
    .output(bugReportPageSchema)
    .query(({ ctx, input }) => bugReport.listMine(ctx.db, user(ctx), input)),

  list: globalProcedure(Permission.AdminBugsRead)
    .meta({ openapi: { method: "GET", path: "/bug-reports", tags: ["bug-reports"], protect: true, summary: "Admin: list all bug reports (filter by status/severity)" } })
    .input(listBugReportsInput)
    .output(bugReportPageSchema)
    .query(({ ctx, input }) => bugReport.listAll(ctx.db, user(ctx), input)),

  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/bug-reports/{id}", tags: ["bug-reports"], protect: true, summary: "Get one bug report (owner or admin)" } })
    .input(getBugReportInput)
    .output(bugReportSchema)
    .query(({ ctx, input }) => bugReport.get(ctx.db, user(ctx), input)),

  update: globalProcedure(Permission.AdminBugsManage)
    .meta({ openapi: { method: "PATCH", path: "/bug-reports/{id}", tags: ["bug-reports"], protect: true, summary: "Admin: update a bug report's status/severity/resolution" } })
    .input(updateBugReportInput)
    .output(bugReportSchema)
    .mutation(({ ctx, input }) => bugReport.update(ctx.db, user(ctx), input)),

  remove: globalProcedure(Permission.AdminBugsManage)
    .meta({ openapi: { method: "DELETE", path: "/bug-reports/{id}", tags: ["bug-reports"], protect: true, summary: "Admin: hard-delete a bug report" } })
    .input(deleteBugReportInput)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => bugReport.remove(ctx.db, user(ctx), input)),

  listAttachments: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/bug-reports/{bugReportId}/attachments", tags: ["bug-reports"], protect: true, summary: "List a bug report's attachments (owner or admin)" } })
    .input(listBugReportAttachmentsInput)
    .output(z.array(bugReportAttachmentSchema))
    .query(({ ctx, input }) => bugReport.listAttachments(ctx.db, user(ctx), input)),

  removeAttachment: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/bug-report-attachments/{id}", tags: ["bug-reports"], protect: true, summary: "Delete a bug report attachment (uploader or admin)" } })
    .input(deleteBugReportAttachmentInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => bugReport.deleteAttachment(ctx.db, storage, user(ctx), input)),
});
