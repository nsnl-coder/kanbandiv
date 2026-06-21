import {
  authUrlSchema,
  backupRunIdInput,
  backupRunSchema,
  backupSettingsSchema,
  backupStatusSchema,
  backupUpcomingSchema,
  listBackupRunsInput,
  maintenanceInput,
  okSchema,
  Permission,
  updateBackupSettingsInput,
  z,
} from "shared";
import { globalProcedure, router } from "../../trpc/trpc.js";
import * as backup from "./backup.service.js";

export const backupRouter = router({
  getSettings: globalProcedure(Permission.AdminBackupRead)
    .meta({ openapi: { method: "GET", path: "/admin/backup/settings", tags: ["backup"], protect: true, summary: "Get backup settings and Drive connection status" } })
    .input(z.object({}))
    .output(backupSettingsSchema)
    .query(({ ctx }) => backup.getSettings(ctx.db)),

  updateSettings: globalProcedure(Permission.AdminBackupManage)
    .meta({ openapi: { method: "PUT", path: "/admin/backup/settings", tags: ["backup"], protect: true, summary: "Update schedule, retention and toggles" } })
    .input(updateBackupSettingsInput)
    .output(backupSettingsSchema)
    .mutation(({ ctx, input }) => backup.updateSettings(ctx.db, input)),

  authUrl: globalProcedure(Permission.AdminBackupManage)
    .meta({ openapi: { method: "GET", path: "/admin/backup/gdrive/auth-url", tags: ["backup"], protect: true, summary: "Get the Google OAuth consent URL" } })
    .input(z.object({}))
    .output(authUrlSchema)
    .query(({ ctx }) => backup.authUrl(ctx.user.id)),

  disconnect: globalProcedure(Permission.AdminBackupManage)
    .meta({ openapi: { method: "POST", path: "/admin/backup/gdrive/disconnect", tags: ["backup"], protect: true, summary: "Revoke and clear the stored Drive token" } })
    .input(z.object({}))
    .output(okSchema)
    .mutation(({ ctx }) => backup.disconnectDrive(ctx.db)),

  status: globalProcedure(Permission.AdminBackupRead)
    .meta({ openapi: { method: "GET", path: "/admin/backup/status", tags: ["backup"], protect: true, summary: "Current job and maintenance state" } })
    .input(z.object({}))
    .output(backupStatusSchema)
    .query(({ ctx }) => backup.getStatus(ctx.db)),

  upcoming: globalProcedure(Permission.AdminBackupRead)
    .meta({ openapi: { method: "GET", path: "/admin/backup/upcoming", tags: ["backup"], protect: true, summary: "Upcoming scheduled runs within a week" } })
    .input(z.object({}))
    .output(backupUpcomingSchema)
    .query(({ ctx }) => backup.getUpcoming(ctx.db)),

  run: globalProcedure(Permission.AdminBackupManage)
    .meta({ openapi: { method: "POST", path: "/admin/backup/run", tags: ["backup"], protect: true, summary: "Trigger a manual backup now" } })
    .input(z.object({}))
    .output(backupRunSchema)
    .mutation(async ({ ctx }) => {
      const run = await backup.runBackup(ctx.db, "manual");
      // Manual runs always return a row (skips only happen for scheduled).
      return run!;
    }),

  runsList: globalProcedure(Permission.AdminBackupRead)
    .meta({ openapi: { method: "GET", path: "/admin/backup/runs", tags: ["backup"], protect: true, summary: "List backup history" } })
    .input(listBackupRunsInput)
    .output(z.array(backupRunSchema))
    .query(({ ctx, input }) => backup.listRuns(ctx.db, input)),

  runsGet: globalProcedure(Permission.AdminBackupRead)
    .meta({ openapi: { method: "GET", path: "/admin/backup/runs/{runId}", tags: ["backup"], protect: true, summary: "Get one backup run" } })
    .input(backupRunIdInput)
    .output(backupRunSchema)
    .query(({ ctx, input }) => backup.getRun(ctx.db, input.runId)),

  runsDelete: globalProcedure(Permission.AdminBackupManage)
    .meta({ openapi: { method: "DELETE", path: "/admin/backup/runs/{runId}", tags: ["backup"], protect: true, summary: "Delete a backup (Drive file + row)" } })
    .input(backupRunIdInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => backup.deleteBackup(ctx.db, input.runId)),

  restore: globalProcedure(Permission.AdminBackupManage)
    .meta({ openapi: { method: "POST", path: "/admin/backup/runs/{runId}/restore", tags: ["backup"], protect: true, summary: "Restore from a backup (requires maintenance)" } })
    .input(backupRunIdInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => backup.restore(ctx.db, input.runId)),

  maintenance: globalProcedure(Permission.AdminBackupManage)
    .meta({ openapi: { method: "POST", path: "/admin/backup/maintenance", tags: ["backup"], protect: true, summary: "Toggle maintenance mode" } })
    .input(maintenanceInput)
    .output(backupSettingsSchema)
    .mutation(({ ctx, input }) => backup.setMaintenance(ctx.db, input.on)),
});
