import { router } from "./trpc.js";
import { healthRouter } from "../features/health/health.router.js";
import { authRouter } from "../features/auth/auth.router.js";
import { rbacRouter } from "../features/rbac/rbac.router.js";
import { projectsRouter } from "../features/project/project.router.js";
import { boardsRouter } from "../features/board/board.router.js";
import { columnsRouter } from "../features/column/column.router.js";
import { cardsRouter } from "../features/card/card.router.js";

export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  admin: rbacRouter,
  projects: projectsRouter,
  boards: boardsRouter,
  columns: columnsRouter,
  cards: cardsRouter,
});

export type AppRouter = typeof appRouter;
