import { describe, it, expect } from "vitest";
import { fuzzyScore, filterCommands } from "./fuzzy";
import type { Command } from "./commands";

function cmd(id: string, label: string, keywords?: string[]): Command {
  return { id, label, group: "Navigate", keywords, run: () => {} };
}

describe("fuzzyScore", () => {
  it("matches a subsequence", () => {
    expect(fuzzyScore("gtp", "Go to Projects")).not.toBeNull();
  });

  it("returns null for a non-match", () => {
    expect(fuzzyScore("zzzz", "Go to Projects")).toBeNull();
  });

  it("empty query matches all (score 0)", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("consecutive / word-boundary outranks scattered", () => {
    const consecutive = fuzzyScore("pro", "Projects")!;
    const scattered = fuzzyScore("pro", "Past report only")!;
    expect(consecutive).toBeGreaterThan(scattered);
  });
});

describe("filterCommands", () => {
  const cmds = [
    cmd("a", "Go to Projects"),
    cmd("b", "New project"),
    cmd("c", "Log out"),
  ];

  it("drops non-matches", () => {
    const out = filterCommands(cmds, "project");
    expect(out.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("empty query returns all in original order", () => {
    expect(filterCommands(cmds, "").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts by score (best match first)", () => {
    const out = filterCommands(
      [cmd("scatter", "Past report only"), cmd("exact", "Projects")],
      "pro",
    );
    expect(out[0].id).toBe("exact");
  });
});
