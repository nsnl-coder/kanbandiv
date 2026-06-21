export const BoardViewError = {
  BOARD_NOT_FOUND: "BOARD_NOT_FOUND",
} as const;
export type BoardViewError = (typeof BoardViewError)[keyof typeof BoardViewError];
