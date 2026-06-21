import {
  BoardViewMode,
  type BoardViewConfig,
  type BoardViewModeValue,
  type DueViewFilter,
  type SwimlaneGrouping,
} from "shared";

// Page-side filter/view state mirrored to/from the persisted BoardViewConfig.
export interface ViewState {
  labelFilter: string[];
  assigneeFilter: string[];
  assignedToMe: boolean;
  dueFilter: DueViewFilter | null;
  swimlaneBy: SwimlaneGrouping | null;
}

export function toConfig(s: ViewState): BoardViewConfig {
  return {
    labelIds: s.labelFilter,
    assigneeIds: s.assigneeFilter,
    assignedToMe: s.assignedToMe,
    due: s.dueFilter,
    swimlaneBy: s.swimlaneBy,
  };
}

export function fromConfig(c: BoardViewConfig): ViewState {
  return {
    labelFilter: c.labelIds,
    assigneeFilter: c.assigneeIds,
    assignedToMe: c.assignedToMe,
    dueFilter: c.due,
    swimlaneBy: c.swimlaneBy,
  };
}

export const VIEW_MODES: { value: BoardViewModeValue; label: string }[] = [
  { value: BoardViewMode.KANBAN, label: "Kanban" },
  { value: BoardViewMode.TABLE, label: "Table" },
  { value: BoardViewMode.CALENDAR, label: "Calendar" },
  { value: BoardViewMode.SWIMLANES, label: "Swimlanes" },
];

export const SWIMLANE_GROUPINGS: { value: SwimlaneGrouping; label: string }[] = [
  { value: "label", label: "By label" },
  { value: "assignee", label: "By assignee" },
];

export const DUE_FILTER_OPTIONS: { value: DueViewFilter | null; label: string }[] = [
  { value: null, label: "Any due" },
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: "Due soon" },
  { value: "has_due", label: "Has due" },
];
