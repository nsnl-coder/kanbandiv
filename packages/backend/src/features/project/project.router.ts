import { z } from "zod";
import {
  createProjectInput,
  grantAccessInput,
  listProjectsInput,
  moveProjectInput,
  okSchema,
  projectAccessEntrySchema,
  projectSchema,
  updateProjectInput,
} from "shared";
import { protectedProcedure, router } from "../../trpc/trpc.js";
import * as project from "./project.service.js";

const idInput = z.object({ id: z.string() });

const user = (ctx: { user: { id: string; isSuperuser: boolean } }) => ({
  id: ctx.user.id,
  isSuperuser: ctx.user.isSuperuser,
});

export const projectsRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/projects", tags: ["projects"], protect: true, summary: "List projects the caller can access" } })
    .input(listProjectsInput)
    .output(z.array(projectSchema))
    .query(({ ctx, input }) => project.listProjects(ctx.db, user(ctx), input)),

  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/projects/{id}", tags: ["projects"], protect: true, summary: "Get a project by id" } })
    .input(idInput)
    .output(projectSchema)
    .query(({ ctx, input }) => project.getProject(ctx.db, user(ctx), input.id)),

  create: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/projects", tags: ["projects"], protect: true, summary: "Create a project" } })
    .input(createProjectInput)
    .output(projectSchema)
    .mutation(({ ctx, input }) => project.createProject(ctx.db, user(ctx), input)),

  update: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: "/projects/{id}", tags: ["projects"], protect: true, summary: "Update a project" } })
    .input(idInput.merge(updateProjectInput))
    .output(projectSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      return project.updateProject(ctx.db, user(ctx), id, patch);
    }),

  delete: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/projects/{id}", tags: ["projects"], protect: true, summary: "Delete a project" } })
    .input(idInput)
    .output(okSchema)
    .mutation(({ ctx, input }) => project.deleteProject(ctx.db, user(ctx), input.id)),

  move: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/projects/{id}/move", tags: ["projects"], protect: true, summary: "Reorder a project in the sidebar" } })
    .input(idInput.merge(moveProjectInput))
    .output(projectSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...move } = input;
      return project.moveProject(ctx.db, user(ctx), id, move);
    }),

  moveShared: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/projects/{id}/move-shared", tags: ["projects"], protect: true, summary: "Reorder a project in the caller's shared list (per-user order)" } })
    .input(idInput.merge(moveProjectInput))
    .output(projectSchema)
    .mutation(({ ctx, input }) => {
      const { id, ...move } = input;
      return project.moveSharedProject(ctx.db, user(ctx), id, move);
    }),

  accessList: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/projects/{id}/access", tags: ["projects"], protect: true, summary: "List a project's access grants" } })
    .input(idInput)
    .output(z.array(projectAccessEntrySchema))
    .query(({ ctx, input }) => project.listAccess(ctx.db, user(ctx), input.id)),

  accessGrant: protectedProcedure
    .meta({ openapi: { method: "PUT", path: "/projects/{id}/access", tags: ["projects"], protect: true, summary: "Grant or update a user's access" } })
    .input(idInput.merge(grantAccessInput))
    .output(z.array(projectAccessEntrySchema))
    .mutation(({ ctx, input }) => {
      const { id, ...grant } = input;
      return project.grantAccess(ctx.db, user(ctx), id, grant, ctx.email);
    }),

  accessRevoke: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/projects/{id}/access/{userId}", tags: ["projects"], protect: true, summary: "Revoke a user's access" } })
    .input(idInput.extend({ userId: z.string() }))
    .output(z.array(projectAccessEntrySchema))
    .mutation(({ ctx, input }) =>
      project.revokeAccess(ctx.db, user(ctx), input.id, { userId: input.userId }),
    ),
});
