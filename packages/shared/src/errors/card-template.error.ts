export const CardTemplateError = {
  FORBIDDEN: "FORBIDDEN",
  TEMPLATE_NOT_FOUND: "TEMPLATE_NOT_FOUND",
  BOARD_NOT_FOUND: "BOARD_NOT_FOUND",
  COLUMN_NOT_FOUND: "COLUMN_NOT_FOUND",
  INVALID_TARGET: "INVALID_TARGET",
} as const;
export type CardTemplateError =
  (typeof CardTemplateError)[keyof typeof CardTemplateError];
