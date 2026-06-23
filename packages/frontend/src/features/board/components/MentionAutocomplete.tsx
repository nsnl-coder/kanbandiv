import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { MentionMember } from "../utils";

export interface MentionAutocompleteHandle {
  // Returns true when the key was consumed by the popover.
  onKeyDown: (e: React.KeyboardEvent) => boolean;
}

interface Props {
  members: MentionMember[];
  query: string;
  onSelect: (name: string) => void;
}

// Prefix match, case-insensitive. Mirrors the server `parseMentions` token rule.
export function filterMentionMembers(members: MentionMember[], query: string): MentionMember[] {
  const q = query.toLowerCase();
  return members.filter((m) => m.name.toLowerCase().startsWith(q)).slice(0, 6);
}

export const MentionAutocomplete = forwardRef<MentionAutocompleteHandle, Props>(
  function MentionAutocomplete({ members, query, onSelect }, ref) {
    const suggestions = useMemo(() => filterMentionMembers(members, query), [members, query]);
    const [active, setActive] = useState(0);

    useEffect(() => {
      setActive(0);
    }, [query]);

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: (e) => {
          if (suggestions.length === 0) return false;
          if (e.key === "ArrowDown") {
            setActive((i) => (i + 1) % suggestions.length);
            return true;
          }
          if (e.key === "ArrowUp") {
            setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
            return true;
          }
          if (e.key === "Enter") {
            onSelect(suggestions[active].name);
            return true;
          }
          if (e.key === "Escape") return true;
          return false;
        },
      }),
      [suggestions, active, onSelect],
    );

    if (suggestions.length === 0) return null;

    return (
      <ul
        aria-label="mention suggestions"
        className="absolute z-10 mt-1 w-48 rounded-lg border border-border bg-surface shadow-lg"
      >
        {suggestions.map((m, i) => (
          <li key={m.name}>
            <button
              type="button"
              aria-label={`mention ${m.name}`}
              aria-selected={i === active}
              onClick={() => onSelect(m.name)}
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-muted ${
                i === active ? "bg-surface-muted text-foreground" : "text-foreground/80"
              }`}
            >
              @{m.name}
            </button>
          </li>
        ))}
      </ul>
    );
  },
);
