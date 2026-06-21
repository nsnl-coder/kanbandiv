import { router } from "./trpc.js";
import { healthRouter } from "../features/health/health.router.js";
import { authRouter } from "../features/auth/auth.router.js";
import { rbacRouter } from "../features/rbac/rbac.router.js";
import { projectsRouter } from "../features/project/project.router.js";
import { boardsRouter } from "../features/board/board.router.js";
import { columnsRouter } from "../features/column/column.router.js";
import { cardsRouter } from "../features/card/card.router.js";
import { labelsRouter } from "../features/label/label.router.js";
import { checklistsRouter, checklistItemsRouter } from "../features/checklist/checklist.router.js";
import { commentsRouter } from "../features/comment/comment.router.js";
import { assigneesRouter } from "../features/assignee/assignee.router.js";
import { attachmentsRouter } from "../features/attachment/attachment.router.js";
import { backupRouter } from "../features/backup/backup.router.js";

export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  admin: rbacRouter,
  projects: projectsRouter,
  boards: boardsRouter,
  columns: columnsRouter,
  cards: cardsRouter,
  labels: labelsRouter,
  checklists: checklistsRouter,
  checklistItems: checklistItemsRouter,
  comments: commentsRouter,
  assignees: assigneesRouter,
  attachments: attachmentsRouter,
  backup: backupRouter,
});

export type AppRouter = typeof appRouter;
