import type { Assignee, Board, Card, Label } from "shared";
import { LABEL_COLORS, ATTACHMENT_MAX_BYTES, ATTACHMENT_ALLOWED_MIME } from "shared";

export { LABEL_COLORS };

// Attachment helpers. Client-side pre-validation; server is source of truth.
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export function isWithinSize(file: File): boolean {
  return file.size <= ATTACHMENT_MAX_BYTES;
}

export function isAllowedType(file: File): boolean {
  return (ATTACHMENT_ALLOWED_MIME as readonly string[]).includes(file.type);
}

export function canEdit(b: Pick<Board, "myPermission">): boolean {
  return b.myPermission !== "view";
}

export function isOwner(b: Pick<Board, "myPermission">): boolean {
  return b.myPermission === "owner";
}

export const PERMISSION_LABELS: Record<Board["myPermission"], string> = {
  owner: "Owner",
  edit: "Editor",
  view: "Viewer",
};

export function sortByPosition<T extends { position: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position);
}

// Palette for the color picker. Values are validated by createBoardInput.
export const BOARD_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
] as const;

export function progressPercent(p: { done: number; total: number }): number {
  if (p.total <= 0) return 0;
  return Math.round((p.done / p.total) * 100);
}

export function cardMatchesLabels(card: Pick<Card, "labels">, ids: string[]): boolean {
  if (ids.length === 0) return true;
  const set = new Set(card.labels.map((l) => l.id));
  return ids.every((id) => set.has(id));
}

// Assignee helpers. PublicUser has no name/avatar, so display is derived from
// the email local-part; the chip color is keyed off the immutable user id.
export function assigneeDisplayName(email: string): string {
  return email.split("@")[0];
}

export function assigneeInitials(email: string): string {
  const local = assigneeDisplayName(email);
  const parts = local.split(/[.\-_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export const ASSIGNEE_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
] as const;

export function assigneeColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return ASSIGNEE_COLORS[Math.abs(hash) % ASSIGNEE_COLORS.length];
}

export function cardAssignedToUser(
  card: Pick<Card, "assignees">,
  userId: string,
): boolean {
  if (!userId) return false;
  return card.assignees.some((a) => a.id === userId);
}

// OR-match: a card matches if it has ANY selected assignee. Empty filter passes.
// Intentionally NOT AND like cardMatchesLabels.
export function cardMatchesAssignees(
  card: Pick<Card, "assignees">,
  userIds: string[],
): boolean {
  if (userIds.length === 0) return true;
  const set = new Set(card.assignees.map((a) => a.id));
  return userIds.some((id) => set.has(id));
}

// Re-export Assignee for callers.
export type { Assignee };

// Due date helpers.
export type DueState = "overdue" | "soon" | "upcoming" | "none";

export function dueState(card: Pick<Card, "dueAt" | "isOverdue">): DueState {
  if (!card.dueAt) return "none";
  if (card.isOverdue) return "overdue";
  const ms = card.dueAt.getTime() - Date.now();
  if (ms <= 24 * 60 * 60 * 1000) return "soon";
  return "upcoming";
}

export function formatDueDate(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const REMINDER_OPTIONS = [
  { value: null, label: "No reminder" },
  { value: 0, label: "At time of due" },
  { value: 10, label: "10 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
] as const;

export function relativeTime(date: Date): string {
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < hour) return rtf.format(Math.round(diff / min), "minute");
  if (abs < day) return rtf.format(Math.round(diff / hour), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), "day");
  return date.toLocaleDateString();
}

// Re-export Label so callers can `import { type Label } from utils` if needed.
export type { Label };

// Comment mention rendering. Splits a body into text + mention segments so the
// caller can highlight `@name` tokens that match a known board member.
export interface MentionMember {
  name: string;
}

export interface MentionSegment {
  text: string;
  isMention: boolean;
}

export function renderMentions(body: string, members: MentionMember[]): MentionSegment[] {
  const known = new Set(members.map((m) => m.name.toLowerCase()));
  const segments: MentionSegment[] = [];
  const re = /(^|\s)@([\w.-]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const lead = m[1];
    const handle = m[2];
    const start = m.index + lead.length;
    if (start > last) segments.push({ text: body.slice(last, start), isMention: false });
    const isMention = known.has(handle.toLowerCase());
    segments.push({ text: `@${handle}`, isMention });
    last = start + handle.length + 1;
  }
  if (last < body.length) segments.push({ text: body.slice(last), isMention: false });
  return segments;
}
