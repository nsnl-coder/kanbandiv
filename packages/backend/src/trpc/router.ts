import { router } from "./trpc.js";
import { healthRouter } from "../features/health/health.router.js";
import { authRouter } from "../features/auth/auth.router.js";

export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
