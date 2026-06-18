import type { Board } from "shared";

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
