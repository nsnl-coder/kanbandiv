import {
  NotificationType,
  type Notification,
  type NotificationTypeValue,
} from "shared";
import { AtSign, UserPlus, Clock, Bug, Bell, Share2, type LucideIcon } from "lucide-react";

// One human-readable line per NotificationType, built entirely from payload (no
// extra query). A default keeps an unknown future type from crashing the UI.
export function describeNotification(n: Notification): {
  icon: LucideIcon;
  text: string;
} {
  const type = n.type as NotificationTypeValue;
  const { actorHandle, title } = n.payload;
  const actor = actorHandle ?? "Someone";

  switch (type) {
    case NotificationType.MENTION:
      return { icon: AtSign, text: `${actor} mentioned you on "${title}"` };
    case NotificationType.CARD_ASSIGNED:
      return { icon: UserPlus, text: `${actor} assigned you to "${title}"` };
    case NotificationType.CARD_DUE_SOON:
      return { icon: Clock, text: `"${title}" is due soon` };
    case NotificationType.BUG_REPORT_NEW:
      return { icon: Bug, text: `${actor} reported a bug: "${title}"` };
    case NotificationType.BOARD_SHARED:
      return { icon: Share2, text: `${actor} shared the board "${title}" with you` };
    case NotificationType.PROJECT_SHARED:
      return { icon: Share2, text: `${actor} shared the project "${title}" with you` };
    default:
      return { icon: Bell, text: `Update on "${title}"` };
  }
}
