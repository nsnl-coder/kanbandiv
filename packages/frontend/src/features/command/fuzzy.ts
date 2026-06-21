import type { Command } from "./commands";

// Case-insensitive subsequence score over a target string.
// Returns null when not every query char appears in order, else a score where
// consecutive runs and word-boundary matches rank higher.
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 0; // empty query -> match all
  const t = target.toLowerCase();

  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += 1;
    if (found === prevMatch + 1) score += 5; // consecutive run bonus
    const before = found === 0 ? " " : t[found - 1];
    if (before === " " || before === "-" || before === ":") score += 3; // word boundary
    prevMatch = found;
    ti = found + 1;
  }
  return score;
}

function haystack(cmd: Command): string {
  return `${cmd.label} ${(cmd.keywords ?? []).join(" ")}`;
}

// Score every command, drop non-matches, stable-sort by score desc.
export function filterCommands(commands: Command[], query: string): Command[] {
  const scored = commands.map((cmd, index) => ({
    cmd,
    index,
    score: fuzzyScore(query, haystack(cmd)),
  }));
  return scored
    .filter((s): s is { cmd: Command; index: number; score: number } => s.score !== null)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((s) => s.cmd);
}
