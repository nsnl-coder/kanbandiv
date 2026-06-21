import {
  ActivityType,
  type Activity,
  type ActivityTypeValue,
} from "shared";
import {
  Plus,
  Pencil,
  AlignLeft,
  MoveRight,
  Trash2,
  Tag,
  TagsIcon,
  UserPlus,
  UserMinus,
  CalendarClock,
  CalendarOff,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  FileX,
  ListChecks,
  ListX,
  ListPlus,
  CheckSquare,
  Square,
  ShieldCheck,
  ShieldX,
  Activity as ActivityIcon,
  type LucideIcon,
} from "lucide-react";

export type ActivityScope = "card" | "board";

function s(meta: Activity["meta"], key: string): string {
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : "";
}

function formatDate(value: unknown): string {
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  return "a date";
}

// One human-readable line per ActivityType, built entirely from meta (no extra
// queries). scope="card" omits the redundant card name; scope="board" includes
// it. A default keeps an unknown future type from crashing the UI.
export function describeActivity(
  a: Activity,
  scope: ActivityScope = "card",
): { icon: LucideIcon; text: string } {
  const type = a.type as ActivityTypeValue;
  const meta = a.meta;
  const cardTitle = s(meta, "cardTitle");
  const onCard = scope === "board" && cardTitle ? ` on "${cardTitle}"` : "";

  switch (type) {
    case ActivityType.CARD_CREATED:
      return {
        icon: Plus,
        text: scope === "board" && cardTitle ? `created "${cardTitle}"` : "created this card",
      };
    case ActivityType.CARD_RENAMED:
      return {
        icon: Pencil,
        text: `renamed from "${s(meta, "from")}" to "${s(meta, "to")}"`,
      };
    case ActivityType.CARD_DESCRIPTION_CHANGED:
      return { icon: AlignLeft, text: `updated the description${onCard}` };
    case ActivityType.CARD_MOVED:
      return {
        icon: MoveRight,
        text: `moved${onCard} from ${s(meta, "fromColumn")} to ${s(meta, "toColumn")}`,
      };
    case ActivityType.CARD_DELETED:
      return { icon: Trash2, text: `deleted "${cardTitle}"` };
    case ActivityType.LABEL_ATTACHED:
      return { icon: Tag, text: `added label ${s(meta, "labelName")}${onCard}` };
    case ActivityType.LABEL_DETACHED:
      return { icon: TagsIcon, text: `removed label ${s(meta, "labelName")}${onCard}` };
    case ActivityType.ASSIGNEE_ASSIGNED:
      return { icon: UserPlus, text: `assigned ${s(meta, "targetHandle")}${onCard}` };
    case ActivityType.ASSIGNEE_UNASSIGNED:
      return { icon: UserMinus, text: `unassigned ${s(meta, "targetHandle")}${onCard}` };
    case ActivityType.DUE_DATE_SET:
      return { icon: CalendarClock, text: `set due date to ${formatDate(meta.dueAt)}${onCard}` };
    case ActivityType.DUE_DATE_CLEARED:
      return { icon: CalendarOff, text: `cleared the due date${onCard}` };
    case ActivityType.COVER_CHANGED:
      return { icon: ImageIcon, text: `changed the cover${onCard}` };
    case ActivityType.COMMENT_ADDED:
      return { icon: MessageSquare, text: `commented: "${s(meta, "snippet")}"${onCard}` };
    case ActivityType.ATTACHMENT_ADDED:
      return { icon: Paperclip, text: `attached ${s(meta, "filename")}${onCard}` };
    case ActivityType.ATTACHMENT_DELETED:
      return { icon: FileX, text: `removed attachment ${s(meta, "filename")}${onCard}` };
    case ActivityType.CHECKLIST_CREATED:
      return { icon: ListChecks, text: `added checklist ${s(meta, "title")}${onCard}` };
    case ActivityType.CHECKLIST_DELETED:
      return { icon: ListX, text: `removed checklist ${s(meta, "title")}${onCard}` };
    case ActivityType.CHECKLIST_ITEM_ADDED:
      return { icon: ListPlus, text: `added "${s(meta, "text")}"${onCard}` };
    case ActivityType.CHECKLIST_ITEM_CHECKED:
      return { icon: CheckSquare, text: `checked "${s(meta, "text")}"${onCard}` };
    case ActivityType.CHECKLIST_ITEM_UNCHECKED:
      return { icon: Square, text: `unchecked "${s(meta, "text")}"${onCard}` };
    case ActivityType.MEMBER_GRANTED:
      return {
        icon: ShieldCheck,
        text: `granted ${s(meta, "targetHandle")} ${s(meta, "permission")} access`,
      };
    case ActivityType.MEMBER_REVOKED:
      return { icon: ShieldX, text: `revoked ${s(meta, "targetHandle")}'s access` };
    default:
      return { icon: ActivityIcon, text: "made a change" };
  }
}
