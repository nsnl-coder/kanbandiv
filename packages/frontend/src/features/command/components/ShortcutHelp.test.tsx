import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShortcutHelp } from "./ShortcutHelp";
import { useShortcutHelpStore } from "../useShortcutHelpStore";
import { SHORTCUTS } from "../shortcuts";

beforeEach(() => {
  useShortcutHelpStore.getState().setOpen(false);
});

describe("ShortcutHelp", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ShortcutHelp />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a row per SHORTCUTS entry when open", () => {
    useShortcutHelpStore.getState().setOpen(true);
    render(<ShortcutHelp />);
    for (const row of SHORTCUTS) {
      expect(screen.getAllByText(row.description).length).toBeGreaterThan(0);
    }
  });
});
