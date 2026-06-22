import { TRPCError } from "@trpc/server";
import {
  ProjectError,
  ProjectVisibility,
  type CreateProjectInput,
  type GrantAccessInput,
  InviteScope,
  type ListProjectsInput,
  type MoveProjectInput,
  type MyPermission,
  type Project,
  type ProjectAccessEntry,
  type RevokeAccessInput,
  type UpdateProjectInput,
} from "shared";
import type { EmailPort } from "../email/email.service.js";
import * as invite from "../invite/invite.service.js";
import { computePosition } from "../column/column.service.js";
import * as repo from "./project.repo.js";
import type { Db } from "./project.repo.js";

export interface CtxUser {
  id: string;
  isSuperuser: boolean;
}

type ProjectRow = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  color: string;
  visibility: ProjectVisibility;
  position: number;
  created_at: Date;
  updated_at: Date;
};

function notFound() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: ProjectError.PROJECT_NOT_FOUND,
  });
}

function forbidden() {
  return new TRPCError({ code: "FORBIDDEN", message: ProjectError.FORBIDDEN });
}

const RANK: Record<MyPermission, number> = { view: 0, edit: 1, owner: 2 };

async function resolvePermission(
  db: Db,
  project: ProjectRow,
  user: CtxUser,
): Promise<MyPermission | null> {
  if (user.isSuperuser) return "owner";
  if (project.owner_id === user.id) return "owner";
  const grant = await repo.findAccess(db, project.id, user.id);
  if (grant) return grant;
  if (project.visibility === ProjectVisibility.Public) return "view";
  return null;
}

function toProject(row: ProjectRow, myPermission: MyPermission): Project {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    color: row.color,
    visibility: row.visibility,
    myPermission,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Load a project and the caller's effective permission, or NOT_FOUND when the
// caller has no access (private projects must not leak their existence).
async function loadFor(
  db: Db,
  user: CtxUser,
  id: string,
  min: MyPermission,
): Promise<{ row: ProjectRow; perm: MyPermission }> {
  const row = await repo.findProjectById(db, id);
  if (!row) throw notFound();
  const perm = await resolvePermission(db, row as ProjectRow, user);
  if (!perm) throw notFound();
  if (RANK[perm] < RANK[min]) {
    // Caller can see it but lacks the level for this action.
    if (min === "view") throw notFound();
    throw forbidden();
  }
  return { row: row as ProjectRow, perm };
}

export async function getProject(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<Project> {
  const { row, perm } = await loadFor(db, user, id, "view");
  return toProject(row, perm);
}

export async function listProjects(
  db: Db,
  user: CtxUser,
  input: ListProjectsInput,
): Promise<Project[]> {
  const rows = await repo.listProjectsForUser(db, user.id, input);
  const projects = rows.map((r) => {
    const perm: MyPermission =
      user.isSuperuser || r.owner_id === user.id
        ? "owner"
        : (r.access_permission ?? "view");
    return toProject(r as ProjectRow, perm);
  });
  // The "shared" list uses each viewer's personal order (the global position
  // belongs to the owner). Apply the per-user position then sort by it.
  if (input.filter === "shared") {
    const order = new Map(
      (await repo.listUserOrder(db, user.id)).map((o) => [o.project_id, o.position]),
    );
    for (const p of projects) p.position = order.get(p.id) ?? p.position;
    projects.sort((a, b) => a.position - b.position);
  }
  return projects;
}

export async function createProject(
  db: Db,
  user: CtxUser,
  input: CreateProjectInput,
): Promise<Project> {
  const row = await repo.createProject(db, {
    ownerId: user.id,
    name: input.name,
    description: input.description ?? null,
    color: input.color,
    visibility: input.visibility,
  });
  return toProject(row as ProjectRow, "owner");
}

export async function updateProject(
  db: Db,
  user: CtxUser,
  id: string,
  patch: UpdateProjectInput,
): Promise<Project> {
  const { row, perm } = await loadFor(db, user, id, "edit");
  // Visibility is an ownership-level concern, not editable by edit-grantees.
  if (patch.visibility !== undefined && perm !== "owner") throw forbidden();
  const updated = await repo.updateProject(db, id, patch);
  if (!updated) throw notFound();
  return toProject(updated as ProjectRow, perm);
}

export async function deleteProject(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<{ ok: true }> {
  await loadFor(db, user, id, "owner");
  await repo.deleteProject(db, id);
  return { ok: true };
}

// Reorder one of the user's owned projects in the sidebar via a fractional
// position relative to its neighbours.
export async function moveProject(
  db: Db,
  user: CtxUser,
  id: string,
  input: MoveProjectInput,
): Promise<Project> {
  const { row, perm } = await loadFor(db, user, id, "owner");
  const siblings = await repo.listProjectPositions(db, row.owner_id);
  const position = computePosition(
    siblings.filter((s) => s.id !== id),
    input.beforeId,
    input.afterId,
  );
  const updated = await repo.setProjectPosition(db, id, position);
  if (!updated) throw notFound();
  return toProject(updated as ProjectRow, perm);
}

// Reorder a project in the caller's "Shared with me" list. The order is stored
// per-user (the caller is not the owner), so it never affects anyone else.
export async function moveSharedProject(
  db: Db,
  user: CtxUser,
  id: string,
  input: MoveProjectInput,
): Promise<Project> {
  const { row, perm } = await loadFor(db, user, id, "view");
  const siblings = (await listProjects(db, user, {
    filter: "shared",
    limit: 100,
    offset: 0,
  })).map((p) => ({ id: p.id, position: p.position }));
  const position = computePosition(
    siblings.filter((s) => s.id !== id),
    input.beforeId,
    input.afterId,
  );
  await repo.setUserProjectPosition(db, user.id, id, position);
  return { ...toProject(row, perm), position };
}

export async function listAccess(
  db: Db,
  user: CtxUser,
  id: string,
): Promise<ProjectAccessEntry[]> {
  await loadFor(db, user, id, "owner");
  const rows = await repo.listAccess(db, id);
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    permission: r.permission,
  }));
}

export async function grantAccess(
  db: Db,
  user: CtxUser,
  id: string,
  input: GrantAccessInput,
  email: EmailPort,
): Promise<ProjectAccessEntry[]> {
  const { row } = await loadFor(db, user, id, "owner");
  const target = await repo.findUserByEmail(db, input.email);
  if (!target) {
    // No account yet: record a pending invite + email instead of erroring.
    await invite.createOrUpdateInvite(db, email, {
      inviteeEmail: input.email,
      scope: InviteScope.Project,
      scopeId: id,
      permission: input.permission,
      invitedBy: user.id,
      scopeLabel: row.name,
    });
    return listAccess(db, user, id);
  }
  if (target.id === row.owner_id) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: ProjectError.CANNOT_GRANT_OWNER,
    });
  }
  if (target.id === user.id) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: ProjectError.CANNOT_GRANT_SELF,
    });
  }
  await repo.upsertAccess(db, id, target.id, input.permission);
  return listAccess(db, user, id);
}

export async function revokeAccess(
  db: Db,
  user: CtxUser,
  id: string,
  input: RevokeAccessInput,
): Promise<ProjectAccessEntry[]> {
  await loadFor(db, user, id, "owner");
  await repo.deleteAccess(db, id, input.userId);
  return listAccess(db, user, id);
}
