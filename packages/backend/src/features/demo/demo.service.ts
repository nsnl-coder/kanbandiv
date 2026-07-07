import crypto from "node:crypto";
import {
  DEFAULT_BOARD_COLOR,
  DEFAULT_PROJECT_COLOR,
  ProjectVisibility,
  type AuthTokens,
  type PublicUser,
} from "shared";
import { hashPassword, issueTokens } from "../auth/auth.service.js";
import { insertEvent } from "../auth/auth.repo.js";
import * as projectRepo from "../project/project.repo.js";
import * as boardRepo from "../board/board.repo.js";
import * as columnRepo from "../column/column.repo.js";
import * as cardRepo from "../card/card.repo.js";
import * as labelRepo from "../label/label.repo.js";
import * as assigneeRepo from "../assignee/assignee.repo.js";
import * as checklistRepo from "../checklist/checklist.repo.js";
import * as repo from "./demo.repo.js";
import type { Db } from "./demo.repo.js";

// Non-routable domain for throwaway demo accounts (mirrors TEST_EMAIL_DOMAIN
// for e2e accounts, but MUST stay distinct: is_test accounts get deterministic
// OTPs, which would make a demo account trivially hijackable). .internal is
// reserved (RFC 8375-adjacent), so no OTP/reset mail can ever be delivered.
export const DEMO_EMAIL_DOMAIN = "demo.trelloclone.internal";

/** Demo accounts (and, via FK cascades, all their content) live this long. */
export const DEMO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DemoSession {
  tokens: AuthTokens;
  projectId: string;
  boardId: string;
}

/**
 * Create a fresh throwaway account, seed a believable board, and mint a normal
 * session for it. The account is unhijackable by construction: the password is
 * 32 random bytes hashed and immediately discarded (same invariant as Google
 * sign-up accounts), so login can never match, and password reset/change need
 * an OTP delivered to a mailbox that does not exist.
 */
