export const ActivityError = {
  CARD_NOT_FOUND: "CARD_NOT_FOUND",
  BOARD_NOT_FOUND: "BOARD_NOT_FOUND",
} as const;
export type ActivityError = (typeof ActivityError)[keyof typeof ActivityError];
