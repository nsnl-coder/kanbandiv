import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MentionAutocomplete,
  filterMentionMembers,
  type MentionAutocompleteHandle,
} from "./MentionAutocomplete";

const members = [{ name: "alice" }, { name: "alan" }, { name: "bob" }];

describe("filterMentionMembers", () => {
  it("matches by prefix, case-insensitive", () => {
    expect(filterMentionMembers(members, "AL").map((m) => m.name)).toEqual(["alice", "alan"]);
    expect(filterMentionMembers(members, "")).toHaveLength(3);
    expect(filterMentionMembers(members, "zzz")).toHaveLength(0);
  });
});

describe("MentionAutocomplete", () => {
  it("shows only matching members", () => {
    render(<MentionAutocomplete members={members} query="al" onSelect={() => {}} />);
    expect(screen.getByLabelText("mention alice")).toBeInTheDocument();
    expect(screen.getByLabelText("mention alan")).toBeInTheDocument();
    expect(screen.queryByLabelText("mention bob")).toBeNull();
  });

  it("renders nothing when no member matches", () => {
    const { container } = render(
      <MentionAutocomplete members={members} query="zzz" onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("selects on click", async () => {
    const u = userEvent.setup();
    const onSelect = vi.fn();
    render(<MentionAutocomplete members={members} query="al" onSelect={onSelect} />);
    await u.click(screen.getByLabelText("mention alan"));
    expect(onSelect).toHaveBeenCalledWith("alan");
  });

  it("navigates with arrows and selects on Enter", () => {
    const ref = createRef<MentionAutocompleteHandle>();
    const onSelect = vi.fn();
    render(
      <MentionAutocomplete ref={ref} members={members} query="al" onSelect={onSelect} />,
    );
    const press = (key: string) =>
      act(() => {
        ref.current?.onKeyDown({ key, preventDefault() {} } as React.KeyboardEvent);
      });
    press("ArrowDown"); // active: alice -> alan
    press("Enter");
    expect(onSelect).toHaveBeenCalledWith("alan");
  });

  it("wraps selection with ArrowUp from the first item", () => {
    const ref = createRef<MentionAutocompleteHandle>();
    const onSelect = vi.fn();
    render(
      <MentionAutocomplete ref={ref} members={members} query="al" onSelect={onSelect} />,
    );
    const press = (key: string) =>
      act(() => {
        ref.current?.onKeyDown({ key, preventDefault() {} } as React.KeyboardEvent);
      });
    press("ArrowUp"); // wraps to last: alan
    press("Enter");
    expect(onSelect).toHaveBeenCalledWith("alan");
  });
});