export async function createDemoSession(
  db: Db,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<DemoSession> {
  const email = `demo-visitor-${crypto.randomUUID()}@${DEMO_EMAIL_DOMAIN}`;
  const unusablePassword = crypto.randomBytes(32).toString("base64url");
  const user = await repo.createDemoUser(db, {
    email,
    passwordHash: await hashPassword(unusablePassword),
  });

  const { projectId, boardId } = await seedDemoBoard(db, user.id);

  // Same audit trail as login/register (auth_events).
  await insertEvent(db, {
    userId: user.id,
    event: "demo_session",
    outcome: "success",
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  });

  // Demo users have no role/grants, so the public shape is fully known here
  // (no rbac lookup needed).
  const publicUser: PublicUser = {
    id: user.id,
    email: user.email,
    isSuperuser: false,
    roleId: null,
    emailVerified: true,
    oauthProvider: null,
    isDemo: true,
    permissions: [],
  };
  const tokens = await issueTokens(db, publicUser);
  return { tokens, projectId, boardId };
}

/** Sweep demo accounts older than the retention window. Returns rows deleted. */
export function sweepStaleDemoUsers(db: Db): Promise<number> {
  return repo.deleteDemoUsersCreatedBefore(
    db,
    new Date(Date.now() - DEMO_RETENTION_MS),
  );
}

// --- seed content ---

interface SeedCard {
  title: string;
  description: string;
  labels: string[];
  dueInDays?: number;
  assignMe?: boolean;
}

// A worked-in "Product launch" board: 4 lists, 9 cards, labels, due dates
// (one overdue), a half-done checklist, and a couple of self-assignments.
const LABELS: { name: string; color: string }[] = [
  { name: "Marketing", color: "#ff9f1a" },
  { name: "Engineering", color: "#0079bf" },
  { name: "Design", color: "#c377e0" },
  { name: "Blocked", color: "#eb5a46" },
];

const COLUMNS: { name: string; cards: SeedCard[] }[] = [
  {
    name: "To do",
    cards: [
      {
        title: "Draft launch-day announcement",
        description:
          "Cover the **why**, not the feature list.\n\n- Blog post (~800 words)\n- Social thread\n- Product Hunt blurb\n\nTone: confident, no superlatives. Link drafts here when ready.",
        labels: ["Marketing"],
        dueInDays: 5,
      },
      {
        title: "Set up status page + on-call rotation",
        description:
          "Launch week needs a public heartbeat.\n\n1. Status page with the three user-facing components\n2. Escalation: primary -> secondary -> everyone\n3. Dry-run one fake incident before Thursday",
        labels: ["Engineering"],
        dueInDays: 7,
      },
      {
        title: "Record 60-second product tour",
        description:
          "Script is approved (see the doc in the shared drive). Capture at 1440p, captions burned in — most viewers watch muted.",
        labels: ["Marketing", "Design"],
      },
    ],
  },
  {
    name: "In progress",
    cards: [
      {
        title: "Pricing page redesign",
        description:
          "Three tiers, annual toggle, FAQ below the fold.\n\n> Decision from Monday: lead with the *team* plan, not the free tier.",
        labels: ["Design"],
        dueInDays: 2,
        assignMe: true,
      },
      {
        title: "Migrate billing webhooks to v2 API",
        description:
          "The v1 endpoint sunsets end of month.\n\n- [x] Inventory current subscriptions\n- [ ] Dual-write window\n- [ ] Cut over + delete v1 handler\n\nRollback plan: re-point the webhook URL, nothing else changes.",
        labels: ["Engineering"],
        dueInDays: 3,
      },
    ],
  },
  {
    name: "Review",
    cards: [
      {
        title: "Onboarding email sequence (5 emails)",
        description:
          "Sequence: welcome -> first board -> invite your team -> shortcuts -> upgrade nudge.\n\nCopy is drafted; needs a pass for tone consistency with the landing page.",
        labels: ["Marketing"],
        dueInDays: 1,
        assignMe: true,
      },
      {
        title: "Load-test checkout at 10x traffic",
        description:
          "Blocked on staging data refresh — the anonymised dump job keeps timing out.\n\nTarget: p95 < 400ms at 10x last month's peak.",
        labels: ["Engineering", "Blocked"],
        dueInDays: -1,
      },
    ],
  },
  {
    name: "Done",
    cards: [
      {
        title: "Beta feedback triage — top 20 issues",
        description:
          "Went through all 214 beta reports. 20 actionable issues filed, 3 promoted to launch blockers (all fixed).",
        labels: ["Engineering"],
      },
      {
        title: "New logo + brand palette",
        description:
          "Final files exported to the brand kit. Old marks removed from the app header and email templates.",
        labels: ["Design"],
      },
    ],
  },
];

// Checklist attached to "Pricing page redesign" (half done, like real work).
const CHECKLIST = {
  onCardTitle: "Pricing page redesign",
  title: "Design QA",
  items: [
    { text: "Mobile breakpoints", done: true },
    { text: "Dark mode pass", done: true },
    { text: "Annual/monthly toggle states", done: false },
    { text: "Empty-FAQ fallback", done: false },
  ],
};

async function seedDemoBoard(
  db: Db,
  ownerId: string,
): Promise<{ projectId: string; boardId: string }> {
  const project = await projectRepo.createProject(db, {
    ownerId,
    name: "Demo workspace",
    description: "Your temporary workspace — everything here is yours to play with.",
    color: DEFAULT_PROJECT_COLOR,
    visibility: ProjectVisibility.Private,
  });
  const board = await boardRepo.createBoard(db, {
    projectId: project.id,
    ownerId,
    name: "Product launch",
    description: "Everything needed to take v1 out the door.",
    color: DEFAULT_BOARD_COLOR,
  });

  const labelIds = new Map<string, string>();
  for (const l of LABELS) {
    const row = await labelRepo.createLabel(db, {
      boardId: board.id,
      name: l.name,
      color: l.color,
    });
    labelIds.set(l.name, row.id);
  }

  for (const [colIdx, col] of COLUMNS.entries()) {
    const column = await columnRepo.createColumn(db, {
      boardId: board.id,
      name: col.name,
      position: colIdx,
    });
    for (const [cardIdx, seed] of col.cards.entries()) {
      const card = await cardRepo.createCard(db, {
        columnId: column.id,
        title: seed.title,
        description: seed.description,
        position: cardIdx,
      });
      if (seed.dueInDays !== undefined) {
        await db
          .updateTable("cards")
          .set({ due_at: new Date(Date.now() + seed.dueInDays * DAY_MS) })
          .where("id", "=", card.id)
          .execute();
      }
      for (const name of seed.labels) {
        await labelRepo.attachLabel(db, card.id, labelIds.get(name)!);
      }
      if (seed.assignMe) await assigneeRepo.assign(db, card.id, ownerId);
      if (seed.title === CHECKLIST.onCardTitle) {
        const checklist = await checklistRepo.createChecklist(db, {
          cardId: card.id,
          title: CHECKLIST.title,
          position: 0,
        });
        for (const [i, item] of CHECKLIST.items.entries()) {
          const row = await checklistRepo.createItem(db, {
            checklistId: checklist.id,
            text: item.text,
            position: i,
          });
          if (item.done) {
            await db
              .updateTable("checklist_items")
              .set({ is_done: true })
              .where("id", "=", row.id)
              .execute();
          }
        }
      }
    }
  }

  return { projectId: project.id, boardId: board.id };
}
