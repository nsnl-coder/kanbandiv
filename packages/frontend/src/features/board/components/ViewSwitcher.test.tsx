import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewSwitcher } from "./ViewSwitcher";

describe("ViewSwitcher", () => {
  it("renders the 4 modes and reflects the active one via aria-pressed", () => {
    render(
      <ViewSwitcher mode="table" onModeChange={() => {}} swimlaneBy={null} onSwimlaneByChange={() => {}} />,
    );
    for (const label of ["Kanban", "Table", "Calendar", "Swimlanes"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Kanban" })).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a mode calls onModeChange", async () => {
    const u = userEvent.setup();
    const onModeChange = vi.fn();
    render(
      <ViewSwitcher mode="kanban" onModeChange={onModeChange} swimlaneBy={null} onSwimlaneByChange={() => {}} />,
    );
    await u.click(screen.getByRole("button", { name: "Calendar" }));
    expect(onModeChange).toHaveBeenCalledWith("calendar");
  });

  it("shows the grouping toggle ONLY in swimlanes mode", () => {
    const { rerender } = render(
      <ViewSwitcher mode="kanban" onModeChange={() => {}} swimlaneBy={null} onSwimlaneByChange={() => {}} />,
    );
    expect(screen.queryByRole("group", { name: "group swimlanes by" })).toBeNull();
    rerender(
      <ViewSwitcher mode="swimlanes" onModeChange={() => {}} swimlaneBy="label" onSwimlaneByChange={() => {}} />,
    );
    expect(screen.getByRole("group", { name: "group swimlanes by" })).toBeInTheDocument();
  });

  it("toggling grouping calls onSwimlaneByChange", async () => {
    const u = userEvent.setup();
    const onSwimlaneByChange = vi.fn();
    render(
      <ViewSwitcher
        mode="swimlanes"
        onModeChange={() => {}}
        swimlaneBy="label"
        onSwimlaneByChange={onSwimlaneByChange}
      />,
    );
    await u.click(screen.getByRole("button", { name: "By assignee" }));
    expect(onSwimlaneByChange).toHaveBeenCalledWith("assignee");
  });
});
