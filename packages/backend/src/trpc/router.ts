import { router } from "./trpc.js";
import { healthRouter } from "../features/health/health.router.js";
import { authRouter } from "../features/auth/auth.router.js";
import { rbacRouter } from "../features/rbac/rbac.router.js";

export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  admin: rbacRouter,
});

export type AppRouter = typeof appRouter;
