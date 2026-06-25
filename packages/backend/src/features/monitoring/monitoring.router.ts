import { z } from "zod";
import { router, superuserProcedure } from "../../trpc/trpc.js";
import { fetchOverview } from "./monitoring.service.js";

// Super-admin only. Read-only system metrics for the admin Monitor tab; the
// PromQL allowlist lives server-side in monitoring.service.ts.
export const monitoringRouter = router({
  overview: superuserProcedure
    .input(z.object({ rangeMinutes: z.number().int().min(5).max(360).default(30) }).optional())
    .query(({ input }) => fetchOverview(input?.rangeMinutes ?? 30)),
});
