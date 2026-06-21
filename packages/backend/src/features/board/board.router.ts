import { z } from "zod";
import {
  archivedBoardItemsSchema,
  boardAccessEntrySchema,
  boardDataSchema,
  boardSchema,
  createBoardInput,
  grantBoardAccessInput,
  listArchivedBoardsInput,
  listBoardsInput,
  okSchema,
  updateBoardInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as board from "./board.service.js";

const idInput = z.object({ id: z.string() });

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const boardsRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/boards", tags: ["boards"], protect: true, summary: "List boards in a project" } })
    .input(listBoardsInput)
    .output(z.array(boardSchema))
    .query(({ ctx, input }) => board.listBoards(ctx.db, user(ctx), input.projectId)),

  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/boards/{id}", tags: ["boards"], protect: true, summary: "Get a board by id" } })
    .input(idInput)
    .output(boardSchema)
    .query(({ ctx, input }) => board.getBoard(ctx.db, user(ctx), input.id)),

  getData: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/boards/{id}/data", tags: ["boards"], protect: true, summary: "Get a board with nested columns and cards" } })
    .input(idInput)
    .output(boardDataSchema)
    .query(({ ctx, input }) => board.getBoardData(ctx.db, user(ctx), input.id)),

  create: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/boards", tags: ["boards"], protect: true, summary: "Create a board" } })
    .input(createBoardInput)
    .output(boardSchema)
    .mutation(({ ctx, input }) => board.createBoard(ctx.db, user(ctx), input)),

  update: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: "/boards/{id}", tags: ["boards"], protect: true, summary: "Update a board" } })
    .input(idInput.merge(updateBoardInput))
    .output(boardSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      return board.updateBoard(ctx.db, user(ctx), id, patch);
    }),

  delete: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/boards/{id}", tags: ["boards"], protect: true, summary: "Permanently delete a board (cascade)" } })
    .input(idInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => board.deleteBoard(ctx.db, user(ctx), input.id)),

  archive: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/boards/{id}/archive", tags: ["boards"], protect: true, summary: "Archive a board" } })
    .input(idInput)
    .output(boardSchema)
    .mutation(({ ctx, input }) => board.archiveBoard(ctx.db, user(ctx), input.id)),

  restore: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/boards/{id}/restore", tags: ["boards"], protect: true, summary: "Restore an archived board" } })
    .input(idInput)
    .output(boardSchema)
    .mutation(({ ctx, input }) => board.restoreBoard(ctx.db, user(ctx), input.id)),

  archived: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/boards/archived", tags: ["boards"], protect: true, summary: "List archived boards in a project" } })
    .input(listArchivedBoardsInput)
    .output(z.array(boardSchema))
    .query(({ ctx, input }) => board.listArchivedBoards(ctx.db, user(ctx), input.projectId)),

  archivedItems: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/boards/{id}/archived", tags: ["boards"], protect: true, summary: "List archived columns and cards in a board" } })
    .input(idInput)
    .output(archivedBoardItemsSchema)
    .query(({ ctx, input }) => board.getArchivedItems(ctx.db, user(ctx), input.id)),

  accessList: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/boards/{id}/access", tags: ["boards"], protect: true, summary: "List a board's access grants" } })
    .input(idInput)
    .output(z.array(boardAccessEntrySchema))
    .query(({ ctx, input }) => board.listBoardAccess(ctx.db, user(ctx), input.id)),

  accessGrant: protectedProcedure
    .meta({ openapi: { method: "PUT", path: "/boards/{id}/access", tags: ["boards"], protect: true, summary: "Grant or update a user's board access" } })
    .input(idInput.merge(grantBoardAccessInput))
    .output(z.array(boardAccessEntrySchema))
    .mutation(({ ctx, input }) => {
      const { id, ...grant } = input;
      return board.grantBoardAccess(ctx.db, user(ctx), id, grant);
    }),

  accessRevoke: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/boards/{id}/access/{userId}", tags: ["boards"], protect: true, summary: "Revoke a user's board access" } })
    .input(idInput.extend({ userId: z.string() }))
    .output(z.array(boardAccessEntrySchema))
    .mutation(({ ctx, input }) =>
      board.revokeBoardAccess(ctx.db, user(ctx), input.id, { userId: input.userId }),
    ),
});
