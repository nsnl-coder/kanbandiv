export const AssigneeError = {
  FORBIDDEN: "FORBIDDEN",
  CARD_NOT_FOUND: "CARD_NOT_FOUND",
  BOARD_NOT_FOUND: "BOARD_NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  NOT_BOARD_MEMBER: "NOT_BOARD_MEMBER",
} as const;
export type AssigneeError = (typeof AssigneeError)[keyof typeof AssigneeError];
