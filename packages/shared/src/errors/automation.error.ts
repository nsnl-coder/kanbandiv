// Shared automation error messages (frontend + backend).
export const AutomationError = {
  RULE_NOT_FOUND: "AUTOMATION_RULE_NOT_FOUND",
  BOARD_NOT_FOUND: "AUTOMATION_BOARD_NOT_FOUND",
  COLUMN_NOT_FOUND: "AUTOMATION_COLUMN_NOT_FOUND",
} as const;
export type AutomationErrorValue = (typeof AutomationError)[keyof typeof AutomationError];
