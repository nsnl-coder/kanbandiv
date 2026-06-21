import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Assignee } from "shared";
import { AssigneeStack } from "./AssigneeStack";

const make = (n: number): Assignee[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i}`, email: `user${i}@example.com` }));

describe("AssigneeStack", () => {
  it("renders one chip per assignee with initials", () => {
    render(<AssigneeStack assignees={[{ id: "u1", email: "john.doe@example.com" }]} />);
    expect(screen.getByLabelText("john.doe")).toHaveTextContent("JD");
  });

  it("collapses to +N past the cap", () => {
    render(<AssigneeStack assignees={make(5)} cap={3} />);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("renders nothing when empty", () => {
    const { container } = render(<AssigneeStack assignees={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
