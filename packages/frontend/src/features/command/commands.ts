import {
  FolderKanban,
  FolderPlus,
  LogOut,
  Plus,
  Shield,
  Search,
  Keyboard,
  Table,
  Calendar,
  Rows,
  Columns3,
  History,
  Archive,
  Tag,
  LayoutTemplate,
  Users,
  FilterX,
  type LucideIcon,
} from "lucide-react";
import { BoardViewMode } from "shared";
import type {
  BoardActionsCtx,
  BoardActionsHandlers,
} from "./useBoardActionsStore";

export type CommandGroup = "Navigate" | "Create" | "Board" | "Account";

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  keywords?: string[];
  icon?: LucideIcon;
  shortcut?: string;
  run: () => void;
}

export interface BuildCommandsArgs {
  navigate: (path: string) => void;
  ctx: BoardActionsCtx | null;
  handlers: BoardActionsHandlers | null;
  logout: () => void;
  openSearch: (v: boolean) => void;
  openHelp: (v: boolean) => void;
  setOpen: (v: boolean) => void;
  canAdmin: boolean;
}

// Pure registry builder. Context-excluded commands are omitted (not greyed).
// Every `run` closes the palette first, then performs the action.
export function buildCommands(args: BuildCommandsArgs): Command[] {
  const { navigate, ctx, handlers, logout, openSearch, openHelp, setOpen, canAdmin } = args;
  const close = () => setOpen(false);
  const commands: Command[] = [];

  // Navigate
  commands.push({
    id: "nav-projects",
    label: "Go to Projects",
    group: "Navigate",
    keywords: ["projects", "home"],
    icon: FolderKanban,
    shortcut: "g p",
    run: () => {
      close();
      navigate("/projects");
    },
  });
  if (canAdmin) {
    commands.push({
      id: "nav-admin",
      label: "Admin",
      group: "Navigate",
      keywords: ["admin", "settings"],
      icon: Shield,
      run: () => {
        close();
        navigate("/admin");
      },
    });
  }
  // Create
  commands.push({
    id: "create-project",
    label: "New project",
    group: "Create",
    keywords: ["new", "project", "create"],
    icon: FolderPlus,
    run: () => {
      close();
      navigate("/projects/new");
    },
  });
  if (ctx && ctx.canEdit && handlers) {
    commands.push({
      id: "create-card",
      label: "New card on current board",
      group: "Create",
      keywords: ["new", "card", "create", "task"],
      icon: Plus,
      shortcut: "c",
      run: () => {
        close();
        handlers.newCard();
      },
    });
  }

  // Board (only with ctx)
  if (ctx && handlers) {
    const views: { mode: typeof BoardViewMode[keyof typeof BoardViewMode]; label: string; icon: LucideIcon }[] = [
      { mode: BoardViewMode.KANBAN, label: "Switch to Kanban view", icon: Columns3 },
      { mode: BoardViewMode.TABLE, label: "Switch to Table view", icon: Table },
      { mode: BoardViewMode.CALENDAR, label: "Switch to Calendar view", icon: Calendar },
      { mode: BoardViewMode.SWIMLANES, label: "Switch to Swimlanes view", icon: Rows },
    ];
    for (const v of views) {
      commands.push({
        id: `board-view-${v.mode}`,
        label: v.label,
        group: "Board",
        keywords: ["view", "switch", v.mode],
        icon: v.icon,
        run: () => {
          close();
          handlers.setView(v.mode);
        },
      });
    }
    commands.push({
      id: "board-history",
      label: "Open History",
      group: "Board",
      keywords: ["history", "activity"],
      icon: History,
      run: () => {
        close();
        handlers.openHistory();
      },
    });
    if (ctx.canEdit) {
      commands.push({
        id: "board-archived",
        label: "Open Archived items",
        group: "Board",
        keywords: ["archived", "archive"],
        icon: Archive,
        run: () => {
          close();
          handlers.openArchived();
        },
      });
      commands.push({
        id: "board-labels",
        label: "Manage labels",
        group: "Board",
        keywords: ["labels", "tags"],
        icon: Tag,
        run: () => {
          close();
          handlers.openLabels();
        },
      });
      commands.push({
        id: "board-templates",
        label: "Manage templates",
        group: "Board",
        keywords: ["templates", "card", "preset"],
        icon: LayoutTemplate,
        run: () => {
          close();
          handlers.openTemplates();
        },
      });
    }
    if (ctx.isOwner) {
      commands.push({
        id: "board-access",
        label: "Board members / access",
        group: "Board",
        keywords: ["members", "access", "share"],
        icon: Users,
        run: () => {
          close();
          handlers.openAccess();
        },
      });
    }
    commands.push({
      id: "board-clear-filters",
      label: "Clear filters",
      group: "Board",
      keywords: ["clear", "filters", "reset"],
      icon: FilterX,
      run: () => {
        close();
        handlers.clearFilters();
      },
    });
  }

  // Account
  commands.push({
    id: "account-search",
    label: "Search cards",
    group: "Account",
    keywords: ["search", "find", "cards"],
    icon: Search,
    shortcut: "Cmd K",
    run: () => {
      close();
      openSearch(true);
    },
  });
  commands.push({
    id: "account-shortcuts",
    label: "Keyboard shortcuts",
    group: "Account",
    keywords: ["keyboard", "shortcuts", "help"],
    icon: Keyboard,
    shortcut: "?",
    run: () => {
      close();
      openHelp(true);
    },
  });
  commands.push({
    id: "account-logout",
    label: "Log out",
    group: "Account",
    keywords: ["logout", "sign out", "exit"],
    icon: LogOut,
    run: () => {
      close();
      logout();
    },
  });

  return commands;
}
