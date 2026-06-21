import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttachmentCountBadge } from "./AttachmentCountBadge";

describe("AttachmentCountBadge", () => {
  it("shows the count when > 0", () => {
    render(<AttachmentCountBadge count={4} />);
    expect(screen.getByLabelText("4 attachments")).toBeInTheDocument();
  });

  it("hides when 0", () => {
    render(<AttachmentCountBadge count={0} />);
    expect(screen.queryByLabelText("0 attachments")).toBeNull();
  });
});
