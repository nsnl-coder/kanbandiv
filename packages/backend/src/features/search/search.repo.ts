import { type Kysely, sql } from "kysely";
import { type DueFilter, ProjectVisibility } from "shared";
import type { Database } from "../../db/types.js";

export type Db = Kysely<Database>;

// ts_headline marks matches with control-char sentinels the service strips.
// Empty StartSel=,StopSel= is mis-parsed by Postgres (StartSel swallows the
// comma) and leaks the default <b> markup into the snippet, so use sentinels.
export const SNIPPET_SEL_START = String.fromCharCode(2);
export const SNIPPET_SEL_STOP = String.fromCharCode(3);
export const SNIPPET_SEL_RE = new RegExp(
  `[${SNIPPET_SEL_START}${SNIPPET_SEL_STOP}]`,
  "g",
);
const HEADLINE_OPTS = `MaxFragments=1,MaxWords=18,MinWords=5,StartSel=${SNIPPET_SEL_START},StopSel=${SNIPPET_SEL_STOP}`;

export interface SearchCardsOpts {
  userId: string;
  isSuperuser: boolean;
  q: string;
  hasText: boolean;
  labelIds?: string[];
  assigneeIds?: string[];
  due?: DueFilter;
  projectId?: string;
  boardId?: string;
  now: Date;
  limit: number;
  offset: number;
}

const DUE_SOON_MS = 24 * 60 * 60 * 1000;

export function searchCards(db: Db, opts: SearchCardsOpts) {
  return buildSearchQuery(db, opts).execute();
}

// Exposed for compiled-SQL assertions (the hasText branch cannot run on pg-mem).
export function buildSearchQuery(db: Db, opts: SearchCardsOpts) {
  // board_access / project_access PKs are (x_id, user_id), so each leftJoin
  // filtered to the caller matches at most ONE row per card -> no fan-out, no
  // need for distinctOn. (EXISTS correlated subqueries are not portable to the
  // pg-mem test runner, so leftJoin mirrors project.repo.listProjectsForUser.)
  let q = db
    .selectFrom("cards")
    .innerJoin("columns", "columns.id", "cards.column_id")
    .innerJoin("boards", "boards.id", "columns.board_id")
    .innerJoin("projects", "projects.id", "boards.project_id")
    .leftJoin("board_access", (j) =>
      j
        .onRef("board_access.board_id", "=", "boards.id")
        .on("board_access.user_id", "=", opts.userId),
    )
    .leftJoin("project_access", (j) =>
      j
        .onRef("project_access.project_id", "=", "projects.id")
        .on("project_access.user_id", "=", opts.userId),
    )
    .select([
      "cards.id as id",
      "cards.title as title",
      "cards.description as description",
      "cards.due_at as due_at",
      "columns.id as column_id",
      "columns.name as column_name",
      "boards.id as board_id",
      "boards.name as board_name",
      "projects.id as project_id",
    ]);

  // Full-text-only pieces (pg-mem cannot run these) live ONLY in this branch.
  if (opts.hasText) {
    q = q
      .select((eb) => [
        sql<number>`ts_rank(cards.search_vector, websearch_to_tsquery('english', ${opts.q}))`.as(
          "rank",
        ),
        sql<string>`ts_headline('english', coalesce(cards.description, cards.title), websearch_to_tsquery('english', ${opts.q}), ${HEADLINE_OPTS})`.as(
          "snippet",
        ),
      ])
      .where(
        sql<boolean>`cards.search_vector @@ websearch_to_tsquery('english', ${opts.q})`,
      );
  }

  // Visibility: single set-wise predicate mirroring resolveBoardPermission.
  // Skipped entirely for superusers (they see every card).
  if (!opts.isSuperuser) {
    q = q.where((eb) =>
      eb.or([
        eb("projects.owner_id", "=", opts.userId),
        eb("boards.owner_id", "=", opts.userId),
        eb("projects.visibility", "=", ProjectVisibility.Public),
        eb("board_access.user_id", "is not", null),
        eb("project_access.user_id", "is not", null),
      ]),
    );
  }

  // Filters: each ANDed, applied only when present.
  // "at least one of" filters via non-correlated IN-subqueries (these de-dup
  // naturally and stay portable to the pg-mem test runner, which cannot resolve
  // correlated EXISTS referencing the outer cards.id).
  if (opts.labelIds?.length) {
    const labelIds = opts.labelIds;
    q = q.where("cards.id", "in", (eb) =>
      eb
        .selectFrom("card_labels")
        .select("card_labels.card_id")
        .where("card_labels.label_id", "in", labelIds),
    );
  }

  if (opts.assigneeIds?.length) {
    const assigneeIds = opts.assigneeIds;
    q = q.where("cards.id", "in", (eb) =>
      eb
        .selectFrom("card_assignees")
        .select("card_assignees.card_id")
        .where("card_assignees.user_id", "in", assigneeIds),
    );
  }

  if (opts.due === "overdue") {
    // due_at < now already excludes nulls (mirrors card.repo.listDueCards).
    q = q.where("cards.due_at", "<", opts.now);
  } else if (opts.due === "due_soon") {
    q = q
      .where("cards.due_at", ">=", opts.now)
      .where("cards.due_at", "<=", new Date(opts.now.getTime() + DUE_SOON_MS));
  } else if (opts.due === "has_due") {
    q = q.where("cards.due_at", "is not", null);
  }

  if (opts.projectId) {
    q = q.where("boards.project_id", "=", opts.projectId);
  }
  if (opts.boardId) {
    q = q.where("boards.id", "=", opts.boardId);
  }

  if (opts.hasText) {
    q = q.orderBy(sql`rank`, "desc").orderBy("cards.updated_at", "desc");
  } else {
    q = q.orderBy("cards.updated_at", "desc");
  }
  q = q.orderBy("cards.id", "asc");

  return q.limit(opts.limit).offset(opts.offset);
}
